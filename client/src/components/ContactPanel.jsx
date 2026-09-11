import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import { IconClose } from './Icons';
import { phoneOf } from '../lib/format';
import { useWa } from '../store';

/** Right-hand drawer showing contact details or the group roster. */
export default function ContactPanel({ chat, onClose }) {
  const { contactIndex, openChatWithContact, api } = useWa();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  // The chat list ships only a participant count - the roster itself is
  // fetched here, for the one group actually being looked at.
  const [roster, setRoster] = useState(chat.participants || []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .contact(chat.id)
      .then((data) => alive && setInfo(data))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [chat.id, api]);

  useEffect(() => {
    let alive = true;
    setRoster(chat.participants || []);
    if (!chat.isGroup || (chat.participants && chat.participants.length)) return undefined;
    api
      .chat(chat.id)
      .then((full) => alive && setRoster((full && full.participants) || []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [chat.id, chat.isGroup, chat.participants, api]);

  const participants = roster;

  return (
    <aside className="info-panel">
      <header className="info-header">
        <button className="icon-btn" onClick={onClose} title="Close">
          <IconClose />
        </button>
        <strong>{chat.isGroup ? 'Group info' : 'Contact info'}</strong>
      </header>

      <div className="info-hero">
        <Avatar id={chat.id} name={chat.name} isGroup={chat.isGroup} size={160} />
        <h2>{chat.name || chat.id.split('@')[0]}</h2>
        <p>
          {chat.isGroup
            ? `${participants.length || chat.participantCount || 0} participants`
            : phoneOf(chat.id)}
        </p>
      </div>

      {!chat.isGroup && (
        <div className="info-block">
          <span className="info-label">About</span>
          <p className="info-value">
            {loading ? 'Loading...' : (info && info.about) || 'No status available'}
          </p>
        </div>
      )}

      {chat.isGroup && chat.groupMetadata && chat.groupMetadata.description && (
        <div className="info-block">
          <span className="info-label">Description</span>
          <p className="info-value">{chat.groupMetadata.description}</p>
        </div>
      )}

      {!chat.isGroup && info && Array.isArray(info.commonGroups) && info.commonGroups.length > 0 && (
        <div className="info-block">
          <span className="info-label">Groups in common</span>
          <p className="info-value">{info.commonGroups.length}</p>
        </div>
      )}

      {chat.isGroup && (
        <div className="info-block">
          <span className="info-label">{participants.length} participants</span>
          <div className="participant-list">
            {participants.map((p) => {
              const contact = contactIndex.get(p.id);
              const name = (contact && contact.displayName) || phoneOf(p.id);
              return (
                <div
                  key={p.id}
                  className="participant"
                  role="button"
                  tabIndex={0}
                  onClick={() => openChatWithContact(contact || { id: p.id, displayName: name })}
                >
                  <Avatar id={p.id} name={name} size={40} />
                  <div className="participant-body">
                    <strong>{name}</strong>
                    <span>{phoneOf(p.id)}</span>
                  </div>
                  {(p.isSuperAdmin || p.isAdmin) && (
                    <span className="admin-tag">{p.isSuperAdmin ? 'Owner' : 'Admin'}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
