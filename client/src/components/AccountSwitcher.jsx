import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import { useWa } from '../store';
import { IconPlus, IconChevronDown } from './Icons';

const labelFor = (account) => {
  const me = account.me || {};
  return account.label || me.pushname || (me.number ? `+${me.number}` : 'New account');
};

/**
 * Swaps the sidebar between linked accounts. Unread counts come from the
 * store's per-account slices, so a number you are not currently reading still
 * shows its badge here.
 */
export default function AccountSwitcher({ onManage }) {
  const { accounts, activeId, account, unreadByAccount, selectAccount } = useWa();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!rootRef.current || !rootRef.current.contains(e.target)) setOpen(false);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  if (!account) return null;

  const otherUnread = accounts.reduce(
    (sum, a) => (a.sessionId === activeId ? sum : sum + (unreadByAccount[a.sessionId] || 0)),
    0
  );

  return (
    <div className="account-switcher" ref={rootRef}>
      <button
        className="account-switcher-trigger"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="Switch account"
      >
        <Avatar
          id={account.me && account.me.id}
          name={labelFor(account)}
          size={26}
          sessionId={account.connected ? account.sessionId : undefined}
        />
        <span className="account-switcher-name">
          <small>Account</small>
          <strong>{labelFor(account)}</strong>
        </span>
        {otherUnread > 0 && <span className="tab-badge">{otherUnread}</span>}
        <IconChevronDown width={16} height={16} className="account-switcher-caret" />
      </button>

      {open && (
        <div className="menu account-menu" onClick={(e) => e.stopPropagation()}>
          <p className="menu-title">Your accounts</p>
          {accounts.map((a) => {
            const unread = unreadByAccount[a.sessionId] || 0;
            return (
              <button
                key={a.sessionId}
                className={`account-menu-row ${a.sessionId === activeId ? 'active' : ''}`}
                onClick={() => {
                  selectAccount(a.sessionId);
                  setOpen(false);
                }}
              >
                <Avatar
                  id={a.me && a.me.id}
                  name={labelFor(a)}
                  size={32}
                  sessionId={a.connected ? a.sessionId : undefined}
                />
                <span className="account-menu-meta">
                  <strong>{labelFor(a)}</strong>
                  <small>
                    <span className={`state-dot ${a.connected ? 'ok' : 'idle'}`} />
                    {a.connected ? 'Connected' : a.state === 'QR' ? 'Needs scan' : 'Offline'}
                  </small>
                </span>
                {unread > 0 && <span className="tab-badge">{unread}</span>}
              </button>
            );
          })}
          <button
            className="account-menu-add"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <IconPlus width={16} height={16} /> Add or manage accounts
          </button>
        </div>
      )}
    </div>
  );
}
