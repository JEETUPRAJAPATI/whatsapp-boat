import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  IconAlert,
  IconBox,
  IconCatalog,
  IconLayers,
  IconPlus,
  IconRefresh,
  IconSync,
  IconTag,
} from '../../components/Icons';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Loading,
  Modal,
  Select,
  Stat,
} from '../../components/ui';
import { useAction, useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { connectionTone, formatNumber, formatRelative, syncRunTone } from '../../lib/format';
import { useApp } from '../../store/AppContext';

/**
 * Links or creates the Meta catalog.
 *
 * Creating a catalog writes to the operator's real Commerce Manager, so it is
 * behind an explicit button and a named confirmation rather than happening
 * automatically on first boot.
 */
function CatalogSetupModal({ open, onClose, accounts, onDone }) {
  const { toast } = useApp();
  const { pending, perform } = useAction();
  const [accountId, setAccountId] = useState(accounts?.[0]?.id || '');
  const [mode, setMode] = useState('connect');
  const [name, setName] = useState('');
  const [metaCatalogId, setMetaCatalogId] = useState('');

  const discovered = useAsync(
    () => (accountId ? api.discoverCatalogs(accountId).catch(() => []) : Promise.resolve([])),
    [accountId],
  );

  const submit = async () => {
    const result = await perform(() =>
      mode === 'create'
        ? api.createCatalog({ accountId, name: name.trim() })
        : api.connectCatalog({ accountId, metaCatalogId }),
    );
    if (result) {
      toast(mode === 'create' ? 'Catalog created and linked.' : 'Catalog connected.');
      onClose();
      onDone?.();
    }
  };

  const available = discovered.data || [];
  const canSubmit = mode === 'create' ? name.trim().length > 1 : Boolean(metaCatalogId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Set up a product catalog"
      description="Link an existing Meta catalog, or create a new one."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={!canSubmit}>
            {mode === 'create' ? 'Create catalog' : 'Connect catalog'}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <Select
          label="WhatsApp account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          required
        >
          {(accounts || []).map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>

        <div className="tabs">
          <button className={`tab ${mode === 'connect' ? 'active' : ''}`} onClick={() => setMode('connect')}>
            Connect existing
          </button>
          <button className={`tab ${mode === 'create' ? 'active' : ''}`} onClick={() => setMode('create')}>
            Create new
          </button>
        </div>

        {mode === 'connect' ? (
          discovered.loading ? (
            <Loading label="Looking for catalogs at Meta…" />
          ) : available.length ? (
            <Select
              label="Catalog"
              value={metaCatalogId}
              onChange={(e) => setMetaCatalogId(e.target.value)}
              required
            >
              <option value="">Select a catalog…</option>
              {available.map((catalog) => (
                <option key={catalog.id} value={catalog.id}>
                  {catalog.name}
                  {catalog.connectedToWhatsapp ? ' (linked to WhatsApp)' : ''}
                  {catalog.alreadyTracked ? ' — already managed here' : ''}
                </option>
              ))}
            </Select>
          ) : (
            <Alert tone="warn" title="No catalogs found at Meta">
              This business portfolio has no Commerce catalog yet. Switch to{' '}
              <span className="strong">Create new</span> to make one, or create it in Meta Commerce
              Manager and come back.
            </Alert>
          )
        ) : (
          <>
            <Input
              label="Catalog name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Property Listings"
              required
              autoFocus
            />
            <Alert tone="info">
              This creates a real catalog in your Meta Business Portfolio and links it to this
              WhatsApp account. You can manage it afterwards in Meta Commerce Manager.
            </Alert>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function CatalogOverview() {
  const { toast, refreshStatus } = useApp();
  const [setupOpen, setSetupOpen] = useState(false);

  const catalogs = useAsync(() => api.catalogs(), []);
  const accounts = useAsync(() => api.accounts(), []);
  const overview = useAsync(() => api.catalogOverview().catch(() => null), []);
  const { pending: syncing, perform } = useAction();

  const reloadAll = () => {
    catalogs.reload();
    overview.reload();
    refreshStatus();
  };

  const runSync = async () => {
    const result = await perform(() => api.runSync({ push: false }));
    if (result) {
      toast(
        `Sync ${result.status.toLowerCase()}: ${result.created} added, ${result.updated} updated, ${result.conflicts} conflicts.`,
        result.status === 'SUCCESS' ? 'success' : 'warn',
      );
      reloadAll();
    }
  };

  const setDefault = async (id) => {
    await perform(() => api.setDefaultCatalog(id));
    toast('Default catalog updated.');
    reloadAll();
  };

  const hasAccounts = Boolean(accounts.data?.length);
  const list = catalogs.data || [];
  const counts = overview.data?.counts;
  const lastSync = overview.data?.lastSync;

  return (
    <main className="page page-wide">
      <div className="page-head">
        <div>
          <h1>WhatsApp Catalog</h1>
          <p>
            {overview.data?.catalog
              ? `${overview.data.catalog.name} · Meta catalog ${overview.data.catalog.metaCatalogId}`
              : 'Manage the products customers see inside WhatsApp.'}
          </p>
        </div>
        <div className="page-actions">
          <Button variant="secondary" icon={<IconSync size={15} />} loading={syncing} onClick={runSync} disabled={!list.length}>
            Sync now
          </Button>
          <Link to="/catalog/products/create" className="btn btn-primary">
            <IconPlus size={15} />
            Add product
          </Link>
        </div>
      </div>

      {catalogs.loading ? (
        <Loading label="Loading catalog…" />
      ) : !list.length ? (
        <Card>
          <EmptyState
            icon={<IconCatalog size={22} />}
            title="No catalog connected"
            description={
              hasAccounts
                ? 'Link an existing Meta catalog, or create a new one, to start publishing products to WhatsApp.'
                : 'Connect a WhatsApp Business Account first — a catalog is attached to an account.'
            }
            action={
              hasAccounts ? (
                <Button variant="primary" onClick={() => setSetupOpen(true)}>
                  Set up catalog
                </Button>
              ) : (
                <Link to="/whatsapp/setup" className="btn btn-primary">
                  Connect WhatsApp
                </Link>
              )
            }
          />
        </Card>
      ) : (
        <div className="col gap-5">
          {/* --------------------------------------------------------- stats */}
          {counts && (
            <div className="stats">
              <Stat label="Products" value={formatNumber(counts.total)} icon={<IconBox size={13} />} />
              <Stat label="Live" value={formatNumber(counts.active)} tone="success" />
              <Stat label="Drafts" value={formatNumber(counts.drafts)} />
              <Stat
                label="Out of stock"
                value={formatNumber(counts.outOfStock)}
                tone={counts.outOfStock ? 'warn' : undefined}
                icon={<IconAlert size={13} />}
              />
              <Stat label="Categories" value={formatNumber(counts.categories)} icon={<IconTag size={13} />} />
              <Stat label="Collections" value={formatNumber(counts.collections)} icon={<IconLayers size={13} />} />
            </div>
          )}

          {/* ------------------------------------------------------ warnings */}
          {counts && (counts.failed > 0 || counts.conflicts > 0) && (
            <Alert
              tone="danger"
              title={`${counts.failed + counts.conflicts} products need attention`}
              actions={
                <Link to="/catalog/sync" className="btn btn-sm btn-secondary">
                  Review
                </Link>
              }
            >
              {counts.failed > 0 && `${counts.failed} failed to publish. `}
              {counts.conflicts > 0 && `${counts.conflicts} differ from the Meta catalog.`}
            </Alert>
          )}

          {overview.data?.account && !overview.data.account.catalogVisible && (
            <Alert
              tone="warn"
              title="Catalog is not visible in chat"
              actions={
                <Link to="/whatsapp/settings" className="btn btn-sm btn-secondary">
                  Enable
                </Link>
              }
            >
              Customers cannot browse your catalog from the chat until catalog visibility is turned
              on for the phone number.
            </Alert>
          )}

          {/* ---------------------------------------------------- sync state */}
          <Card
            title="Sync with Meta"
            actions={
              <Link to="/catalog/sync" className="btn btn-sm btn-ghost">
                History
              </Link>
            }
          >
            <div className="row-between wrap gap-3">
              <div>
                <div className="small muted">Last synced</div>
                <div className="row gap-2" style={{ marginTop: 3 }}>
                  <span className="strong">
                    {lastSync ? formatRelative(lastSync.finishedAt || lastSync.startedAt) : 'Never'}
                  </span>
                  {lastSync && <Badge tone={syncRunTone(lastSync.status)}>{lastSync.status}</Badge>}
                </div>
                {lastSync && (
                  <div className="tiny muted" style={{ marginTop: 3 }}>
                    +{lastSync.created} added · {lastSync.updated} updated · {lastSync.deleted} missing
                    at Meta · {lastSync.conflicts} conflicts
                  </div>
                )}
              </div>
              <Button variant="secondary" icon={<IconRefresh size={15} />} loading={syncing} onClick={runSync}>
                Sync now
              </Button>
            </div>
          </Card>

          {/* ------------------------------------------------------ catalogs */}
          <Card
            title={`Connected catalogs (${list.length})`}
            actions={
              hasAccounts && (
                <Button size="sm" variant="secondary" onClick={() => setSetupOpen(true)}>
                  Add catalog
                </Button>
              )
            }
            bodyClass="card-body"
          >
            <div className="col gap-4">
              {list.map((catalog) => (
                <div key={catalog.id} className="row-between wrap gap-3">
                  <div className="grow">
                    <div className="row gap-2">
                      <span className="strong">{catalog.name}</span>
                      {catalog.isDefault && <Badge tone="info">Default</Badge>}
                      <Badge tone={connectionTone(catalog.status)} dot>
                        {catalog.status}
                      </Badge>
                    </div>
                    <div className="tiny muted mono" style={{ marginTop: 2 }}>
                      {catalog.metaCatalogId} · {catalog.account?.name}
                    </div>
                  </div>
                  <div className="row gap-3">
                    <span className="small muted">
                      {formatNumber(catalog.productCount)} products · {catalog.collectionCount} collections
                    </span>
                    {!catalog.isDefault && (
                      <Button size="sm" variant="ghost" onClick={() => setDefault(catalog.id)}>
                        Make default
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      <CatalogSetupModal
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        accounts={accounts.data}
        onDone={reloadAll}
      />
    </main>
  );
}
