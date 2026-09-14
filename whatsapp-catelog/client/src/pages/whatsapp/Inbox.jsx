import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  IconBox,
  IconCatalog,
  IconCheck,
  IconChevronLeft,
  IconInbox,
  IconLayers,
  IconSend,
} from '../../components/Icons';
import SendProductModal from '../../components/SendProductModal';
import { Alert, Badge, Button, EmptyState, Loading, SearchInput } from '../../components/ui';
import { useAsync, useDebounced } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { formatCountdown, formatPhone, formatTime, initials, truncate } from '../../lib/format';
import { getSocket } from '../../lib/socket';
import { useApp } from '../../store/AppContext';

const STATUS_TICK = {
  SENT: '✓',
  DELIVERED: '✓✓',
  READ: '✓✓',
};

function MessageBubble({ message }) {
  const mine = message.fromMe;
  const failed = message.status === 'FAILED';

  const isCatalogMessage = String(message.type || '').startsWith('interactive_');
  const catalogLabel =
    message.type === 'interactive_product'
      ? 'Product card'
      : message.type === 'interactive_product_list'
        ? 'Multi-product message'
        : message.type === 'interactive_catalog'
          ? 'Catalog'
          : null;

  return (
    <div className={`bubble-row ${mine ? 'mine' : ''}`}>
      <div className={`bubble ${failed ? 'bubble-failed' : ''}`}>
        {isCatalogMessage && catalogLabel && (
          <div className="bubble-card row gap-2">
            <IconCatalog size={14} />
            {catalogLabel}
          </div>
        )}

        {message.mediaId && (
          <img
            src={api.mediaUrl(message.id)}
            alt={message.caption || 'Attachment'}
            style={{ borderRadius: 6, marginBottom: 6, maxHeight: 260, objectFit: 'cover' }}
            loading="lazy"
          />
        )}

        {message.text || message.caption || (message.mediaId ? '' : message.type)}

        <div className="bubble-meta">
          {formatTime(message.timestamp)}
          {mine && !failed && <span>{STATUS_TICK[message.status] || ''}</span>}
          {failed && <span>failed</span>}
        </div>

        {failed && message.error?.message && (
          <div className="tiny" style={{ marginTop: 4 }}>
            {message.error.message}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Inbox() {
  const { toast, toastError } = useApp();

  const [search, setSearch] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendModal, setSendModal] = useState(null);

  const debounced = useDebounced(search, 300);
  const conversations = useAsync(() => api.conversations({ search: debounced }), [debounced]);
  const bodyRef = useRef(null);

  const active = useMemo(
    () => (conversations.data || []).find((c) => c.id === activeId) || null,
    [conversations.data, activeId],
  );

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    });
  }, []);

  // ------------------------------------------------------------- messages

  const openConversation = useCallback(
    async (conversation) => {
      setActiveId(conversation.id);
      setLoadingMessages(true);
      try {
        const page = await api.messages(conversation.id, { limit: 60 });
        setMessages(page.items || []);
        scrollToBottom();

        if (conversation.unreadCount > 0) {
          await api.markRead(conversation.id);
          conversations.reload();
        }
      } catch (err) {
        toastError(err);
      } finally {
        setLoadingMessages(false);
      }
    },
    // conversations.reload is stable enough for this purpose; adding it would
    // re-create the callback on every list refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scrollToBottom, toastError],
  );

  // -------------------------------------------------------------- realtime

  useEffect(() => {
    const socket = getSocket();

    const onNewMessage = (payload) => {
      // Only append to the thread currently on screen; the list refresh below
      // handles everything else.
      setActiveId((currentId) => {
        if (payload.conversationId === currentId) {
          setMessages((current) =>
            current.some((m) => m.id === payload.message.id) ? current : [...current, payload.message],
          );
          scrollToBottom();
        }
        return currentId;
      });
      conversations.reload();
    };

    const onStatus = (payload) => {
      setMessages((current) =>
        current.map((message) =>
          message.metaMessageId === payload.metaMessageId
            ? { ...message, status: payload.status, error: payload.error }
            : message,
        ),
      );
    };

    socket.on('whatsapp:new-message', onNewMessage);
    socket.on('whatsapp:message-status', onStatus);
    socket.on('whatsapp:conversation', () => conversations.reload());

    return () => {
      socket.off('whatsapp:new-message', onNewMessage);
      socket.off('whatsapp:message-status', onStatus);
      socket.off('whatsapp:conversation');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToBottom]);

  // ----------------------------------------------------------------- send

  const send = async () => {
    const text = draft.trim();
    if (!text || !active) return;

    setSending(true);
    try {
      const message = await api.sendMessage({ to: active.phoneNumber, message: text });
      setMessages((current) => [...current, message]);
      setDraft('');
      scrollToBottom();
      conversations.reload();
    } catch (err) {
      toastError(err);
    } finally {
      setSending(false);
    }
  };

  const list = conversations.data || [];
  const windowOpen = active?.serviceWindow?.open;
  const countdown = formatCountdown(active?.serviceWindow?.expiresAt);

  return (
    <div className={`inbox ${activeId ? 'has-active' : ''}`}>
      {/* ------------------------------------------------------ thread list */}
      <aside className="thread-list">
        <div className="thread-list-head">
          <SearchInput value={search} onChange={setSearch} placeholder="Search conversations…" />
        </div>

        <div className="thread-list-body">
          {conversations.loading && !conversations.data ? (
            <Loading label="Loading conversations…" />
          ) : !list.length ? (
            <EmptyState
              icon={<IconInbox size={20} />}
              title="No conversations"
              description="Customer messages appear here as soon as your webhook receives them."
            />
          ) : (
            list.map((conversation) => (
              <button
                key={conversation.id}
                className={`thread ${conversation.id === activeId ? 'active' : ''}`}
                onClick={() => openConversation(conversation)}
              >
                <span className="avatar">{initials(conversation.name || conversation.phoneNumber)}</span>
                <span className="thread-main">
                  <span className="thread-name truncate" style={{ display: 'block' }}>
                    {conversation.name || formatPhone(conversation.phoneNumber)}
                  </span>
                  <span className="thread-preview truncate" style={{ display: 'block' }}>
                    {truncate(conversation.lastMessage || 'No messages yet', 42)}
                  </span>
                </span>
                <span className="thread-meta">
                  <span className="thread-time">{formatTime(conversation.lastMessageAt)}</span>
                  {conversation.unreadCount > 0 && (
                    <span className="unread-dot">{conversation.unreadCount}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ------------------------------------------------------------ chat */}
      <section className="chat">
        {!active ? (
          <EmptyState
            icon={<IconInbox size={22} />}
            title="Pick a conversation"
            description="Choose a customer on the left to read the history and reply."
          />
        ) : (
          <>
            <header className="chat-head">
              <Button
                variant="ghost"
                size="sm"
                className="show-sm"
                onClick={() => setActiveId(null)}
                aria-label="Back to conversations"
              >
                <IconChevronLeft size={16} />
              </Button>

              <span className="avatar">{initials(active.name || active.phoneNumber)}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="strong truncate">{active.name || formatPhone(active.phoneNumber)}</div>
                <div className="tiny muted">
                  {formatPhone(active.phoneNumber)}
                  {windowOpen && countdown && ` · window closes in ${countdown}`}
                </div>
              </div>

              <div className="row gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSendModal({ type: 'product' })}
                  title="Send a product"
                >
                  <IconBox size={14} />
                  <span className="hide-sm">Product</span>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setSendModal({ type: 'catalog' })}
                  title="Send the catalog"
                >
                  <IconLayers size={14} />
                  <span className="hide-sm">Catalog</span>
                </Button>
              </div>
            </header>

            <div className="chat-body" ref={bodyRef}>
              {loadingMessages ? (
                <Loading />
              ) : !messages.length ? (
                <div className="muted center small" style={{ margin: 'auto' }}>
                  No messages in this conversation yet.
                </div>
              ) : (
                messages.map((message) => <MessageBubble key={message.id} message={message} />)
              )}
            </div>

            {windowOpen ? (
              <div className="composer">
                <textarea
                  className="textarea"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder="Type a reply…  (Enter to send, Shift+Enter for a new line)"
                  rows={1}
                  maxLength={4096}
                />
                <Button variant="primary" onClick={send} loading={sending} disabled={!draft.trim()}>
                  <IconSend size={15} />
                </Button>
              </div>
            ) : (
              <div className="window-note">
                The 24-hour reply window has closed for this customer. WhatsApp only allows an
                approved template message until they write again.
              </div>
            )}
          </>
        )}
      </section>

      {sendModal && active && (
        <SendProductModal
          open
          onClose={() => setSendModal(null)}
          presetPhone={active.phoneNumber}
          initialMode={sendModal.type}
        />
      )}
    </div>
  );
}
