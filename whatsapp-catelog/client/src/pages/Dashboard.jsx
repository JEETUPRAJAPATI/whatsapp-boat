import { Link } from 'react-router-dom';
import {
  IconAlert,
  IconBolt,
  IconBox,
  IconCatalog,
  IconInbox,
  IconLayers,
  IconPlug,
  IconPlus,
  IconSync,
} from '../components/Icons';
import { Alert, Badge, Button, Card, EmptyState, Loading, Stat } from '../components/ui';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { connectionTone, formatNumber, formatRelative, syncRunTone } from '../lib/format';
import { useApp } from '../store/AppContext';

/**
 * The landing screen.
 *
 * Its job is to answer, in one glance: is WhatsApp connected, is the catalog
 * healthy, and is anything waiting on me. Everything else is a link away.
 */
export default function Dashboard() {
  const { status } = useApp();

  const accounts = useAsync(() => api.accounts(), []);
  const overview = useAsync(
    () => api.catalogOverview().catch(() => null),
    [],
  );
  const automation = useAsync(() => api.automationStatus().catch(() => null), []);

  const connected = status?.connectedAccounts > 0;
  const counts = overview.data?.counts;
  const needsAttention = (counts?.failed || 0) + (counts?.conflicts || 0);

  return (
    <main className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Your WhatsApp Business catalog at a glance.</p>
        </div>
        <div className="page-actions">
          <Button
            variant="secondary"
            icon={<IconSync size={15} />}
            onClick={() => {
              accounts.reload();
              overview.reload();
              automation.reload();
            }}
          >
            Refresh
          </Button>
          <Link to="/catalog/products/create" className="btn btn-primary">
            <IconPlus size={15} />
            Add product
          </Link>
        </div>
      </div>

      {/* -------------------------------------------------- attention banners */}
      <div className="banner-stack">
        {!connected && !accounts.loading && (
          <Alert
            tone="warn"
            title="WhatsApp is not connected"
            actions={
              <Link to="/whatsapp/setup" className="btn btn-sm btn-secondary">
                Connect
              </Link>
            }
          >
            Connect a WhatsApp Business Account to start managing your catalog.
          </Alert>
        )}

        {connected && status?.catalogs === 0 && (
          <Alert
            tone="warn"
            title="No catalog is linked yet"
            actions={
              <Link to="/catalog" className="btn btn-sm btn-secondary">
                Set up catalog
              </Link>
            }
          >
            Your WhatsApp account is connected, but no product catalog is attached to it yet.
          </Alert>
        )}

        {connected && !status?.webhookSubscribed && (
          <Alert tone="danger" title="Webhook is not active">
            Incoming customer messages will not arrive until the webhook subscription succeeds.
          </Alert>
        )}

        {needsAttention > 0 && (
          <Alert
            tone="danger"
            title={`${needsAttention} product${needsAttention === 1 ? '' : 's'} need attention`}
            actions={
              <Link to="/catalog/sync" className="btn btn-sm btn-secondary">
                Review
              </Link>
            }
          >
            Some products failed to publish or differ from the Meta catalog.
          </Alert>
        )}
      </div>

      {/* --------------------------------------------------------- catalog stats */}
      <section className="section">
        {overview.loading ? (
          <Loading />
        ) : counts ? (
          <div className="stats">
            <Stat
              label="Products"
              value={formatNumber(counts.total)}
              sub={`${counts.drafts} draft${counts.drafts === 1 ? '' : 's'}`}
              icon={<IconBox size={13} />}
            />
            <Stat
              label="Live"
              value={formatNumber(counts.active)}
              sub="published to Meta"
              tone="success"
              icon={<IconCatalog size={13} />}
            />
            <Stat
              label="Out of stock"
              value={formatNumber(counts.outOfStock)}
              tone={counts.outOfStock ? 'warn' : undefined}
              icon={<IconAlert size={13} />}
            />
            <Stat
              label="Needs sync"
              value={formatNumber(counts.pending + counts.failed + counts.conflicts)}
              sub={`${counts.conflicts} conflict${counts.conflicts === 1 ? '' : 's'}`}
              tone={counts.failed || counts.conflicts ? 'danger' : undefined}
              icon={<IconSync size={13} />}
            />
            <Stat label="Collections" value={formatNumber(counts.collections)} icon={<IconLayers size={13} />} />
            <Stat label="Categories" value={formatNumber(counts.categories)} icon={<IconBox size={13} />} />
          </div>
        ) : (
          <Card>
            <EmptyState
              icon={<IconCatalog size={22} />}
              title="No catalog yet"
              description="Once a catalog is connected, your product counts appear here."
              action={
                <Link to="/catalog" className="btn btn-primary">
                  Go to catalog
                </Link>
              }
            />
          </Card>
        )}
      </section>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        {/* ------------------------------------------------------ accounts */}
        <Card
          title="WhatsApp accounts"
          actions={
            <Link to="/whatsapp/settings" className="btn btn-sm btn-ghost">
              Manage
            </Link>
          }
          bodyClass="card-body"
        >
          {accounts.loading ? (
            <Loading />
          ) : !accounts.data?.length ? (
            <EmptyState
              icon={<IconPlug size={20} />}
              title="Nothing connected"
              description="Connect your WhatsApp Business Account to begin."
              action={
                <Link to="/whatsapp/setup" className="btn btn-primary">
                  Connect WhatsApp
                </Link>
              }
            />
          ) : (
            <div className="col gap-4">
              {accounts.data.map((account) => (
                <div key={account.id} className="col gap-2">
                  <div className="row-between">
                    <div className="grow">
                      <div className="strong truncate">{account.name}</div>
                      <div className="tiny muted mono">WABA {account.wabaId}</div>
                    </div>
                    <Badge tone={connectionTone(account.status)} dot>
                      {account.status}
                    </Badge>
                  </div>

                  {account.phoneNumbers.map((number) => (
                    <div key={number.id} className="row-between small">
                      <span className="mono">{number.phoneNumber}</span>
                      <Badge tone={connectionTone(number.status)}>{number.messagingStatus || number.status}</Badge>
                    </div>
                  ))}

                  <div className="row-between small muted">
                    <span>{account.catalogs.length} catalog{account.catalogs.length === 1 ? '' : 's'}</span>
                    <span>Checked {formatRelative(account.lastCheckedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ---------------------------------------------------- sync + auto */}
        <Card
          title="Automation"
          actions={
            <Link to="/automation" className="btn btn-sm btn-ghost">
              Configure
            </Link>
          }
        >
          <div className="col gap-4">
            <div className="row-between">
              <div className="row gap-2">
                <IconSync size={16} className="muted" />
                <span>Scheduled sync</span>
              </div>
              {automation.data?.syncEnabled ? (
                <Badge tone="success" dot>
                  On
                </Badge>
              ) : (
                <Badge tone="neutral">Off</Badge>
              )}
            </div>

            {automation.data?.nextSyncAt && (
              <div className="row-between small muted">
                <span>Next run</span>
                <span>{formatRelative(automation.data.nextSyncAt)}</span>
              </div>
            )}

            <div className="row-between">
              <div className="row gap-2">
                <IconBolt size={16} className="muted" />
                <span>Keyword auto-reply</span>
              </div>
              {automation.data?.autoReplyEnabled ? (
                <Badge tone="success" dot>
                  On
                </Badge>
              ) : (
                <Badge tone="neutral">Off</Badge>
              )}
            </div>

            <hr className="divider" style={{ margin: 0 }} />

            <div className="row-between">
              <span className="small muted">Last catalog sync</span>
              {overview.data?.lastSync ? (
                <Badge tone={syncRunTone(overview.data.lastSync.status)}>
                  {formatRelative(overview.data.lastSync.finishedAt || overview.data.lastSync.startedAt)}
                </Badge>
              ) : (
                <span className="small muted">Never</span>
              )}
            </div>
          </div>
        </Card>

        {/* -------------------------------------------------------- shortcuts */}
        <Card title="Quick actions">
          <div className="col gap-2">
            <Link to="/catalog/products/create" className="btn btn-secondary btn-block" style={{ justifyContent: 'flex-start' }}>
              <IconPlus size={15} />
              Add a new product
            </Link>
            <Link to="/catalog/sync" className="btn btn-secondary btn-block" style={{ justifyContent: 'flex-start' }}>
              <IconSync size={15} />
              Sync with Meta now
            </Link>
            <Link to="/whatsapp/inbox" className="btn btn-secondary btn-block" style={{ justifyContent: 'flex-start' }}>
              <IconInbox size={15} />
              Open customer inbox
            </Link>
            <Link to="/catalog/collections" className="btn btn-secondary btn-block" style={{ justifyContent: 'flex-start' }}>
              <IconLayers size={15} />
              Build a collection
            </Link>
          </div>
        </Card>
      </div>
    </main>
  );
}
