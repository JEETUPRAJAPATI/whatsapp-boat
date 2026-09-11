import { useState } from 'react';
import Avatar from './Avatar';
import LinkDialog from './LinkDialog';
import { useWa } from '../store';
import { IconPlus, IconRefresh, IconLogout, IconChats } from './Icons';

const STATE_TEXT = {
  READY: 'Connected',
  QR: 'Waiting for scan',
  INITIALIZING: 'Starting...',
  AUTHENTICATED: 'Syncing...',
  AUTH_FAILURE: 'Sign-in failed',
  DISCONNECTED: 'Not connected',
};

function stateClass(account) {
  if (account.connected) return 'ok';
  if (account.state === 'QR') return 'warn';
  if (account.state === 'AUTH_FAILURE' || account.injectionBroken) return 'bad';
  return 'idle';
}

const BUSY_STATES = ['INITIALIZING', 'AUTHENTICATED'];

function AccountCard({ account, unread, onOpen, onScan }) {
  const { removeAccount, renameAccount, restartAccount, logout } = useWa();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(account.label || '');

  const me = account.me || {};
  const title = account.label || me.pushname || (me.number ? `+${me.number}` : 'New account');
  const subtitle = me.number ? `+${me.number}` : 'Not linked yet';

  const busy = BUSY_STATES.includes(account.state);

  const saveName = async () => {
    setRenaming(false);
    if (draft.trim() !== (account.label || '')) await renameAccount(account.sessionId, draft.trim());
  };

  return (
    <article className={`account-card ${account.connected ? 'is-live' : ''}`}>
      <div className="account-card-top">
        <Avatar
          id={me.id}
          name={title}
          size={54}
          sessionId={account.connected ? account.sessionId : undefined}
        />
        <div className="account-card-id">
          {renaming ? (
            <input
              className="account-rename"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName();
                if (e.key === 'Escape') setRenaming(false);
              }}
              placeholder="Name this account"
            />
          ) : (
            <strong onDoubleClick={() => setRenaming(true)} title="Double-click to rename">
              {title}
            </strong>
          )}
          <span>{subtitle}</span>
          <span className={`state-pill ${stateClass(account)}`}>
            <span className="state-dot" />
            {STATE_TEXT[account.state] || account.state}
            {unread > 0 && account.connected ? ` · ${unread} unread` : ''}
          </span>
        </div>
      </div>

      {account.error && <p className="account-card-error">{account.error}</p>}

      <div className="account-card-actions">
        {account.connected ? (
          <button className="btn-primary" onClick={() => onOpen(account.sessionId)}>
            <IconChats width={16} height={16} /> Open chats
          </button>
        ) : (
          <button
            className="btn-primary"
            onClick={() => onScan(account.sessionId)}
            disabled={busy}
          >
            {busy ? 'Connecting...' : 'Scan QR code'}
          </button>
        )}
        <button className="btn-ghost" onClick={() => restartAccount(account.sessionId)}>
          <IconRefresh width={15} height={15} /> Reconnect
        </button>
        <button className="btn-ghost" onClick={() => setRenaming(true)}>
          Rename
        </button>
        {account.connected && (
          <button
            className="btn-ghost"
            onClick={() => {
              if (window.confirm(`Log out of ${title}? You will need to scan its QR again.`)) {
                logout(account.sessionId);
              }
            }}
          >
            <IconLogout width={15} height={15} /> Log out
          </button>
        )}
        <button
          className="btn-ghost danger"
          onClick={() => {
            if (
              window.confirm(
                `Remove ${title}? Its session, cached chats and downloaded media are deleted from this server.`
              )
            ) {
              removeAccount(account.sessionId);
            }
          }}
        >
          Remove
        </button>
      </div>
    </article>
  );
}

/**
 * The account manager: every linked WhatsApp number, plus the button that adds
 * another one. Adding creates the account server-side first, then opens the QR
 * dialog for it - so several accounts can be part-way through linking without
 * interfering with each other.
 */
export default function AccountsScreen({ onOpenChats, canGoBack, onBack }) {
  const { accounts, accountsLoaded, unreadByAccount, addAccount, selectAccount, notify } = useWa();
  const [linking, setLinking] = useState(null); // sessionId being scanned
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const [naming, setNaming] = useState(false);

  const startAdd = async (withLabel) => {
    setNaming(false);
    setAdding(true);
    try {
      const created = await addAccount(withLabel);
      setLabel('');
      setLinking(created.sessionId);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setAdding(false);
    }
  };

  const open = (sessionId) => {
    selectAccount(sessionId);
    onOpenChats();
  };

  return (
    <div className="accounts-screen">
      <header className="accounts-hero">
        <div className="accounts-hero-inner">
          <div>
            <p className="accounts-brand">
              <span className="accounts-brand-dot" />
              WhatsApp Boat
            </p>
            <h1>WhatsApp accounts</h1>
            <p>
              Link as many numbers as you need. Each one runs its own session, and you can switch
              between them without logging out.
            </p>
          </div>
          {canGoBack && (
            <button className="btn-ghost" onClick={onBack}>
              <IconChats width={15} height={15} /> Back to chats
            </button>
          )}
        </div>
      </header>

      <div className="accounts-body">
      {!accountsLoaded ? (
        <div className="accounts-empty">
          <div className="spinner" />
          <p>Loading your accounts...</p>
        </div>
      ) : (
        <div className="accounts-grid">
          {accounts.map((account) => (
            <AccountCard
              key={account.sessionId}
              account={account}
              unread={unreadByAccount[account.sessionId] || 0}
              onOpen={open}
              onScan={setLinking}
            />
          ))}

          {naming ? (
            <article className="account-card account-add">
              <label className="account-add-label" htmlFor="account-label">
                Name this account (optional)
              </label>
              <input
                id="account-label"
                className="account-rename"
                value={label}
                autoFocus
                placeholder="Sales line, Support, Personal..."
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') startAdd(label.trim());
                  if (e.key === 'Escape') setNaming(false);
                }}
              />
              <div className="account-card-actions">
                <button className="btn-primary" onClick={() => startAdd(label.trim())} disabled={adding}>
                  {adding ? 'Starting...' : 'Continue to QR'}
                </button>
                <button className="btn-ghost" onClick={() => setNaming(false)}>
                  Cancel
                </button>
              </div>
            </article>
          ) : (
            <button
              className="account-card account-add-btn"
              onClick={() => setNaming(true)}
              disabled={adding}
            >
              <span className="account-add-icon">
                <IconPlus width={26} height={26} />
              </span>
              <strong>{adding ? 'Starting session...' : 'Add WhatsApp account'}</strong>
              <span>Scan a QR code to link another number</span>
            </button>
          )}
        </div>
      )}

      </div>

      {linking && (
        <LinkDialog
          sessionId={linking}
          onClose={() => setLinking(null)}
          onLinked={(sessionId) => selectAccount(sessionId)}
        />
      )}
    </div>
  );
}
