import { useEffect, useState } from 'react';
import { IconClose } from './Icons';
import { api } from '../lib/api';
import { useWa } from '../store';

/**
 * Meta WhatsApp Cloud API credentials, editable without touching server/.env.
 * Access token and app secret are masked: the server never sends the
 * plaintext back, so a blank field on submit means "keep the stored value".
 */
export default function SettingsDialog({ onClose }) {
  const { notify } = useWa();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [businessAccountId, setBusinessAccountId] = useState('');
  const [apiVersion, setApiVersion] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [hasAccessToken, setHasAccessToken] = useState(false);
  const [accessTokenFingerprint, setAccessTokenFingerprint] = useState(null);
  const [hasAppSecret, setHasAppSecret] = useState(false);
  const [appSecretFingerprint, setAppSecretFingerprint] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getMetaSettings()
      .then((data) => {
        if (cancelled) return;
        setPhoneNumberId(data.phoneNumberId || '');
        setBusinessAccountId(data.businessAccountId || '');
        setApiVersion(data.apiVersion || '');
        setVerifyToken(data.verifyToken || '');
        setHasAccessToken(Boolean(data.hasAccessToken));
        setAccessTokenFingerprint(data.accessTokenFingerprint || null);
        setHasAppSecret(Boolean(data.hasAppSecret));
        setAppSecretFingerprint(data.appSecretFingerprint || null);
      })
      .catch((err) => setError(err.message))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copyVerifyToken = async () => {
    try {
      await navigator.clipboard.writeText(verifyToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy - copy it manually instead.');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    const payload = {
      phoneNumberId: phoneNumberId.trim(),
      businessAccountId: businessAccountId.trim(),
      apiVersion: apiVersion.trim(),
      verifyToken: verifyToken.trim(),
    };
    if (accessToken.trim()) payload.accessToken = accessToken.trim();
    if (appSecret.trim()) payload.appSecret = appSecret.trim();

    try {
      await api.updateMetaSettings(payload);
      notify('Meta settings saved');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-small" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <strong>Meta WhatsApp settings</strong>
          <button className="icon-btn tiny" onClick={onClose} title="Close">
            <IconClose width={18} height={18} />
          </button>
        </header>

        {loading ? (
          <div className="modal-body">
            <div className="spinner small" />
          </div>
        ) : (
          <form className="modal-body" onSubmit={submit}>
            <label className="field">
              <span>Phone number ID</span>
              <input
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                placeholder="914098718459659"
              />
            </label>

            <label className="field">
              <span>Business account ID</span>
              <input
                value={businessAccountId}
                onChange={(e) => setBusinessAccountId(e.target.value)}
                placeholder="1936192610625973"
              />
            </label>

            <label className="field">
              <span>Graph API version</span>
              <input
                value={apiVersion}
                onChange={(e) => setApiVersion(e.target.value)}
                placeholder="v25.0"
              />
            </label>

            <label className="field">
              <span>Webhook verify token</span>
              <div className="field-with-action">
                <input
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  placeholder="a shared secret string"
                />
                <button type="button" className="btn-ghost" onClick={copyVerifyToken}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <span className="qr-note">Paste this into Meta&apos;s webhook configuration screen.</span>
            </label>

            <label className="field">
              <span>Access token</span>
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder={
                  hasAccessToken
                    ? `Set (${accessTokenFingerprint || '****'}) — leave blank to keep`
                    : 'Not set'
                }
                autoComplete="off"
              />
            </label>

            <label className="field">
              <span>App secret</span>
              <input
                type="password"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                placeholder={
                  hasAppSecret
                    ? `Set (${appSecretFingerprint || '****'}) — leave blank to keep`
                    : 'Not set'
                }
                autoComplete="off"
              />
            </label>

            {error && <p className="qr-error">{error}</p>}

            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save settings'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
