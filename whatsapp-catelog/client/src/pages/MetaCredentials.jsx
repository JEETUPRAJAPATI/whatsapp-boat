import { useEffect, useState } from 'react';
import { IconCheck, IconLock } from '../components/Icons';
import { Alert, Button, Card, Field, Input, Loading } from '../components/ui';
import { useAction, useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useApp } from '../store/AppContext';

const EMPTY_FORM = {
  appId: '',
  appSecret: '',
  configId: '',
  apiVersion: '',
  graphBaseUrl: '',
  verifyToken: '',
  accessToken: '',
  businessId: '',
  catalogId: '',
  businessName: '',
};

/** Copy-to-clipboard button for the webhook verify token. */
function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can be unavailable (insecure context, permissions) -
      // silently do nothing rather than throw in the user's face.
    }
  };

  return (
    <Button type="button" variant="ghost" size="sm" onClick={copy} disabled={!value}>
      {copied ? <IconCheck size={14} /> : null}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

export default function MetaCredentials() {
  const { toast } = useApp();
  const settings = useAsync(() => api.getMetaSettings(), []);
  const { pending, perform } = useAction();
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    if (!settings.data) return;
    setForm({
      appId: settings.data.appId || '',
      appSecret: '',
      configId: settings.data.configId || '',
      apiVersion: settings.data.apiVersion || '',
      graphBaseUrl: settings.data.graphBaseUrl || '',
      verifyToken: settings.data.verifyToken || '',
      accessToken: '',
      businessId: settings.data.businessId || '',
      catalogId: settings.data.catalogId || '',
      businessName: settings.data.businessName || '',
    });
  }, [settings.data]);

  const setField = (key) => (e) => setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();

    const payload = {
      appId: form.appId,
      configId: form.configId,
      apiVersion: form.apiVersion,
      graphBaseUrl: form.graphBaseUrl,
      verifyToken: form.verifyToken,
      businessId: form.businessId,
      catalogId: form.catalogId,
      businessName: form.businessName,
    };
    // Only send secrets when the user actually typed something new - a blank
    // field means "keep the value already stored on the server".
    if (form.appSecret) payload.appSecret = form.appSecret;
    if (form.accessToken) payload.accessToken = form.accessToken;

    const result = await perform(() => api.updateMetaSettings(payload));
    if (result) {
      toast('Meta settings saved.');
      settings.reload();
    }
  };

  if (settings.loading) {
    return (
      <main className="page page-narrow">
        <Loading label="Loading Meta settings…" />
      </main>
    );
  }

  const data = settings.data;

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>
            <span className="row gap-2">
              <IconLock size={20} />
              Meta credentials
            </span>
          </h1>
          <p>
            These are the Meta app-level credentials used for every WhatsApp Business Account
            connected below. Changing them takes effect immediately — no server restart needed.
          </p>
        </div>
      </div>

      {settings.error && (
        <Alert tone="danger" title="Could not load Meta settings">
          {settings.error.message}
        </Alert>
      )}

      <form onSubmit={submit} className="col gap-4">
        <Card title="App identity">
          <div className="col gap-3">
            <Input
              label="App ID"
              value={form.appId}
              onChange={setField('appId')}
              placeholder="e.g. 1234567890123456"
            />
            <Input
              label="App Secret"
              type="password"
              value={form.appSecret}
              onChange={setField('appSecret')}
              placeholder={
                data?.hasAppSecret
                  ? `Set (${data.appSecretFingerprint}) — leave blank to keep`
                  : 'Not set'
              }
              hint="Used to verify webhook signatures and generate the appsecret_proof."
            />
            <Input
              label="Embedded Signup Config ID"
              value={form.configId}
              onChange={setField('configId')}
              placeholder="App > WhatsApp > Configuration"
            />
          </div>
        </Card>

        <Card title="Graph API">
          <div className="col gap-3">
            <Input
              label="Graph API version"
              value={form.apiVersion}
              onChange={setField('apiVersion')}
              placeholder="v25.0"
            />
            <Input
              label="Graph base URL"
              value={form.graphBaseUrl}
              onChange={setField('graphBaseUrl')}
              placeholder="https://graph.facebook.com"
            />
          </div>
        </Card>

        <Card title="Webhook">
          <div className="col gap-3">
            <Field label="Webhook verify token" hint="Meta dashboard me exactly yahi value honi chahiye.">
              {(props) => (
                <div className="row gap-2">
                  <input
                    {...props}
                    className="input"
                    type="text"
                    value={form.verifyToken}
                    onChange={setField('verifyToken')}
                    placeholder="A shared secret string you choose"
                  />
                  <CopyButton value={form.verifyToken} />
                </div>
              )}
            </Field>
            <Input
              label="Fallback access token"
              type="password"
              value={form.accessToken}
              onChange={setField('accessToken')}
              placeholder={
                data?.hasAccessToken
                  ? `Set (${data.accessTokenFingerprint}) — leave blank to keep`
                  : 'Not set'
              }
              hint="Used when a WABA has no encrypted per-account credential of its own."
            />
          </div>
        </Card>

        <Card title="Business & catalog">
          <div className="col gap-3">
            <Input
              label="Business ID"
              value={form.businessId}
              onChange={setField('businessId')}
            />
            <Input label="Catalog ID" value={form.catalogId} onChange={setField('catalogId')} />
            <Input
              label="Business name"
              value={form.businessName}
              onChange={setField('businessName')}
            />
          </div>
        </Card>

        {data?.updatedAt && (
          <div className="small muted">
            Last updated {formatDate(data.updatedAt, { withTime: true })}
          </div>
        )}

        <div className="page-actions">
          <Button type="submit" variant="primary" loading={pending}>
            Save settings
          </Button>
        </div>
      </form>
    </main>
  );
}
