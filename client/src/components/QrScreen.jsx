import { useState } from 'react';
import { api } from '../lib/api';
import { useWa } from '../store';
import { IconRefresh } from './Icons';

const STEPS = [
  'Open WhatsApp on your phone',
  'Tap Menu or Settings and select Linked devices',
  'Tap Link a device',
  'Point your phone at this screen to capture the code',
];

export default function QrScreen() {
  const { status, socketLive } = useWa();
  const [busy, setBusy] = useState(false);

  const restart = async () => {
    setBusy(true);
    try {
      await api.restartSession();
    } finally {
      setBusy(false);
    }
  };

  const state = status.state;
  const loading = status.loading || {};

  return (
    <div className="qr-screen">
      <header className="qr-brand">
        <span className="qr-brand-dot" />
        WhatsApp Boat
      </header>

      <div className="qr-card">
        <div className="qr-instructions">
          <h1>Use WhatsApp on your computer</h1>
          <ol>
            {STEPS.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="qr-note">
            Your session stays linked on this machine, so you only scan once.
          </p>
        </div>

        <div className="qr-panel">
          {status.injectionBroken ? (
            <div className="qr-frame qr-frame-empty">
              <p className="qr-status-text">
                WhatsApp Web reloaded and this whatsapp-web.js build could not re-attach to the
                page. Your login is still saved.
              </p>
              <p className="qr-note" style={{ margin: 0 }}>
                Restart the session below. If it keeps happening, pin a WhatsApp Web build with
                <code> WA_WEB_VERSION</code> in <code>server/.env</code>.
              </p>
            </div>
          ) : state === 'QR' && status.qr ? (
            <div className="qr-frame">
              <img src={status.qr} alt="WhatsApp QR code" width="264" height="264" />
            </div>
          ) : (
            <div className="qr-frame qr-frame-empty">
              <div className="spinner" />
              <p className="qr-status-text">
                {state === 'INITIALIZING' && 'Starting the WhatsApp engine...'}
                {state === 'AUTHENTICATED' && 'Authenticated - syncing your chats...'}
                {state === 'DISCONNECTED' && 'Connecting...'}
                {state === 'AUTH_FAILURE' && 'Authentication failed. Try again.'}
                {state === 'READY' && 'Connected.'}
              </p>
              {loading.percent > 0 && loading.percent < 100 && (
                <div className="qr-progress">
                  <div className="qr-progress-bar" style={{ width: `${loading.percent}%` }} />
                  <span>{loading.message || 'Loading'} {loading.percent}%</span>
                </div>
              )}
            </div>
          )}

          <button className="btn-ghost" onClick={restart} disabled={busy}>
            <IconRefresh width={16} height={16} />
            {busy ? 'Restarting...' : 'Reload QR code'}
          </button>

          <div className={`conn-pill ${socketLive ? 'ok' : 'bad'}`}>
            <span className="conn-dot" />
            {socketLive ? 'Server connected' : 'Server offline'}
          </div>

          {status.error && <p className="qr-error">{status.error}</p>}
        </div>
      </div>
    </div>
  );
}
