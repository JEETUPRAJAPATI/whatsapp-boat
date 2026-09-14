import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  IconBox,
  IconEdit,
  IconImage,
  IconPlus,
  IconSend,
  IconTrash,
  IconUpload,
} from '../../components/Icons';
import SendProductModal from '../../components/SendProductModal';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Loading,
  Pagination,
  SearchInput,
} from '../../components/ui';
import { useAction, useAsync, useDebounced } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import {
  AVAILABILITY_LABELS,
  availabilityTone,
  formatMoney,
  formatRelative,
  syncTone,
} from '../../lib/format';
import { useApp } from '../../store/AppContext';

const SORTS = [
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'price:desc', label: 'Price high to low' },
  { value: 'price:asc', label: 'Price low to high' },
];

const BULK_ACTIONS = [
  { value: 'publish', label: 'Publish to Meta' },
  { value: 'in_stock', label: 'Mark in stock' },
  { value: 'out_of_stock', label: 'Mark out of stock' },
  { value: 'activate', label: 'Activate' },
  { value: 'deactivate', label: 'Deactivate' },
  { value: 'delete', label: 'Delete' },
];

function ProductThumb({ product }) {
  if (product.imageUrl) {
    return <img className="thumb" src={product.imageUrl} alt="" loading="lazy" />;
  }
  return (
    <div className="thumb thumb-empty">
      <IconImage size={16} />
    </div>
  );
}

