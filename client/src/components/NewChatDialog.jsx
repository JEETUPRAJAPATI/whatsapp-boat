import { useState } from 'react';
import { IconClose } from './Icons';
import { api } from '../lib/api';
import { useWa } from '../store';

/** Start a chat with any number, whether or not it is in the address book. */
export default function NewChatDialog({ onClose }) {
  const { openChatWithContact, notify } = useWa();
  const [number, setNumber] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(null);

  const start = async () => {
    const clean = number.replace(/[^0-9]/g, '');
    if (clean.length < 8) {
      setError('Enter the full number including country code');
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const { id, registered } = await api.resolveNumber(clean);
      if (!registered || !id) {
        setError('That number is not registered on WhatsApp');
        return;
      }
      await openChatWithContact({ id, displayName: `+${clean}`, number: clean });
      onClose();
    } catch (err) {
      setError(err.message);
      notify(err.message, 'error');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <strong>New chat</strong>
          <button className="icon-btn" onClick={onClose}>
            <IconClose />
          </button>
        </header>

        <div className="modal-body">
          <label className="field">
            <span>Phone number with country code</span>
            <input
              autoFocus
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && start()}
              placeholder="91 98765 43210"
            />
          </label>
          {error && <p className="field-error">{error}</p>}
        </div>

        <footer className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={start} disabled={checking}>
            {checking ? 'Checking...' : 'Start chat'}
          </button>
        </footer>
      </div>
    </div>
  );
}
