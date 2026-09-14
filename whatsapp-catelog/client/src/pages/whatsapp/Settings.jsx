import { Link } from 'react-router-dom';
import { IconGlobe, IconLock, IconRefresh } from '../../components/Icons';
import { Alert, Badge, Button, Card, EmptyState, Loading, Switch } from '../../components/ui';
import { useAction, useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { connectionTone, formatDate, formatRelative, humanize, qualityTone } from '../../lib/format';
import { useApp } from '../../store/AppContext';

function Yes({ value, yes = 'Active', no = 'Inactive' }) {
  return value ? (
    <Badge tone="success" dot>
      {yes}
    </Badge>
  ) : (
    <Badge tone="danger" dot>
      {no}
    </Badge>
  );
}

/** One phone number, with the commerce toggles Meta exposes for it. */
function PhoneNumberCard({ account, number, onChanged }) {
  const { toast } = useApp();
  const { pending, perform } = useAction();

  const toggle = async (patch) => {
    const result = await perform(() =>
      api.commerceSettings(account.id, { phoneNumberId: number.phoneNumberId, ...patch }),
    );
    if (result) {
      toast('Commerce settings updated.');
      onChanged?.();
    }
  };

  return (
    <Card
      title={
        <span className="row gap-2">
          <span className="mono">{number.phoneNumber}</span>
          <Badge tone={connectionTone(number.status)} dot>
            {number.status}
          </Badge>
          {number.isDefault && <Badge tone="info">Default</Badge>}
        </span>
      }
      description={number.displayName || 'No display name'}
    >
      <dl className="kv">
        <dt>Phone number ID</dt>
        <dd className="mono">{number.phoneNumberId}</dd>

        <dt>Verified name</dt>
        <dd>{number.displayName || '—'}</dd>

        <dt>Verification</dt>
        <dd>{humanize(number.verificationStatus) || '—'}</dd>

        <dt>Quality rating</dt>
        <dd>
          <Badge tone={qualityTone(number.qualityRating)} dot>
            {number.qualityRating || 'Unknown'}
          </Badge>
        </dd>

        <dt>Messaging status</dt>
        <dd>{humanize(number.messagingStatus) || '—'}</dd>

        <dt>Platform</dt>
        <dd>{humanize(number.platformType) || '—'}</dd>

        <dt>Throughput</dt>
        <dd>{humanize(number.throughputLevel) || '—'}</dd>
      </dl>

      <hr className="divider" />

      <div className="col gap-3">
        <div className="strong small">Catalog in chat</div>
        <Switch
          label="Show catalog to customers"
          hint="Adds the catalog entry point to this number's WhatsApp chat."
          checked={Boolean(number.catalogVisible)}
          disabled={pending}
          onChange={(e) => toggle({ isCatalogVisible: e.target.checked })}
        />
        <Switch
          label="Enable cart"
          hint="Lets customers add products to a cart and send you an order."
          checked={Boolean(number.cartEnabled)}
          disabled={pending}
          onChange={(e) => toggle({ isCartEnabled: e.target.checked })}
        />
        {number.catalogVisible === null && (
          <div className="field-hint">
            Meta does not report commerce settings for this number yet — that is normal until a
            catalog is linked to the account.
          </div>
        )}
      </div>
    </Card>
  );
}

export default function Settings() {
  const { status, toast, refreshStatus } = useApp();
  const accounts = useAsync(() => api.accounts(), []);
  const { pending: refreshing, perform } = useAction();

  const account = accounts.data?.[0] || null;
  const credential = useAsync(
    () => (account ? api.accountCredential(account.id) : Promise.resolve(null)),
    [account?.id],
  );

  const refresh = async () => {
    if (!account) return;
    const result = await perform(() => api.refreshAccount(account.id));
    if (result) {
      toast('Refreshed from Meta.');
      accounts.reload();
      credential.reload();
      refreshStatus();
    }
  };

  if (accounts.loading) {
    return (
      <main className="page page-narrow">
        <Loading label="Loading connection details…" />
      </main>
    );
  }

  if (!account) {
    return (
      <main className="page page-narrow">
        <Card>
          <EmptyState
            icon={<IconGlobe size={22} />}
            title="Nothing connected yet"
            description="Connect a WhatsApp Business Account to see its settings here."
            action={
              <Link to="/whatsapp/setup" className="btn btn-primary">
                Connect WhatsApp
              </Link>
            }
          />
        </Card>
      </main>
    );
  }

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>WhatsApp settings</h1>
          <p>Live account state as reported by Meta.</p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" icon={<IconRefresh size={15} />} loading={refreshing} onClick={refresh}>
            Refresh from Meta
          </Button>
        </div>
      </div>

      <div className="col gap-4">
        {/* -------------------------------------------------------- account */}
        <Card
          title="Business account"
          actions={
            <Badge tone={connectionTone(account.status)} dot>
              {account.status}
            </Badge>
          }
        >
          <dl className="kv">
            <dt>Account name</dt>
            <dd>{account.name}</dd>

            <dt>WABA ID</dt>
            <dd className="mono">{account.wabaId}</dd>

            <dt>Business portfolio</dt>
            <dd>{account.business?.name || '—'}</dd>

            <dt>Business ID</dt>
            <dd className="mono">{account.business?.metaBusinessId || '—'}</dd>

            <dt>Currency</dt>
            <dd>{account.currency || '—'}</dd>

            <dt>Webhook</dt>
            <dd>
              <Yes value={account.webhookSubscribed} />
            </dd>

            <dt>Last checked</dt>
            <dd>{formatDate(account.lastCheckedAt, { withTime: true })}</dd>
          </dl>

          {account.statusMessage && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <Alert tone="warn">{account.statusMessage}</Alert>
            </div>
          )}
        </Card>

        {/* ------------------------------------------------------- platform */}
        <Card title="Platform">
          <dl className="kv">
            <dt>Graph API version</dt>
            <dd className="mono">{status?.apiVersion || '—'}</dd>

            <dt>Webhook URL</dt>
            <dd className="mono" style={{ wordBreak: 'break-all' }}>
              {status?.webhookUrl}
            </dd>

            <dt>Signature verification</dt>
            <dd>
              {status?.hasAppSecret ? (
                <Badge tone="success" dot>
                  Enabled
                </Badge>
              ) : (
                <Badge tone="danger" dot>
                  App secret not set
                </Badge>
              )}
            </dd>

            <dt>Embedded Signup</dt>
            <dd>
              {status?.embeddedSignupAvailable ? (
                <Badge tone="success" dot>
                  Configured
                </Badge>
              ) : (
                <Badge tone="neutral">Not configured</Badge>
              )}
            </dd>
          </dl>

          {!status?.hasAppSecret && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <Alert tone="danger" title="Webhook signatures are not being verified">
                Without <code>META_APP_SECRET</code>, anyone who discovers your webhook URL could
                post fake customer messages. Set it before exposing this server publicly.
              </Alert>
            </div>
          )}
        </Card>

        {/* ----------------------------------------------------- credential */}
        <Card
          title={
            <span className="row gap-2">
              <IconLock size={15} />
              Access token
            </span>
          }
          description="Metadata only — the token itself is never sent to this browser."
        >
          {credential.loading ? (
            <Loading />
          ) : (
            <dl className="kv">
              <dt>Source</dt>
              <dd>
                {credential.data?.source === 'database' ? (
                  <Badge tone="success" dot>
                    Encrypted in database
                  </Badge>
                ) : credential.data?.source === 'env' ? (
                  <Badge tone="info" dot>
                    Server environment
                  </Badge>
                ) : (
                  <Badge tone="danger" dot>
                    None
                  </Badge>
                )}
              </dd>

              <dt>Type</dt>
              <dd>{humanize(credential.data?.tokenType) || '—'}</dd>

              <dt>Expires</dt>
              <dd>
                {credential.data?.expiresAt
                  ? `${formatDate(credential.data.expiresAt, { withTime: true })} (${formatRelative(credential.data.expiresAt)})`
                  : 'Does not expire'}
              </dd>

              <dt>Permissions</dt>
              <dd>
                {credential.data?.scopes?.length ? (
                  <div className="row wrap gap-1">
                    {credential.data.scopes.map((scope) => (
                      <Badge key={scope} tone="neutral">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  '—'
                )}
              </dd>
            </dl>
          )}
        </Card>

        {/* -------------------------------------------------------- numbers */}
        <div>
          <h2 style={{ marginBottom: 'var(--space-3)' }}>
            Phone numbers ({account.phoneNumbers.length})
          </h2>
          <div className="col gap-4">
            {account.phoneNumbers.length ? (
              account.phoneNumbers.map((number) => (
                <PhoneNumberCard
                  key={number.id}
                  account={account}
                  number={number}
                  onChanged={() => accounts.reload()}
                />
              ))
            ) : (
              <Card>
                <EmptyState title="No phone numbers" description="Add a number in Meta Business Manager." />
              </Card>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------- catalogs */}
        <Card
          title={`Catalogs (${account.catalogs.length})`}
          actions={
            <Link to="/catalog" className="btn btn-sm btn-secondary">
              Manage
            </Link>
          }
        >
          {account.catalogs.length ? (
            <div className="col gap-3">
              {account.catalogs.map((catalog) => (
                <div key={catalog.id} className="row-between">
                  <div className="grow">
                    <div className="strong">{catalog.name}</div>
                    <div className="tiny muted mono">{catalog.metaCatalogId}</div>
                  </div>
                  <div className="row gap-2">
                    {catalog.isDefault && <Badge tone="info">Default</Badge>}
                    <Badge tone={connectionTone(catalog.status)} dot>
                      {catalog.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No catalog linked"
              description="Create or connect a product catalog to send products to customers."
              action={
                <Link to="/catalog" className="btn btn-primary">
                  Set up catalog
                </Link>
              }
            />
          )}
        </Card>
      </div>
    </main>
  );
}
