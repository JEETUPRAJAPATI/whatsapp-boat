import { useMemo, useState } from 'react';
import Avatar from './Avatar';
import { IconClose, IconSearch } from './Icons';
import { previewOf } from '../lib/format';
import { api } from '../lib/api';
import { useWa } from '../store';

export default function ForwardDialog({ message, onClose }) {
  const { chats, notify } = useWa();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);
  const [sending, setSending] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => (c.name || c.id).toLowerCase().includes(q));
  }, [chats, query]);

  const toggle = (id) =>
    setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const send = async () => {
    setSending(true);
    let ok = 0;
    for (const chatId of selected) {
      try {
        await api.forward(message.id, chatId);
        ok += 1;
      } catch (err) {
        notify(`Forward failed: ${err.message}`, 'error');
      }
    }
    setSending(false);
    if (ok) notify(`Forwarded to ${ok} chat${ok > 1 ? 's' : ''}`);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <strong>Forward message</strong>
          <button className="icon-btn" onClick={onClose}>
            <IconClose />
          </button>
        </header>

        <div className="modal-preview">{previewOf(message)}</div>

        <div className="sidebar-search inline">
          <span className="search-icon">
            <IconSearch width={16} height={16} />
          </span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" />
        </div>

        <div className="modal-list">
          {filtered.map((c) => (
            <label key={c.id} className={`forward-row ${selected.includes(c.id) ? 'on' : ''}`}>
              <input
                type="checkbox"
                checked={selected.includes(c.id)}
                onChange={() => toggle(c.id)}
              />
              <Avatar id={c.id} name={c.name} isGroup={c.isGroup} size={40} />
              <span>{c.name || c.id.split('@')[0]}</span>
            </label>
          ))}
        </div>

        <footer className="modal-footer">
          <span>{selected.length} selected</span>
          <button className="btn-primary" disabled={!selected.length || sending} onClick={send}>
            {sending ? 'Forwarding...' : 'Forward'}
          </button>
        </footer>
      </div>
    </div>
  );
}
