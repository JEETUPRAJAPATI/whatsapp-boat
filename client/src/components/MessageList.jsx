import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import MessageBubble from './MessageBubble';
import { dayLabel, sameDay } from '../lib/format';
import { useWa } from '../store';

export default function MessageList({ chat, thread, onOpenMedia, onForward }) {
  const { contactIndex, setReplyTo, deleteMessage, reactTo, loadMessages, notify } = useWa();
  const scrollerRef = useRef(null);
  const bottomRef = useRef(null);
  const [highlight, setHighlight] = useState(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef(0);
  const prevChatId = useRef(null);

  const items = thread.items;
  const lastId = items.length ? items[items.length - 1].id : null;

  /* Jumping chats always starts at the newest message. */
  useLayoutEffect(() => {
    if (prevChatId.current !== chat.id) {
      prevChatId.current = chat.id;
      stickToBottom.current = true;
      requestAnimationFrame(() => {
        const el = scrollerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [chat.id, items.length]);

  /* Follow new messages only when the user is already near the bottom. */
  useEffect(() => {
    if (stickToBottom.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ block: 'end' });
    }
  }, [lastId]);

  /* Keep the viewport anchored when older messages are prepended. */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (prevHeight.current && el.scrollHeight > prevHeight.current && el.scrollTop < 120) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    }
    prevHeight.current = el.scrollHeight;
  }, [items.length]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottom.current = distanceFromBottom < 140;
    if (el.scrollTop < 80 && thread.hasMore && !thread.loading) {
      loadMessages(chat.id, { older: true });
    }
  };

  const jumpTo = (messageId) => {
    const node = document.getElementById(`msg-${messageId}`);
    if (!node) {
      notify('Original message is further up - scroll to load it');
      return;
    }
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlight(messageId);
    setTimeout(() => setHighlight(null), 1600);
  };

  if (!items.length && thread.loading) {
    return (
      <div className="messages-empty">
        <div className="spinner" />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="messages-empty">
        <p>No messages yet. Say hello.</p>
      </div>
    );
  }

  return (
    <div className="messages" ref={scrollerRef} onScroll={onScroll}>
      {thread.hasMore && (
        <div className="load-older">
          <button onClick={() => loadMessages(chat.id, { older: true })} disabled={thread.loading}>
            {thread.loading ? 'Loading...' : 'Load older messages'}
          </button>
        </div>
      )}

      {items.map((message, i) => {
        const prev = items[i - 1];
        const newDay = !prev || !sameDay(prev.timestamp, message.timestamp);
        const showAuthor =
          !prev || newDay || prev.fromMe !== message.fromMe || (prev.author || prev.from) !== (message.author || message.from);

        return (
          <div key={message.id} id={`msg-${message.id}`} className={highlight === message.id ? 'highlighted' : ''}>
            {newDay && <div className="day-divider"><span>{dayLabel(message.timestamp)}</span></div>}
            <MessageBubble
              message={message}
              showAuthor={showAuthor}
              isGroup={!!chat.isGroup}
              contactIndex={contactIndex}
              onOpenMedia={onOpenMedia}
              onReply={setReplyTo}
              onReact={reactTo}
              onDelete={deleteMessage}
              onForward={onForward}
              onStar={(m) =>
                api
                  .star(m.id, !m.isStarred)
                  .then(() => notify(m.isStarred ? 'Removed from starred' : 'Added to starred'))
                  .catch((e) => notify(e.message, 'error'))
              }
              onJumpTo={jumpTo}
            />
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
