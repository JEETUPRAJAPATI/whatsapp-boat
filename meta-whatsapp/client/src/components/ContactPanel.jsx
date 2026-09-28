import { useState } from 'react';
import Avatar from './Avatar';
import { IconClose } from './Icons';
import { fullDate, phoneOf, windowRemaining } from '../lib/format';
import { useWa } from '../store';

export default function ContactPanel({ conversation, onClose }) {
  const { patchConversation } = useWa();
  const [busy, setBusy] = useState(false);

  const name = conversation.name || phoneOf(conversation.phoneNumber);
  const windowState = conversation.serviceWindow || { open: false };

  const run = async (patch) => {
    setBusy(true);
    try {
      await patchConversation(conversation.id, patch);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="info-panel">
      <header className="info-header">
        <button className="icon-btn" onClick={onClose} title="Close">
          <IconClose />
        </button>
        <strong>Customer info</strong>
      </header>

      <div className="info-hero">
        <Avatar id={conversation.phoneNumber} name={name} size={110} />
        <h2>{name}</h2>
        <p>{phoneOf(conversation.phoneNumber)}</p>
      </div>

      <div className="info-block">
        <span className="info-label">WhatsApp profile name</span>
        <span className="info-value">{conversation.profileName || 'Not shared'}</span>
      </div>

      <div className="info-block">
        <span className="info-label">First seen</span>
        <span className="info-value">
          {fullDate(conversation.customer && conversation.customer.createdAt)}
        </span>
      </div>

      <div className="info-block">
        <span className="info-label">Last message</span>
        <span className="info-value">{fullDate(conversation.lastMessageAt)}</span>
      </div>

      <div className="info-block">
        <span className="info-label">Service window</span>
        <span className="info-value">
          {windowState.open
            ? `Open · ${windowRemaining(windowState.expiresAt)}`
            : 'Closed · template messages only'}
        </span>
      </div>

      <div className="info-block">
        <span className="info-label">Status</span>
        <span className="info-value">{conversation.status}</span>
      </div>

      <div className="info-block">
        <span className="info-label">Assigned to</span>
        <span className="info-value">{conversation.assignedTo || 'Unassigned'}</span>
      </div>

      <div className="info-actions">
        {conversation.status === 'CLOSED' ? (
          <button className="btn-ghost" disabled={busy} onClick={() => run({ status: 'OPEN' })}>
            Reopen conversation
          </button>
        ) : (
          <button className="btn-ghost" disabled={busy} onClick={() => run({ status: 'CLOSED' })}>
            Close conversation
          </button>
        )}
      </div>
    </aside>
  );
}
