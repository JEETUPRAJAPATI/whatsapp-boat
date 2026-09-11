import { useEffect, useState } from 'react';
import { useWa } from '../store';
import { IconClose, IconRefresh } from './Icons';

const STEPS = [
  'Open WhatsApp on your phone',
  'Tap Menu or Settings and select Linked devices',
  'Tap Link a device',
  'Point your phone at this screen to capture the code',
];

/**
 * Links one account by QR.
 *
 * The account already exists on the server by the time this opens - it is the
 * server that drives the browser and emits the QR - so this only renders
 * whatever state that account is currently in and gets out of the way once it
 * connects.
 */
export default function LinkDialog({ sessionId, onClose, onLinked }) {
  const { accounts, restartAccount, socketLive } = useWa();
  const [busy, setBusy] = useState(false);

  const account = accounts.find((a) => a.sessionId === sessionId) || null;
  const state = account ? account.state : 'INITIALIZING';
  const loading = (account && account.loading) || {};
  const connected = !!(account && account.connected);

  // Close on success, but leave the "Connected" frame up for a beat so the
  // scan visibly succeeded rather than the dialog just vanishing.
  useEffect(() => {
    if (!connected) return undefined;
    const timer = setTimeout(() => {
      if (onLinked) onLinked(sessionId);
      onClose();
    }, 900);
    return () => clearTimeout(timer);
  }, [connected, sessionId, onLinked, onClose]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reload = async () => {
    setBusy(true);
    try {
      await restartAccount(sessionId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal link-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Link a WhatsApp account</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            <IconClose />
          </button>
        </header>

        <div className="link-body">
          <div className="qr-instructions">
            <ol>
              {STEPS.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <p className="qr-note">
              Each account keeps its own session on this machine, so you only scan once per number.
            </p>
          </div>

          <div className="qr-panel">
            {connected ? (
              <div className="qr-frame qr-frame-empty qr-frame-ok">
                <p className="qr-status-text">
                  Connected as {(account.me && account.me.pushname) || 'your account'}
                </p>
              </div>
            ) : account && account.injectionBroken ? (
              <div className="qr-frame qr-frame-empty">
                <p className="qr-status-text">
                  WhatsApp Web reloaded and this whatsapp-web.js build could not re-attach to the
                  page. This account&apos;s login is still saved.
                </p>
                <p className="qr-note" style={{ margin: 0 }}>
                  Reload below. If it keeps happening, pin a WhatsApp Web build with
                  <code> WA_WEB_VERSION</code> in <code>server/.env</code>.
                </p>
              </div>
            ) : state === 'QR' && account.qr ? (
              <div className="qr-frame">
                <img src={account.qr} alt="WhatsApp QR code" width="264" height="264" />
              </div>
            ) : (
              <div className="qr-frame qr-frame-empty">
                <div className="spinner" />
                <p className="qr-status-text">
                  {state === 'INITIALIZING' && 'Starting the WhatsApp engine...'}
                  {state === 'AUTHENTICATED' && 'Authenticated - syncing chats...'}
                  {state === 'DISCONNECTED' && 'Connecting...'}
                  {state === 'AUTH_FAILURE' && 'Authentication failed. Reload the code.'}
                  {state === 'READY' && 'Connected.'}
                </p>
                {loading.percent > 0 && loading.percent < 100 && (
                  <div className="qr-progress">
                    <div className="qr-progress-bar" style={{ width: `${loading.percent}%` }} />
                    <span>
                      {loading.message || 'Loading'} {loading.percent}%
                    </span>
                  </div>
                )}
              </div>
            )}

            <button className="btn-ghost" onClick={reload} disabled={busy || connected}>
              <IconRefresh width={16} height={16} />
              {busy ? 'Reloading...' : 'Reload QR code'}
            </button>

            <div className={`conn-pill ${socketLive ? 'ok' : 'bad'}`}>
              <span className="conn-dot" />
              {socketLive ? 'Server connected' : 'Server offline'}
            </div>

            {account && account.error && <p className="qr-error">{account.error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
