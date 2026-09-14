import { useEffect, useLayoutEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import { dayLabel, sameDay } from '../lib/format';
import { useWa } from '../store';

export default function MessageList({ conversationId, thread, onRetry, onOpenMedia }) {
  const { loadMessages } = useWa();
  const scrollerRef = useRef(null);
  const bottomRef = useRef(null);
  const stickToBottom = useRef(true);
  const prevHeight = useRef(0);
  const prevConversation = useRef(null);

  const items = thread.items;
  const lastId = items.length ? items[items.length - 1].id : null;

  /* Opening a conversation always starts at the newest message. */
  useLayoutEffect(() => {
    if (prevConversation.current !== conversationId) {
      prevConversation.current = conversationId;
      stickToBottom.current = true;
      requestAnimationFrame(() => {
        const el = scrollerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [conversationId, items.length]);

  /* Follow new messages only when the reader is already near the bottom. */
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
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (el.scrollTop < 80 && thread.hasMore && !thread.loading) {
      loadMessages(conversationId, { older: true });
    }
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
        <p>No messages in this conversation yet.</p>
      </div>
    );
  }

  return (
    <div className="messages" ref={scrollerRef} onScroll={onScroll}>
      {thread.hasMore && (
        <div className="load-older">
          <button
            onClick={() => loadMessages(conversationId, { older: true })}
            disabled={thread.loading}
          >
            {thread.loading ? 'Loading...' : 'Load older messages'}
          </button>
        </div>
      )}

      {items.map((message, i) => {
        const prev = items[i - 1];
        const newDay = !prev || !sameDay(prev.timestamp, message.timestamp);
        return (
          <div key={message.id}>
            {newDay && (
              <div className="day-divider">
                <span>{dayLabel(message.timestamp)}</span>
              </div>
            )}
            <MessageBubble message={message} onRetry={onRetry} onOpenMedia={onOpenMedia} />
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
