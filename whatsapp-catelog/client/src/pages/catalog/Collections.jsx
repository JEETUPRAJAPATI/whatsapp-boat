import { useEffect, useState } from 'react';
import {
  IconEdit,
  IconLayers,
  IconPlus,
  IconSend,
  IconTrash,
  IconUpload,
} from '../../components/Icons';
import SendProductModal from '../../components/SendProductModal';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Loading,
  Modal,
  SearchInput,
  Textarea,
} from '../../components/ui';
import { useAction, useAsync, useDebounced } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { formatMoney, formatNumber, syncTone } from '../../lib/format';
import { useApp } from '../../store/AppContext';

/** Product picker: search the catalog and tick what belongs in the set. */
function ProductPicker({ selected, onChange }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 350);

  const products = useAsync(
    () => api.products({ search: debounced, state: 'published', pageSize: 50 }),
    [debounced],
  );

  const items = products.data?.items || [];

  const toggle = (id) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div className="col gap-3">
      <SearchInput value={search} onChange={setSearch} placeholder="Search published products…" />

      <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        {products.loading ? (
          <Loading />
        ) : !items.length ? (
          <div className="empty" style={{ padding: 'var(--space-6)' }}>
            <p className="small muted">
              {search ? 'No products match that search.' : 'No published products yet.'}
            </p>
          </div>
        ) : (
          items.map((product) => (
            <label
              key={product.id}
              className="row gap-3"
              style={{
                padding: '9px 12px',
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(product.id)}
                onChange={() => toggle(product.id)}
                style={{ width: 16, height: 16, accentColor: 'var(--brand-600)' }}
              />
              {product.imageUrl ? (
                <img className="thumb" style={{ width: 32, height: 32 }} src={product.imageUrl} alt="" />
              ) : (
                <div className="thumb thumb-empty" style={{ width: 32, height: 32 }} />
              )}
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="small strong truncate">{product.name}</div>
                <div className="tiny muted mono truncate">{product.retailerId}</div>
              </div>
              <span className="small num nowrap">{formatMoney(product.price, product.currency)}</span>
            </label>
          ))
        )}
      </div>

      <div className="small muted">
        {selected.length} selected. WhatsApp shows at most 30 products in one message.
      </div>
    </div>
  );
}

function CollectionModal({ open, onClose, collection, onSaved }) {
  const { toast } = useApp();
  const { pending, perform } = useAction();
  const [form, setForm] = useState({ name: '', description: '' });
  const [productIds, setProductIds] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({ name: collection?.name || '', description: collection?.description || '' });
    setProductIds((collection?.products || []).map((p) => p.id));
    setError('');
  }, [collection, open]);

  const submit = async ({ publish = false } = {}) => {
    if (!form.name.trim()) {
      setError('A name is required.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      productIds,
    };

    const result = await perform(async () => {
      if (collection) {
        const updated = await api.updateCollection(collection.id, payload);
        if (publish) await api.publishCollection(collection.id);
        return updated;
      }
      return api.createCollection({ ...payload, publish });
    });

    if (result) {
      toast(publish ? 'Collection saved and published to Meta.' : 'Collection saved.');
      onClose();
      onSaved?.();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={collection ? 'Edit collection' : 'New collection'}
      description="Collections become Meta product sets and can be sent as one multi-product message."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => submit()} loading={pending}>
            Save
          </Button>
          <Button variant="primary" onClick={() => submit({ publish: true })} loading={pending} disabled={!productIds.length}>
            Save &amp; publish
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Featured Properties"
          error={error}
          autoFocus
        />
        <Textarea
          label="Description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={2}
          placeholder="Optional"
        />

        <div className="field">
          <span className="field-label">Products</span>
          <ProductPicker selected={productIds} onChange={setProductIds} />
        </div>

        <Alert tone="info">
          Only published products can be in a Meta product set — drafts are not listed here.
        </Alert>
      </div>
    </Modal>
  );
}

export default function Collections() {
  const { toast } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [sending, setSending] = useState(null);

  const collections = useAsync(() => api.collections(), []);
  const { pending, perform } = useAction();

  const openEdit = async (collection) => {
    // The list endpoint is a summary; the modal needs the full membership.
    const full = await perform(() => api.collection(collection.id));
    if (full) {
      setEditing(full);
      setModalOpen(true);
    }
  };

  const publish = async (collection) => {
    const result = await perform(() => api.publishCollection(collection.id));
    if (result) {
      toast(`"${collection.name}" published to Meta.`);
      collections.reload();
    }
  };

  const remove = async () => {
    const result = await perform(() => api.deleteCollection(deleting.id));
    if (result) {
      toast('Collection deleted.');
      setDeleting(null);
      collections.reload();
    }
  };

  const list = collections.data || [];

  return (
    <main className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Collections</h1>
          <p>
            Curated sets you can send to a customer in a single WhatsApp message. Each one is stored
            at Meta as a product set.
          </p>
        </div>
        <div className="page-actions">
          <Button
            variant="primary"
            icon={<IconPlus size={15} />}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            New collection
          </Button>
        </div>
      </div>

      {collections.loading ? (
        <Loading label="Loading collections…" />
      ) : collections.error ? (
        <Card>
          <ErrorState error={collections.error} onRetry={collections.reload} />
        </Card>
      ) : !list.length ? (
        <Card>
          <EmptyState
            icon={<IconLayers size={22} />}
            title="No collections yet"
            description="Group products into sets like Featured Properties or Under ₹50 Lakhs, then send the whole set in one message."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                Create a collection
              </Button>
            }
          />
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {list.map((collection) => (
            <Card
              key={collection.id}
              title={collection.name}
              description={collection.description || `${formatNumber(collection.productCount)} products`}
              actions={
                <Badge tone={syncTone(collection.syncStatus)} dot>
                  {collection.syncStatus === 'SYNCED' ? 'Live' : collection.syncStatus}
                </Badge>
              }
              footer={
                <div className="row gap-2 wrap">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(collection)} disabled={pending}>
                    <IconEdit size={14} />
                    Edit
                  </Button>
                  {collection.syncStatus !== 'SYNCED' && (
                    <Button size="sm" variant="secondary" onClick={() => publish(collection)} disabled={pending}>
                      <IconUpload size={14} />
                      Publish
                    </Button>
                  )}
                  {collection.productCount > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setSending(collection)}>
                      <IconSend size={14} />
                      Send
                    </Button>
                  )}
                  <div className="grow" />
                  <Button size="sm" variant="danger-ghost" onClick={() => setDeleting(collection)}>
                    <IconTrash size={14} />
                  </Button>
                </div>
              }
            >
              <div className="row-between small">
                <span className="muted">Products</span>
                <span className="strong num">{formatNumber(collection.productCount)}</span>
              </div>
              {collection.metaProductSetId && (
                <div className="row-between small" style={{ marginTop: 6 }}>
                  <span className="muted">Meta product set</span>
                  <span className="mono tiny">{collection.metaProductSetId}</span>
                </div>
              )}
              {collection.syncError && (
                <div style={{ marginTop: 10 }}>
                  <Alert tone="danger">{collection.syncError}</Alert>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <CollectionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        collection={editing}
        onSaved={collections.reload}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        pending={pending}
        title={`Delete "${deleting?.name}"?`}
        confirmLabel="Delete collection"
      >
        <p className="small">
          The matching product set is deleted at Meta. The products themselves stay in your catalog.
        </p>
      </ConfirmDialog>

      {sending && (
        <SendProductModal open={Boolean(sending)} onClose={() => setSending(null)} collection={sending} />
      )}
    </main>
  );
}
