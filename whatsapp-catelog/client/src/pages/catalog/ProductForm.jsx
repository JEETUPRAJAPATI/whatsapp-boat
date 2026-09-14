import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { IconChevronLeft, IconSend, IconUpload } from '../../components/Icons';
import MediaManager from '../../components/MediaManager';
import SendProductModal from '../../components/SendProductModal';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Loading,
  Select,
  Tabs,
  Textarea,
} from '../../components/ui';
import { useAction, useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { AVAILABILITY_LABELS, formatRelative, syncTone } from '../../lib/format';
import { useApp } from '../../store/AppContext';

/**
 * Vertical-specific attributes.
 *
 * Meta's catalog schema has no field for "bedrooms", so these are stored in
 * the product's customFields JSON and appended to the description that Meta
 * does show. Configured here in one array so adding a field is a one-line
 * change, not a migration.
 */
const CUSTOM_FIELDS = [
  { key: 'propertyType', label: 'Property type', type: 'select', options: ['', 'Flat', 'Villa', 'Plot', 'Commercial', 'Office', 'Shop', 'Land'] },
  { key: 'location', label: 'Location', type: 'text', placeholder: 'Area, city' },
  { key: 'area', label: 'Area', type: 'text', placeholder: 'e.g. 1450 sq.ft' },
  { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
  { key: 'bathrooms', label: 'Bathrooms', type: 'number' },
  { key: 'furnishing', label: 'Furnishing', type: 'select', options: ['', 'Unfurnished', 'Semi-furnished', 'Fully furnished'] },
  { key: 'possession', label: 'Possession', type: 'text', placeholder: 'e.g. Ready to move' },
  { key: 'propertyStatus', label: 'Property status', type: 'select', options: ['', 'For sale', 'For rent', 'Sold', 'Rented'] },
  { key: 'builder', label: 'Builder / owner', type: 'text' },
  { key: 'contact', label: 'Contact', type: 'text', placeholder: 'Phone or email' },
];

const EMPTY = {
  name: '',
  description: '',
  price: '',
  currency: 'INR',
  salePrice: '',
  availability: 'IN_STOCK',
  condition: 'NEW',
  brand: '',
  url: '',
  categoryId: '',
  retailerId: '',
  imageUrl: '',
  customFields: {},
};

export default function ProductForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, toastError } = useApp();
  const isEdit = Boolean(id);

  const [tab, setTab] = useState('details');
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [sendOpen, setSendOpen] = useState(false);

  const categories = useAsync(() => api.categories().catch(() => []), []);
  const product = useAsync(
    () => (isEdit ? api.product(id) : Promise.resolve(null)),
    [id],
    { immediate: isEdit },
  );

  const { pending: saving, perform } = useAction();

  // Hydrate the form once the product arrives.
  useEffect(() => {
    if (!product.data) return;
    const p = product.data;
    setForm({
      name: p.name || '',
      description: p.description || '',
      price: String(p.price ?? ''),
      currency: p.currency || 'INR',
      salePrice: p.salePrice != null ? String(p.salePrice) : '',
      availability: p.availability || 'IN_STOCK',
      condition: p.condition || 'NEW',
      brand: p.brand || '',
      url: p.url || '',
      categoryId: p.categoryId || '',
      retailerId: p.retailerId || '',
      // Only surface an externally-hosted URL here; uploaded images are managed
      // on the media tab and would be confusing to show as editable text.
      imageUrl: p.media?.some((m) => m.url === p.imageUrl) ? '' : p.imageUrl || '',
      customFields: p.customFields || {},
    });
  }, [product.data]);

  const set = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const setCustom = (key, value) =>
    setForm((current) => ({ ...current, customFields: { ...current.customFields, [key]: value } }));

  /** Client-side checks that mirror the server's, for a faster answer. */
  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = 'Product name is required.';
    if (form.name.length > 200) next.name = 'Meta limits names to 200 characters.';
    if (!form.description.trim()) next.description = 'Description is required.';

    const price = Number(form.price);
    if (!form.price || !Number.isFinite(price) || price <= 0) {
      next.price = 'Enter a price greater than zero.';
    }
    if (form.salePrice) {
      const sale = Number(form.salePrice);
      if (!Number.isFinite(sale) || sale < 0) next.salePrice = 'Enter a valid sale price.';
      else if (sale >= price) next.salePrice = 'The sale price must be below the regular price.';
    }
    if (form.url && !/^https?:\/\//i.test(form.url)) {
      next.url = 'The URL must start with http:// or https://';
    }
    if (form.imageUrl && !/^https?:\/\//i.test(form.imageUrl)) {
      next.imageUrl = 'The image URL must start with http:// or https://';
    }

    setErrors(next);
    if (Object.keys(next).length) setTab('details');
    return Object.keys(next).length === 0;
  };

  const payload = () => {
    // Strip blank custom fields so the stored JSON stays meaningful.
    const custom = {};
    for (const [key, value] of Object.entries(form.customFields || {})) {
      if (value !== '' && value !== null && value !== undefined) custom[key] = value;
    }

    return {
      name: form.name.trim(),
      description: form.description.trim(),
      price: Number(form.price),
      currency: form.currency,
      salePrice: form.salePrice ? Number(form.salePrice) : undefined,
      availability: form.availability,
      condition: form.condition,
      brand: form.brand.trim() || undefined,
      url: form.url.trim() || undefined,
      categoryId: form.categoryId || undefined,
      imageUrl: form.imageUrl.trim() || undefined,
      customFields: custom,
    };
  };

  const save = async ({ publish = false } = {}) => {
    if (!validate()) return;

    const result = await perform(async () => {
      if (isEdit) {
        const updated = await api.updateProduct(id, payload());
        if (publish && updated.isDraft) await api.publishProduct(id);
        return updated;
      }

      const created = await api.createProduct({
        ...payload(),
        retailerId: form.retailerId.trim() || undefined,
        isDraft: true,
      });

      if (publish) {
        // A brand-new product has no images yet, so publishing immediately
        // would fail validation. Send the operator to the media step instead.
        toast('Draft saved. Add at least one image, then publish.', 'warn');
        navigate(`/catalog/products/${created.id}/edit`);
        return created;
      }
      return created;
    });

    if (!result) return;

    if (isEdit) {
      toast(publish ? 'Product updated and published.' : 'Product updated.');
      product.reload();
    } else if (!publish) {
      toast('Draft saved.');
      navigate(`/catalog/products/${result.id}/edit`);
    }
  };

  const publishNow = async () => {
    const result = await perform(() => api.publishProduct(id));
    if (result) {
      toast('Published to your Meta catalog.');
      product.reload();
    }
  };

  if (isEdit && product.loading && !product.data) {
    return (
      <main className="page page-narrow">
        <Loading label="Loading product…" />
      </main>
    );
  }

  const current = product.data;
  const canPublish = isEdit && current && (current.isDraft || current.syncStatus !== 'SYNCED');

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <div>
          <Link to="/catalog/products" className="row gap-1 small muted" style={{ marginBottom: 6 }}>
            <IconChevronLeft size={14} />
            Back to products
          </Link>
          <h1>{isEdit ? current?.name || 'Edit product' : 'Add product'}</h1>
          {isEdit && current && (
            <div className="row gap-2" style={{ marginTop: 6 }}>
              <span className="tiny muted mono">{current.retailerId}</span>
              {current.isDraft ? (
                <Badge tone="neutral">Draft</Badge>
              ) : (
                <Badge tone={syncTone(current.syncStatus)} dot>
                  {current.syncStatus === 'SYNCED' ? 'Live on WhatsApp' : current.syncStatus}
                </Badge>
              )}
              <span className="tiny muted">Updated {formatRelative(current.updatedAt)}</span>
            </div>
          )}
        </div>

        <div className="page-actions">
          {isEdit && current && !current.isDraft && (
            <Button variant="secondary" icon={<IconSend size={15} />} onClick={() => setSendOpen(true)}>
              Send to customer
            </Button>
          )}
          <Button variant="secondary" onClick={() => save()} loading={saving}>
            {isEdit ? 'Save changes' : 'Save draft'}
          </Button>
          {canPublish ? (
            <Button variant="primary" icon={<IconUpload size={15} />} onClick={publishNow} loading={saving}>
              Publish to WhatsApp
            </Button>
          ) : (
            !isEdit && (
              <Button variant="primary" onClick={() => save({ publish: true })} loading={saving}>
                Save &amp; continue
              </Button>
            )
          )}
        </div>
      </div>

      {isEdit && current?.syncError && (
        <div className="banner-stack">
          <Alert tone="danger" title="Meta rejected the last publish">
            {current.syncError}
          </Alert>
        </div>
      )}

      <Card bodyClass="">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { value: 'details', label: 'Details' },
            { value: 'media', label: 'Images & video', count: current?.media?.length },
            { value: 'attributes', label: 'Property details' },
          ]}
        />

        <div className="card-body">
          {/* ------------------------------------------------------ details */}
          {tab === 'details' && (
            <div className="form-grid">
              <Input
                className="span-2"
                label="Product name"
                required
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="3 BHK Apartment in Gomti Nagar"
                error={errors.name}
                maxLength={200}
                autoFocus
              />

              <Textarea
                className="span-2"
                label="Description"
                required
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Describe the property: highlights, amenities, nearby landmarks…"
                error={errors.description}
                rows={5}
                maxLength={9999}
                hint={`${form.description.length}/9999 — shown to customers in WhatsApp.`}
              />

              <Input
                label="Price"
                required
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(e) => set('price', e.target.value)}
                placeholder="2500000"
                error={errors.price}
              />

              <Select
                label="Currency"
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
                options={[
                  { value: 'INR', label: 'INR — Indian Rupee' },
                  { value: 'USD', label: 'USD — US Dollar' },
                  { value: 'AED', label: 'AED — UAE Dirham' },
                  { value: 'GBP', label: 'GBP — Pound Sterling' },
                  { value: 'EUR', label: 'EUR — Euro' },
                ]}
              />

              <Input
                label="Sale price"
                type="number"
                min="0"
                step="0.01"
                value={form.salePrice}
                onChange={(e) => set('salePrice', e.target.value)}
                placeholder="Optional"
                error={errors.salePrice}
                hint="Shown as a discount when below the regular price."
              />

              <Select
                label="Availability"
                value={form.availability}
                onChange={(e) => set('availability', e.target.value)}
                options={Object.entries(AVAILABILITY_LABELS).map(([value, label]) => ({ value, label }))}
              />

              <Select
                label="Category"
                value={form.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
              >
                <option value="">Uncategorised</option>
                {(categories.data || []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>

              <Input
                label="Brand / builder"
                value={form.brand}
                onChange={(e) => set('brand', e.target.value)}
                placeholder="Optional"
              />

              <Input
                className="span-2"
                label="Product URL"
                value={form.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder="https://yoursite.com/listing/123"
                error={errors.url}
                hint="Where customers land when they tap through from WhatsApp."
              />

              <Input
                className="span-2"
                label="Image URL"
                value={form.imageUrl}
                onChange={(e) => set('imageUrl', e.target.value)}
                placeholder="https://yoursite.com/images/listing-123.jpg"
                error={errors.imageUrl}
                hint="Use this if your photos are already hosted publicly. Otherwise upload them on the Images & video tab — an uploaded main image takes over from this."
              />

              {!isEdit && (
                <Input
                  className="span-2"
                  label="SKU (retailer ID)"
                  value={form.retailerId}
                  onChange={(e) => set('retailerId', e.target.value)}
                  placeholder="Leave blank to generate one"
                  hint="Meta treats this as permanent — it cannot be changed after publishing."
                />
              )}
            </div>
          )}

          {/* -------------------------------------------------------- media */}
          {tab === 'media' && (
            <MediaManager
              productId={id}
              media={current?.media || []}
              onChange={() => product.reload()}
              disabled={saving}
            />
          )}

          {/* --------------------------------------------------- attributes */}
          {tab === 'attributes' && (
            <div className="col gap-4">
              <Alert tone="info">
                These attributes are stored with the product and used in your listings. Meta&apos;s
                catalog schema has no dedicated fields for them, so include the important ones in the
                description too.
              </Alert>

              <div className="form-grid">
                {CUSTOM_FIELDS.map((field) => {
                  const value = form.customFields?.[field.key] ?? '';
                  if (field.type === 'select') {
                    return (
                      <Select
                        key={field.key}
                        label={field.label}
                        value={value}
                        onChange={(e) => setCustom(field.key, e.target.value)}
                      >
                        {field.options.map((option) => (
                          <option key={option} value={option}>
                            {option || 'Not set'}
                          </option>
                        ))}
                      </Select>
                    );
                  }
                  return (
                    <Input
                      key={field.key}
                      label={field.label}
                      type={field.type}
                      value={value}
                      placeholder={field.placeholder}
                      onChange={(e) => setCustom(field.key, e.target.value)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Card>

      {isEdit && current && (
        <SendProductModal open={sendOpen} onClose={() => setSendOpen(false)} product={current} />
      )}
    </main>
  );
}