export default function Products() {
  const { toast } = useApp();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [state, setState] = useState('all');
  const [availability, setAvailability] = useState('');
  const [sort, setSort] = useState('updatedAt:desc');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [bulkAction, setBulkAction] = useState('');

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkConfirm, setBulkConfirm] = useState(false);
  const [sendTarget, setSendTarget] = useState(null);

  const debouncedSearch = useDebounced(search, 350);
  const [sortBy, sortDir] = sort.split(':');

  const categories = useAsync(() => api.categories().catch(() => []), []);
  const products = useAsync(
    () =>
      api.products({
        search: debouncedSearch,
        categoryId,
        state,
        availability,
        sortBy,
        sortDir,
        page,
        pageSize: 20,
      }),
    [debouncedSearch, categoryId, state, availability, sortBy, sortDir, page],
  );

  const { pending: acting, perform } = useAction();

  // Any filter change invalidates the current page and the selection.
  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [debouncedSearch, categoryId, state, availability, sort]);

  const items = products.data?.items || [];
  const currency = products.data?.catalog?.currency || 'INR';
  const allSelected = items.length > 0 && selected.length === items.length;

  const toggleAll = () => setSelected(allSelected ? [] : items.map((p) => p.id));
  const toggleOne = (id) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  const publish = async (product) => {
    const result = await perform(() => api.publishProduct(product.id));
    if (result) {
      toast(`"${product.name}" published to Meta.`);
      products.reload();
    }
  };

  const remove = async () => {
    const result = await perform(() => api.deleteProduct(deleteTarget.id));
    if (result) {
      toast(`"${deleteTarget.name}" deleted from Meta and this catalog.`);
      setDeleteTarget(null);
      products.reload();
    }
  };

  const runBulk = async () => {
    const result = await perform(() => api.bulkProducts(selected, bulkAction));
    if (result) {
      const message = result.failed
        ? `${result.succeeded} succeeded, ${result.failed} failed.`
        : `${result.succeeded} products updated.`;
      toast(message, result.failed ? 'warn' : 'success');

      // Surface the first couple of reasons rather than a silent partial result.
      for (const failure of (result.results || []).filter((r) => !r.ok).slice(0, 2)) {
        toast(failure.message, 'error');
      }
      setSelected([]);
      setBulkAction('');
      setBulkConfirm(false);
      products.reload();
    }
  };

  const startBulk = (action) => {
    setBulkAction(action);
    setBulkConfirm(true);
  };

  return (
    <main className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p>
            {products.data
              ? `${products.data.total} products in ${products.data.catalog.name}`
              : 'Everything in your WhatsApp catalog.'}
          </p>
        </div>
        <div className="page-actions">
          <Link to="/catalog/products/create" className="btn btn-primary">
            <IconPlus size={15} />
            Add product
          </Link>
        </div>
      </div>

      <Card bodyClass="" >
        {/* -------------------------------------------------------- toolbar */}
        <div className="toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search name, SKU or brand…" />

          <select className="select" style={{ width: 'auto' }} value={state} onChange={(e) => setState(e.target.value)}>
            <option value="all">All products</option>
            <option value="published">Published</option>
            <option value="draft">Drafts</option>
          </select>

          <select
            className="select"
            style={{ width: 'auto' }}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">All categories</option>
            {(categories.data || []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ width: 'auto' }}
            value={availability}
            onChange={(e) => setAvailability(e.target.value)}
          >
            <option value="">Any availability</option>
            {Object.entries(AVAILABILITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>

          <div className="grow" />

          <select className="select" style={{ width: 'auto' }} value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* ------------------------------------------------------ bulk bar */}
        {selected.length > 0 && (
          <div className="bulk-bar">
            <span className="strong small">{selected.length} selected</span>
            <div className="grow" />
            {BULK_ACTIONS.map((action) => (
              <Button
                key={action.value}
                size="sm"
                variant={action.value === 'delete' ? 'danger-ghost' : 'secondary'}
                onClick={() => startBulk(action.value)}
                disabled={acting}
              >
                {action.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
          </div>
        )}

        {/* ---------------------------------------------------------- table */}
        {products.loading && !products.data ? (
          <Loading label="Loading products…" />
        ) : products.error ? (
          <ErrorState error={products.error} onRetry={products.reload} />
        ) : !items.length ? (
          <EmptyState
            icon={<IconBox size={22} />}
            title={search || categoryId || availability ? 'No matching products' : 'No products yet'}
            description={
              search || categoryId || availability
                ? 'Try a different search or clear the filters.'
                : 'Add your first product and publish it to your WhatsApp catalog.'
            }
            action={
              search || categoryId || availability ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setCategoryId('');
                    setAvailability('');
                    setState('all');
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Link to="/catalog/products/create" className="btn btn-primary">
                  Add product
                </Link>
              )
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-check">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all"
                        style={{ width: 16, height: 16, accentColor: 'var(--brand-600)' }}
                      />
                    </th>
                    <th>Product</th>
                    <th>Price</th>
                    <th className="hide-sm">Category</th>
                    <th>Availability</th>
                    <th>Status</th>
                    <th className="hide-sm">Updated</th>
                    <th className="col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((product) => (
                    <tr key={product.id} className={selected.includes(product.id) ? 'selected' : ''}>
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={selected.includes(product.id)}
                          onChange={() => toggleOne(product.id)}
                          aria-label={`Select ${product.name}`}
                          style={{ width: 16, height: 16, accentColor: 'var(--brand-600)' }}
                        />
                      </td>

                      <td>
                        <div className="product-cell">
                          <ProductThumb product={product} />
                          <div className="grow" style={{ minWidth: 0 }}>
                            <Link to={`/catalog/products/${product.id}/edit`} className="strong truncate" style={{ color: 'inherit', display: 'block' }}>
                              {product.name}
                            </Link>
                            <div className="tiny muted mono truncate">{product.retailerId}</div>
                          </div>
                        </div>
                      </td>

                      <td className="num nowrap">
                        <div>{formatMoney(product.price, product.currency || currency)}</div>
                        {product.salePrice != null && (
                          <div className="tiny" style={{ color: 'var(--success-fg)' }}>
                            Sale {formatMoney(product.salePrice, product.currency || currency)}
                          </div>
                        )}
                      </td>

                      <td className="hide-sm">
                        {product.category ? (
                          <Badge tone="neutral">{product.category.name}</Badge>
                        ) : (
                          <span className="subtle">—</span>
                        )}
                      </td>

                      <td>
                        <Badge tone={availabilityTone(product.availability)} dot>
                          {AVAILABILITY_LABELS[product.availability] || product.availability}
                        </Badge>
                      </td>

                      <td>
                        {product.isDraft ? (
                          <Badge tone="neutral">Draft</Badge>
                        ) : (
                          <Badge tone={syncTone(product.syncStatus)} dot>
                            {product.syncStatus === 'SYNCED' ? 'Live' : product.syncStatus}
                          </Badge>
                        )}
                        {product.syncError && (
                          <div className="tiny" style={{ color: 'var(--danger-fg)', maxWidth: 200 }}>
                            {product.syncError}
                          </div>
                        )}
                      </td>

                      <td className="hide-sm small muted nowrap">{formatRelative(product.updatedAt)}</td>

                      <td className="col-actions">
                        <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                          {product.isDraft || product.syncStatus === 'FAILED' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => publish(product)}
                              disabled={acting}
                              title="Publish to the Meta catalog"
                            >
                              <IconUpload size={14} />
                              Publish
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSendTarget(product)}
                              title="Send to a customer"
                            >
                              <IconSend size={14} />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => navigate(`/catalog/products/${product.id}/edit`)}
                            title="Edit"
                          >
                            <IconEdit size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="danger-ghost"
                            onClick={() => setDeleteTarget(product)}
                            title="Delete"
                          >
                            <IconTrash size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={products.data.page}
              pages={products.data.pages}
              total={products.data.total}
              pageSize={products.data.pageSize}
              onPage={setPage}
            />
          </>
        )}
      </Card>

      {/* ------------------------------------------------------------ modals */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        pending={acting}
        title={`Delete "${deleteTarget?.name}"?`}
        confirmLabel="Delete product"
      >
        <p className="small">
          This deletes the product from your <span className="strong">live Meta catalog</span> first,
          then removes it here. Customers will no longer see it in WhatsApp.
        </p>
        <p className="small muted" style={{ marginTop: 8 }}>
          If Meta refuses the deletion, nothing is removed here and the product is flagged as a
          conflict instead.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={bulkConfirm}
        onClose={() => {
          setBulkConfirm(false);
          setBulkAction('');
        }}
        onConfirm={runBulk}
        pending={acting}
        variant={bulkAction === 'delete' ? 'danger' : 'primary'}
        title={`${BULK_ACTIONS.find((a) => a.value === bulkAction)?.label} — ${selected.length} products?`}
        confirmLabel="Continue"
      >
        <p className="small">
          {bulkAction === 'delete'
            ? 'Each product is deleted from the Meta catalog and then removed here. Products Meta refuses to delete are flagged as conflicts and kept.'
            : 'Each product is updated locally and, if it is already published, pushed to Meta.'}
        </p>
      </ConfirmDialog>

      {sendTarget && (
        <SendProductModal
          open={Boolean(sendTarget)}
          onClose={() => setSendTarget(null)}
          product={sendTarget}
        />
      )}
    </main>
  );
}
