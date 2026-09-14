import { useMemo, useState } from 'react';
import Avatar from './Avatar';
import { IconLogout, IconRefresh, IconSearch } from './Icons';
import { listTime, phoneOf } from '../lib/format';
import { useWa } from '../store';

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'UNREAD', label: 'Unread' },
  { key: 'OPEN', label: 'Open' },
  { key: 'CLOSED', label: 'Closed' },
];

function ConversationRow({ conversation, active, onOpen }) {
  const name = conversation.name || phoneOf(conversation.phoneNumber);
  const unread = conversation.unreadCount > 0;

  return (
    <div
      className={`chat-row ${active ? 'active' : ''} ${unread ? 'is-unread' : ''}`}
      onClick={() => onOpen(conversation.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(conversation.id)}
    >
      <Avatar id={conversation.phoneNumber} name={name} />
      <div className="chat-row-body">
        <div className="chat-row-top">
          <span className="chat-row-name">{name}</span>
          <span className={`chat-row-time ${unread ? 'unread' : ''}`}>
            {listTime(conversation.lastMessageAt)}
          </span>
        </div>
        <div className="chat-row-bottom">
          <span className="chat-row-preview">{conversation.lastMessage || 'No messages yet'}</span>
          <span className="chat-row-badges">
            {conversation.status === 'CLOSED' && <span className="pill-tag">Closed</span>}
            {conversation.assignedTo && <span className="pill-tag">Assigned</span>}
            {unread && <span className="unread-badge">{conversation.unreadCount}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const {
    conversations,
    loadingConversations,
    loadConversations,
    activeId,
    selectConversation,
    search,
    setSearch,
    user,
    logout,
    metaStatus,
    socketLive,
    authRequired,
  } = useWa();

  const [filter, setFilter] = useState('ALL');

  const visible = useMemo(() => {
    if (filter === 'UNREAD') return conversations.filter((c) => c.unreadCount > 0);
    if (filter === 'OPEN') return conversations.filter((c) => c.status !== 'CLOSED');
    if (filter === 'CLOSED') return conversations.filter((c) => c.status === 'CLOSED');
    return conversations;
  }, [conversations, filter]);

  const unreadTotal = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="sidebar-me">
          <strong>{(user && user.name) || 'Inbox'}</strong>
          <span>
            <i className={`conn-dot ${socketLive ? '' : 'off'}`} />
            {socketLive ? 'Live' : 'Reconnecting'}
            {metaStatus.phoneNumberId ? ` · ${metaStatus.phoneNumberId}` : ''}
          </span>
        </div>
        <div className="sidebar-header-actions">
          <button
            className="icon-btn"
            title="Refresh conversations"
            onClick={() => loadConversations(search)}
          >
            <IconRefresh />
          </button>
          {authRequired && (
            <button className="icon-btn" title="Sign out" onClick={logout}>
              <IconLogout />
            </button>
          )}
        </div>
      </header>

      <div className="sidebar-search">
        <IconSearch className="search-icon" width={18} height={18} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, number or message"
          aria-label="Search conversations"
        />
      </div>

      <nav className="sidebar-tabs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={filter === f.key ? 'active' : ''}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            {f.key === 'UNREAD' && unreadTotal > 0 && <span className="tab-badge">{unreadTotal}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-list">
        {visible.length === 0 ? (
          <div className="list-empty">
            {loadingConversations ? (
              <div className="spinner small" />
            ) : (
              <p>
                {search
                  ? 'No conversations match that search'
                  : 'No conversations yet. They appear here as soon as a customer messages your WhatsApp number.'}
              </p>
            )}
          </div>
        ) : (
          visible.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeId}
              onOpen={selectConversation}
            />
          ))
        )}
      </div>
    </aside>
  );
}
