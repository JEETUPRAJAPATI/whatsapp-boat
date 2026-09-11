import { useEffect, useMemo, useRef, useState } from 'react';
import Avatar from './Avatar';
import ChatList from './ChatList';
import ContactList from './ContactList';
import AccountSwitcher from './AccountSwitcher';
import {
  IconSearch,
  IconChats,
  IconContacts,
  IconLogout,
  IconRefresh,
  IconClose,
  IconMore,
} from './Icons';
import { useWa } from '../store';

// Accounts with thousands of chats would otherwise mount thousands of rows at
// once; render a window and extend it as the list is scrolled.
const PAGE_SIZE = 60;

export default function Sidebar({ onOpenNewChat, onManageAccounts }) {
  const {
    status,
    chats,
    contacts,
    loadChats,
    loadContacts,
    logout,
    runChatAction,
    notify,
    openChatWithNumber,
  } = useWa();
  const [tab, setTab] = useState('chats');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [menu, setMenu] = useState(null); // { chat, x, y }
  const [headerMenu, setHeaderMenu] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dialling, setDialling] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const close = () => {
      setMenu(null);
      setHeaderMenu(false);
    };
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
    };
  }, []);

  const digits = useMemo(() => query.replace(/[^0-9]/g, ''), [query]);

  const filteredChats = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => {
      const name = (c.name || '').toLowerCase();
      const body = ((c.lastMessage && c.lastMessage.body) || '').toLowerCase();
      if (name.includes(q) || body.includes(q)) return true;
      if (!digits) return false;
      // Group and newer personal chats are keyed by an @lid alias, so the real
      // phone number is only ever in the display name - search both.
      return c.id.split('@')[0].includes(digits) || name.replace(/[^0-9]/g, '').includes(digits);
    });
  }, [chats, query, digits]);

  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      const name = (c.displayName || '').toLowerCase();
      if (name.includes(q)) return true;
      if (!digits) return false;
      return (
        (c.number || '').includes(digits) ||
        c.id.split('@')[0].includes(digits) ||
        name.replace(/[^0-9]/g, '').includes(digits)
      );
    });
  }, [contacts, query, digits]);

  // A new tab or a new search starts the window over.
  useEffect(() => setVisible(PAGE_SIZE), [tab, query]);

  const total = tab === 'chats' ? filteredChats.length : filteredContacts.length;

  const onListScroll = (e) => {
    const el = e.currentTarget;
    if (visible >= total) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) {
      setVisible((v) => Math.min(v + PAGE_SIZE, total));
    }
  };

  const refresh = async () => {
    setSyncing(true);
    await Promise.all([loadChats(), loadContacts()]);
    setSyncing(false);
    notify('Synced with WhatsApp');
  };

  const totalUnread = chats.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  return (
    <aside className="sidebar" ref={rootRef}>
      <header className="sidebar-header">
        <Avatar
          id={status.me && status.me.id}
          name={status.label || (status.me && status.me.pushname)}
          size={40}
        />
        <div className="sidebar-me">
          <strong>{status.label || (status.me && status.me.pushname) || 'You'}</strong>
          <span>{status.me && status.me.number ? `+${status.me.number}` : ''}</span>
        </div>
        <div className="sidebar-header-actions">
          <button className="icon-btn" title="Sync" onClick={refresh} disabled={syncing}>
            <IconRefresh className={syncing ? 'spin' : ''} />
          </button>
          <button
            className="icon-btn"
            title="Menu"
            onClick={(e) => {
              e.stopPropagation();
              setHeaderMenu((v) => !v);
            }}
          >
            <IconMore />
          </button>
          {headerMenu && (
            <div className="menu menu-header" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => {
                  setHeaderMenu(false);
                  onOpenNewChat();
                }}
              >
                New chat by number
              </button>
              <button
                onClick={() => {
                  setHeaderMenu(false);
                  onManageAccounts();
                }}
              >
                Add or manage accounts
              </button>
              <button
                onClick={() => {
                  setHeaderMenu(false);
                  refresh();
                }}
              >
                Resync chats and contacts
              </button>
              <button
                className="danger"
                onClick={() => {
                  setHeaderMenu(false);
                  if (
                    window.confirm(
                      'Log out of this account? You will need to scan its QR code again.'
                    )
                  ) {
                    logout();
                  }
                }}
              >
                <IconLogout width={16} height={16} /> Log out
              </button>
            </div>
          )}
        </div>
      </header>

      <AccountSwitcher onManage={onManageAccounts} />

      <div className="sidebar-search">
        <span className="search-icon">
          <IconSearch width={17} height={17} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tab === 'chats' ? 'Search or start a new chat' : 'Search contacts'}
        />
        {query && (
          <button className="icon-btn tiny" onClick={() => setQuery('')} title="Clear">
            <IconClose width={16} height={16} />
          </button>
        )}
      </div>

      <nav className="sidebar-tabs">
        <button className={tab === 'chats' ? 'active' : ''} onClick={() => setTab('chats')}>
          <IconChats width={17} height={17} /> Chats
          {totalUnread > 0 && <span className="tab-badge">{totalUnread}</span>}
        </button>
        <button className={tab === 'contacts' ? 'active' : ''} onClick={() => setTab('contacts')}>
          <IconContacts width={17} height={17} /> Contacts
          <span className="tab-count">{contacts.length}</span>
        </button>
      </nav>

      <div className="sidebar-list" onScroll={onListScroll}>
        {digits.length >= 8 && (
          <button
            className="dial-row"
            disabled={dialling}
            onClick={async () => {
              setDialling(true);
              const id = await openChatWithNumber(digits);
              setDialling(false);
              if (id) setQuery('');
            }}
          >
            <span className="dial-row-icon">
              <IconChats width={20} height={20} />
            </span>
            <span className="dial-row-body">
              <strong>Message +{digits}</strong>
              <small>{dialling ? 'Checking WhatsApp...' : 'Start a chat with this number'}</small>
            </span>
          </button>
        )}
        {tab === 'chats' ? (
          <ChatList
            chats={filteredChats.slice(0, visible)}
            onMenu={(chat, pos) => setMenu({ chat, ...pos })}
          />
        ) : (
          <ContactList contacts={filteredContacts.slice(0, visible)} />
        )}
        {total > visible && (
          <div className="list-more">
            <button onClick={() => setVisible((v) => Math.min(v + PAGE_SIZE * 4, total))}>
              Showing {visible} of {total.toLocaleString()} &middot; load more
            </button>
          </div>
        )}
      </div>

      {menu && (
        <div
          className="menu menu-context"
          style={{ top: Math.min(menu.y, window.innerHeight - 260), left: Math.min(menu.x, 300) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { runChatAction(menu.chat.id, 'pin', !menu.chat.isPinned); setMenu(null); }}>
            {menu.chat.isPinned ? 'Unpin chat' : 'Pin chat'}
          </button>
          <button onClick={() => { runChatAction(menu.chat.id, 'archive', !menu.chat.isArchived); setMenu(null); }}>
            {menu.chat.isArchived ? 'Unarchive chat' : 'Archive chat'}
          </button>
          <button
            onClick={() => {
              // Mute for a year - WhatsApp's own "always" option.
              const until = menu.chat.isMuted ? 0 : Math.floor(Date.now() / 1000) + 31536000;
              runChatAction(menu.chat.id, 'mute', until);
              setMenu(null);
            }}
          >
            {menu.chat.isMuted ? 'Unmute notifications' : 'Mute notifications'}
          </button>
          <button onClick={() => { runChatAction(menu.chat.id, 'markUnread'); setMenu(null); }}>
            Mark as unread
          </button>
          <button
            className="danger"
            onClick={() => {
              if (window.confirm('Clear all messages in this chat?')) {
                runChatAction(menu.chat.id, 'clear');
              }
              setMenu(null);
            }}
          >
            Clear messages
          </button>
          <button
            className="danger"
            onClick={() => {
              if (window.confirm('Delete this chat?')) runChatAction(menu.chat.id, 'delete');
              setMenu(null);
            }}
          >
            Delete chat
          </button>
        </div>
      )}
    </aside>
  );
}
