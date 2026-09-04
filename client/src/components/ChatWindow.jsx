import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import MessageList from './MessageList';
import Composer from './Composer';
import ContactPanel from './ContactPanel';
import MediaLightbox from './MediaLightbox';
import ForwardDialog from './ForwardDialog';
import { IconBack, IconMore, IconSearch, IconClose } from './Icons';
import { phoneOf, clockTime, previewOf } from '../lib/format';
import { api } from '../lib/api';
import { useWa } from '../store';

export default function ChatWindow() {
  const { activeChat, activeThread, selectChat, runChatAction, notify } = useWa();
  const [showInfo, setShowInfo] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [forwarding, setForwarding] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);

  useEffect(() => {
    setShowInfo(false);
    setSearching(false);
    setSearchQuery('');
    setResults([]);
  }, [activeChat && activeChat.id]);

  useEffect(() => {
    const close = () => setMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  useEffect(() => {
    if (!searching || searchQuery.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      try {
        const res = await api.search(searchQuery.trim(), activeChat.id);
        setResults(res.messages || []);
      } catch (err) {
        notify(err.message, 'error');
      }
    }, 350);
    return () => clearTimeout(id);
  }, [searchQuery, searching, activeChat, notify]);

  if (!activeChat) return null;

  const subtitle = activeChat.isGroup
    ? `${activeChat.participantCount || (activeChat.participants || []).length} participants`
    : phoneOf(activeChat.id);

  return (
    <section className="chat-window">
      <header className="chat-header">
        <button className="icon-btn only-mobile" onClick={() => selectChat(null)} title="Back">
          <IconBack />
        </button>
        <div className="chat-header-id" onClick={() => setShowInfo(true)} role="button" tabIndex={0}>
          <Avatar id={activeChat.id} name={activeChat.name} isGroup={activeChat.isGroup} size={40} />
          <div>
            <strong>{activeChat.name || activeChat.id.split('@')[0]}</strong>
            <span>{subtitle}</span>
          </div>
        </div>

        <div className="chat-header-actions">
          <button className="icon-btn" title="Search in chat" onClick={() => setSearching((v) => !v)}>
            <IconSearch />
          </button>
          <button
            className="icon-btn"
            title="Menu"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          >
            <IconMore />
          </button>
          {menuOpen && (
            <div className="menu menu-header" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setShowInfo(true); setMenuOpen(false); }}>
                {activeChat.isGroup ? 'Group info' : 'Contact info'}
              </button>
              <button onClick={() => { runChatAction(activeChat.id, 'markUnread'); setMenuOpen(false); }}>
                Mark as unread
              </button>
              <button
                onClick={() => {
                  const until = activeChat.isMuted ? 0 : Math.floor(Date.now() / 1000) + 31536000;
                  runChatAction(activeChat.id, 'mute', until);
                  setMenuOpen(false);
                }}
              >
                {activeChat.isMuted ? 'Unmute notifications' : 'Mute notifications'}
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (window.confirm('Clear all messages in this chat?')) {
                    runChatAction(activeChat.id, 'clear');
                  }
                  setMenuOpen(false);
                }}
              >
                Clear messages
              </button>
            </div>
          )}
        </div>
      </header>

      {searching && (
        <div className="chat-search">
          <IconSearch width={17} height={17} />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search in this chat"
          />
          <button
            className="icon-btn tiny"
            onClick={() => {
              setSearching(false);
              setSearchQuery('');
            }}
          >
            <IconClose width={16} height={16} />
          </button>
        </div>
      )}

      {searching && searchQuery.trim().length >= 2 ? (
        <div className="search-results">
          {results.length === 0 ? (
            <p className="search-empty">No messages found</p>
          ) : (
            results.map((m) => (
              <div
                key={m.id}
                className="search-result"
                onClick={() => {
                  const node = document.getElementById(`msg-${m.id}`);
                  if (node) {
                    setSearching(false);
                    setTimeout(() => node.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
                  } else {
                    notify('Load older messages to jump to this result');
                  }
                }}
              >
                <div className="search-result-top">
                  <strong>{m.fromMe ? 'You' : m.notifyName || phoneOf(m.author || m.from)}</strong>
                  <span>{clockTime(m.timestamp)}</span>
                </div>
                <p>{previewOf(m)}</p>
              </div>
            ))
          )}
        </div>
      ) : (
        <MessageList
          chat={activeChat}
          thread={activeThread}
          onOpenMedia={setLightbox}
          onForward={setForwarding}
        />
      )}

      <Composer chatId={activeChat.id} />

      {showInfo && <ContactPanel chat={activeChat} onClose={() => setShowInfo(false)} />}
      {lightbox && <MediaLightbox message={lightbox} onClose={() => setLightbox(null)} />}
      {forwarding && (
        <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />
      )}
    </section>
  );
}
