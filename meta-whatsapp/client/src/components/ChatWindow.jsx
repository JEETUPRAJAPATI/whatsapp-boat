import { useState } from 'react';
import Avatar from './Avatar';
import Composer from './Composer';
import ContactPanel from './ContactPanel';
import MediaLightbox from './MediaLightbox';
import MessageList from './MessageList';
import { IconBack, IconMore } from './Icons';
import { phoneOf } from '../lib/format';
import { useWa } from '../store';

export default function ChatWindow() {
  const { activeConversation, thread, closeConversation, sendMessage, notify } = useWa();
  const [infoOpen, setInfoOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  if (!activeConversation) return null;

  const name = activeConversation.name || phoneOf(activeConversation.phoneNumber);

  /** Re-sends the text of a message Meta rejected. */
  const retry = async (message) => {
    if (!message.text) return;
    try {
      await sendMessage(message.text);
    } catch {
      // sendMessage already surfaced the reason.
    }
  };

  return (
    <>
      <section className="chat-window">
        <header className="chat-header">
          <button className="icon-btn back-btn" onClick={closeConversation} title="Back">
            <IconBack />
          </button>

          <div className="chat-header-id" onClick={() => setInfoOpen(true)}>
            <Avatar id={activeConversation.phoneNumber} name={name} size={40} />
            <div>
              <strong>{name}</strong>
              <span>
                {phoneOf(activeConversation.phoneNumber)}
                {activeConversation.status === 'CLOSED' ? ' · Closed' : ''}
                {activeConversation.assignedTo ? ` · ${activeConversation.assignedTo}` : ''}
              </span>
            </div>
          </div>

          <div className="chat-header-actions">
            <button
              className="icon-btn"
              onClick={() => setInfoOpen((v) => !v)}
              title="Customer info"
            >
              <IconMore />
            </button>
          </div>
        </header>

        <MessageList
          conversationId={activeConversation.id}
          thread={thread}
          onRetry={retry}
          onOpenMedia={setLightbox}
        />

        <Composer conversation={activeConversation} />
      </section>

      {lightbox && <MediaLightbox url={lightbox} onClose={() => setLightbox(null)} />}

      {infoOpen && (
        <ContactPanel conversation={activeConversation} onClose={() => setInfoOpen(false)} />
      )}
    </>
  );
}
