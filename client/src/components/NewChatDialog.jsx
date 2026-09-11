import { useState } from 'react';
import { IconClose } from './Icons';
import { useWa } from '../store';

/** Start a chat with any number, whether or not it is in the address book. */
export default function NewChatDialog({ onClose }) {
  const { openChatWithNumber } = useWa();
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
      const id = await openChatWithNumber(clean);
      if (!id) {
        setError('That number is not registered on WhatsApp');
        return;
      }
      onClose();
    } catch (err) {
      setError(err.message);
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
