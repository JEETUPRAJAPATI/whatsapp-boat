import { useEffect, useState } from 'react';
import { IconEdit, IconPlus, IconTag, IconTrash } from '../../components/Icons';
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
  Select,
  Textarea,
} from '../../components/ui';
import { useAction, useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';
import { useApp } from '../../store/AppContext';

function CategoryModal({ open, onClose, category, categories, onSaved }) {
  const { toast } = useApp();
  const { pending, perform } = useAction();
  const [form, setForm] = useState({ name: '', description: '', parentId: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({
      name: category?.name || '',
      description: category?.description || '',
      parentId: category?.parentId || '',
    });
    setError('');
  }, [category, open]);

  const submit = async () => {
    if (!form.name.trim()) {
      setError('A name is required.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      parentId: form.parentId || null,
    };

    const result = await perform(() =>
      category ? api.updateCategory(category.id, payload) : api.createCategory(payload),
    );
    if (result) {
      toast(category ? 'Category updated.' : 'Category created.');
      onClose();
      onSaved?.();
    }
  };

  // A category cannot be its own parent.
  const parentOptions = (categories || []).filter((c) => c.id !== category?.id);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={category ? 'Edit category' : 'New category'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {category ? 'Save changes' : 'Create category'}
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
          placeholder="e.g. Residential"
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
        <Select
          label="Parent category"
          value={form.parentId}
          onChange={(e) => setForm({ ...form, parentId: e.target.value })}
          hint="Leave blank for a top-level category."
        >
          <option value="">No parent</option>
          {parentOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      </div>
    </Modal>
  );
}

export default function Categories() {
  const { toast } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const categories = useAsync(() => api.categories(), []);
  const { pending, perform } = useAction();

  const remove = async () => {
    const result = await perform(() => api.deleteCategory(deleting.id));
    if (result) {
      toast(
        result.uncategorisedProducts
          ? `Category deleted. ${result.uncategorisedProducts} products are now uncategorised.`
          : 'Category deleted.',
      );
      setDeleting(null);
      categories.reload();
    }
  };

  const list = categories.data || [];
  const byId = new Map(list.map((c) => [c.id, c]));

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>Categories</h1>
          <p>
            Group your listings. The category name is sent to Meta with each published product.
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
            New category
          </Button>
        </div>
      </div>

      <Card bodyClass="">
        {categories.loading ? (
          <Loading label="Loading categories…" />
        ) : categories.error ? (
          <ErrorState error={categories.error} onRetry={categories.reload} />
        ) : !list.length ? (
          <EmptyState
            icon={<IconTag size={22} />}
            title="No categories yet"
            description="Categories help you filter your own listings and give Meta a category label for each product."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                Create the first one
              </Button>
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="hide-sm">Parent</th>
                  <th>Products</th>
                  <th className="hide-sm">Created</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((category) => (
                  <tr key={category.id}>
                    <td>
                      <div className="strong">{category.name}</div>
                      {category.description && (
                        <div className="tiny muted truncate" style={{ maxWidth: 320 }}>
                          {category.description}
                        </div>
                      )}
                    </td>
                    <td className="hide-sm">
                      {category.parentId ? (
                        <Badge tone="neutral">{byId.get(category.parentId)?.name || '—'}</Badge>
                      ) : (
                        <span className="subtle">Top level</span>
                      )}
                    </td>
                    <td className="num">{formatNumber(category.productCount)}</td>
                    <td className="hide-sm small muted">{formatDate(category.createdAt)}</td>
                    <td className="col-actions">
                      <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(category);
                            setModalOpen(true);
                          }}
                          title="Edit"
                        >
                          <IconEdit size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-ghost"
                          onClick={() => setDeleting(category)}
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
        )}
      </Card>

      <CategoryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        category={editing}
        categories={list}
        onSaved={categories.reload}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        pending={pending}
        title={`Delete "${deleting?.name}"?`}
        confirmLabel="Delete category"
      >
        <p className="small">
          Products in this category are <span className="strong">not</span> deleted — they simply
          become uncategorised.
        </p>
        {deleting?.productCount > 0 && (
          <div style={{ marginTop: 10 }}>
            <Alert tone="warn">
              {deleting.productCount} product{deleting.productCount === 1 ? '' : 's'} will lose this
              category.
            </Alert>
          </div>
        )}
      </ConfirmDialog>
    </main>
  );
}
