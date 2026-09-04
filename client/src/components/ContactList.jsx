import { useMemo } from 'react';
import Avatar from './Avatar';
import { phoneOf } from '../lib/format';
import { useWa } from '../store';

/** Groups contacts under A-Z headers, with non-alphabetic names under '#'. */
function bucket(contacts) {
  const groups = new Map();
  for (const c of contacts) {
    const name = c.displayName || c.number || '';
    const first = name.trim().charAt(0).toUpperCase();
    const key = /[A-Z]/.test(first) ? first : '#';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === '#') return 1;
    if (b[0] === '#') return -1;
    return a[0].localeCompare(b[0]);
  });
}

export default function ContactList({ contacts }) {
  const { openChatWithContact } = useWa();
  const sections = useMemo(() => bucket(contacts), [contacts]);

  if (!contacts.length) {
    return (
      <div className="list-empty">
        <p>No contacts found</p>
      </div>
    );
  }

  return (
    <div className="contact-list">
      {sections.map(([letter, items]) => (
        <div key={letter} className="contact-section">
          <div className="contact-section-head">{letter}</div>
          {items.map((c) => (
            <div
              key={c.id}
              className="chat-row"
              role="button"
              tabIndex={0}
              onClick={() => openChatWithContact(c)}
              onKeyDown={(e) => e.key === 'Enter' && openChatWithContact(c)}
            >
              <Avatar id={c.id} name={c.displayName} isGroup={c.isGroup} />
              <div className="chat-row-body">
                <div className="chat-row-top">
                  <span className="chat-row-name">{c.displayName}</span>
                </div>
                <div className="chat-row-bottom">
                  <span className="chat-row-preview">
                    {c.isGroup ? 'Group' : phoneOf(c.id)}
                    {c.isBusiness ? ' · Business' : ''}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
