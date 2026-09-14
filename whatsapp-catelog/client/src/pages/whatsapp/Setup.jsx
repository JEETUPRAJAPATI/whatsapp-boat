import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconCheck, IconPlug, IconRefresh, IconWhatsapp } from '../../components/Icons';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Loading,
  Modal,
} from '../../components/ui';
import { useAction, useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { launchEmbeddedSignup, listenForSignupEvents, loadFacebookSdk } from '../../lib/facebook';
import { connectionTone, formatRelative } from '../../lib/format';
import { useApp } from '../../store/AppContext';

/** Onboarding checklist derived from what Meta actually reports. */
function ConnectionSteps({ account }) {
  const steps = [
    {
      title: 'WhatsApp Business Account connected',
      desc: account ? `${account.name} · WABA ${account.wabaId}` : 'Not connected yet',
      done: Boolean(account && account.status === 'CONNECTED'),
    },
    {
      title: 'Phone number registered',
      desc: account?.phoneNumbers?.length
        ? account.phoneNumbers.map((n) => n.phoneNumber).join(', ')
        : 'No number attached to this account',
      done: Boolean(account?.phoneNumbers?.some((n) => n.status === 'CONNECTED')),
    },
    {
      title: 'Webhook subscribed',
      desc: account?.webhookSubscribed
        ? 'Meta will deliver customer messages to this server'
        : 'Incoming messages will not arrive until this succeeds',
      done: Boolean(account?.webhookSubscribed),
    },
    {
      title: 'Product catalog linked',
      desc: account?.catalogs?.length
        ? account.catalogs.map((c) => c.name).join(', ')
        : 'Create or connect a catalog from the Catalog page',
      done: Boolean(account?.catalogs?.length),
    },
  ];

  const firstPending = steps.findIndex((step) => !step.done);

  return (
    <div className="steps">
      {steps.map((step, index) => (
        <div
          key={step.title}
          className={`step ${step.done ? 'step-done' : index === firstPending ? 'step-active' : ''}`}
        >
          <span className="step-marker">{step.done ? <IconCheck size={13} /> : index + 1}</span>
          <div className="grow">
            <div className="step-title">{step.title}</div>
            <div className="step-desc">{step.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Registers a number that Meta has, but which is not live on the Cloud API. */
function RegisterNumberModal({ open, onClose, account, number, onDone }) {
  const { toast } = useApp();
  const { pending, perform } = useAction();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    if (!/^\d{6}$/.test(pin)) {
      setError('The PIN must be exactly 6 digits.');
      return;
    }
    setError('');
    const result = await perform(() =>
      api.registerNumber(account.id, { phoneNumberId: number.phoneNumberId, pin }),
    );
    if (result) {
      toast(`${number.phoneNumber} registered.`);
      setPin('');
      onClose();
      onDone?.();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Register this number"
      description={`Activate ${number?.phoneNumber} on the WhatsApp Cloud API.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            Register number
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <Alert tone="info">
          Meta requires a 6-digit two-step verification PIN for this number. If you have never set
          one, choose any 6 digits now and keep a record of it — Meta asks for the same PIN when the
          number is moved or re-registered.
        </Alert>
        <Input
          label="Two-step verification PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          inputMode="numeric"
          maxLength={6}
          error={error}
          autoFocus
        />
      </div>
    </Modal>
  );
}

/** Manual path for an operator who already has a System User token in .env. */
export default function Setup() {
  const { toast, toastError, refreshStatus } = useApp();
  const accounts = useAsync(() => api.accounts(), []);
  const signupConfig = useAsync(() => api.embeddedSignupConfig(), []);

  const [connecting, setConnecting] = useState(false);
  const [registerFor, setRegisterFor] = useState(null);
  const [disconnectFor, setDisconnectFor] = useState(null);
  const { pending: disconnecting, perform: performDisconnect } = useAction();
  const { pending: refreshing, perform: performRefresh } = useAction();

  // Meta reports the chosen WABA / number through a postMessage event that
  // arrives *before* FB.login resolves, so it is captured into a ref.
  const signupHints = useRef({});

  useEffect(() => listenForSignupEvents((event) => {
    if (event?.data) {
      signupHints.current = {
        waba_id: event.data.waba_id,
        phone_number_id: event.data.phone_number_id,
        business_id: event.data.business_id,
      };
    }
  }), []);

  const account = accounts.data?.[0] || null;
  // This install manages a single number. The connect card is only there to
  // bring it live on the API. "CONNECTED" alone is not enough: a number linked
  // from Business Manager shows connected while every API send still fails
  // with 133010 "Account not registered", so require Cloud API registration.
  const numberLive = (accounts.data || []).some((a) =>
    (a.phoneNumbers || []).some((n) => n.status === 'CONNECTED' && n.platformType === 'CLOUD_API'),
  );
  const signup = signupConfig.data;

  const startEmbeddedSignup = async () => {
    setConnecting(true);
    try {
      await loadFacebookSdk({ appId: signup.appId, graphVersion: signup.graphVersion });
      const { code } = await launchEmbeddedSignup({
        configId: signup.configId,
        scopes: signup.scopes,
      });

      const result = await api.embeddedSignup({ code, ...signupHints.current });
      toast('WhatsApp Business Account connected.');

      for (const warning of result.warnings || []) toast(warning.message, 'warn');

      await accounts.reload();
      await refreshStatus();
    } catch (err) {
      toastError(err, 'Could not complete the Meta connection.');
    } finally {
      setConnecting(false);
      signupHints.current = {};
    }
  };

  const refresh = async (id) => {
    const result = await performRefresh(() => api.refreshAccount(id));
    if (result) {
      toast('Account refreshed from Meta.');
      accounts.reload();
      refreshStatus();
    }
  };

  const disconnect = async () => {
    const result = await performDisconnect(() => api.disconnectAccount(disconnectFor.id));
    if (result) {
      toast('Account disconnected.');
      setDisconnectFor(null);
      accounts.reload();
      refreshStatus();
    }
  };

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>Connect WhatsApp Business</h1>
          <p>
            Onboarding runs through Meta&apos;s own flow. Your access token is exchanged and stored
            on the server, encrypted — it never reaches this browser.
          </p>
        </div>
        {account && (
          <div className="page-actions">
            <Button
              variant="secondary"
              icon={<IconRefresh size={15} />}
              loading={refreshing}
              onClick={() => refresh(account.id)}
            >
              Refresh
            </Button>
          </div>
        )}
      </div>

      {accounts.loading ? (
        <Loading label="Checking connection…" />
      ) : (
        <div className="col gap-4">
          {/* ------------------------------------------------- current state */}
          {account ? (
            <Card
              title={
                <span className="row gap-2">
                  {account.name}
                  <Badge tone={connectionTone(account.status)} dot>
                    {account.status}
                  </Badge>
                </span>
              }
              description={`Business ${account.business?.name || '—'} · checked ${formatRelative(account.lastCheckedAt)}`}
              actions={
                <Link to="/whatsapp/settings" className="btn btn-sm btn-secondary">
                  Details
                </Link>
              }
            >
              <ConnectionSteps account={account} />

              {account.statusMessage && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <Alert tone="danger" title="Meta reported a problem">
                    {account.statusMessage}
                  </Alert>
                </div>
              )}

              {/* Numbers that exist but are not live yet */}
              {account.phoneNumbers.filter((n) => n.status !== 'CONNECTED').map((number) => (
                <div key={number.id} style={{ marginTop: 'var(--space-4)' }}>
                  <Alert
                    tone="warn"
                    title={`${number.phoneNumber} is not registered`}
                    actions={
                      <Button size="sm" variant="secondary" onClick={() => setRegisterFor(number)}>
                        Register
                      </Button>
                    }
                  >
                    This number cannot send or receive messages until it is registered with a
                    two-step verification PIN.
                  </Alert>
                </div>
              ))}
            </Card>
          ) : (
            <Card>
              <EmptyState
                icon={<IconWhatsapp size={22} />}
                title="No WhatsApp account connected"
                description="Connect your WhatsApp Business Account to manage its catalog and reply to customers."
              />
            </Card>
          )}

          {/* ---------------------------------------------- connect actions */}
          {!numberLive && (
            <Card
              title="Connect your WhatsApp number"
              description="Links the number that already runs the WhatsApp Business app, keeping the app working on your phone."
            >
              {signupConfig.loading ? (
                <Loading label="Checking configuration…" />
              ) : signup?.available ? (
                <Button
                  variant="primary"
                  icon={<IconPlug size={15} />}
                  loading={connecting}
                  onClick={startEmbeddedSignup}
                >
                  Connect with Meta
                </Button>
              ) : (
                <Alert tone="warn" title="Embedded Signup is not configured">
                  Set {signup?.missing?.join(', ')} on the server to enable it.
                  <div className="small" style={{ marginTop: 6 }}>
                    Redirect URL to register in your Meta app: <code>{signup?.redirectUri}</code>
                  </div>
                </Alert>
              )}
            </Card>
          )}

          {/* ------------------------------------------------------ security */}
          <Alert tone="info" title="How your credentials are handled">
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              <li>The access token is exchanged server-side using your app secret.</li>
              <li>It is encrypted with AES-256-GCM before being stored.</li>
              <li>It is never sent to this browser, and never appears in an API response.</li>
              <li>Every Meta call is made by the server on your behalf.</li>
            </ul>
          </Alert>

          {account && (
            <div className="right">
              <Button variant="danger-ghost" onClick={() => setDisconnectFor(account)}>
                Disconnect this account
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ modals */}
      {registerFor && account && (
        <RegisterNumberModal
          open={Boolean(registerFor)}
          onClose={() => setRegisterFor(null)}
          account={account}
          number={registerFor}
          onDone={() => {
            accounts.reload();
            refreshStatus();
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(disconnectFor)}
        onClose={() => setDisconnectFor(null)}
        onConfirm={disconnect}
        pending={disconnecting}
        title="Disconnect this account?"
        confirmLabel="Disconnect"
      >
        <p className="small">
          The stored access token is deleted and Meta stops delivering webhooks here. Your catalog
          and products at Meta are <span className="strong">not</span> touched, and the local records
          are kept — you can reconnect later.
        </p>
      </ConfirmDialog>
    </main>
  );
}
