import { useState } from 'react';
import { useAction, useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { formatPhone } from '../lib/format';
import { useApp } from '../store/AppContext';
import { Alert, Button, Checkbox, Input, Modal, Select, Textarea } from './ui';

/**
 * Sends a product, a collection, or the whole catalog to one customer.
 *
 * Shared by the products table and the inbox so "send this to a customer"
 * behaves identically wherever it is triggered.
 */
export default function SendProductModal({
  open,
  onClose,
  product,
  collection,
  presetPhone,
  /** Which mode to open in when no product/collection was handed in. */
  initialMode,
}) {
  const { toast } = useApp();
  const { pending, perform } = useAction();

  const [mode, setMode] = useState(
    initialMode || (collection ? 'collection' : product ? 'product' : 'catalog'),
  );
  const [phone, setPhone] = useState(presetPhone || '');
  const [body, setBody] = useState('');
  const [includeMedia, setIncludeMedia] = useState(false);
  /** Set when the caller did not name a product and the user picks one here. */
  const [pickedProductId, setPickedProductId] = useState('');

  const customers = useAsync(() => api.customers().catch(() => []), [], { immediate: open });

  // Only loaded when the modal has to offer a product chooser.
  const needsPicker = mode === 'product' && !product;
  const pickable = useAsync(
    () =>
      needsPicker
        ? api.products({ state: 'published', pageSize: 100 }).catch(() => null)
        : Promise.resolve(null),
    [needsPicker],
  );

  const send = async () => {
    const to = phone.replace(/[^\d+]/g, '');
    if (!to) {
      toast('Enter a customer phone number.', 'error');
      return;
    }

    const result = await perform(() => {
      if (mode === 'product') {
        const productId = product?.id || pickedProductId;
        if (!productId) throw new Error('Choose a product to send.');
        return api.sendProduct({
          to,
          productId,
          body: body || undefined,
          includeMedia,
        });
      }
      if (mode === 'collection') {
        return api.sendProductList({
          to,
          collectionId: collection.id,
          header: collection.name.slice(0, 60),
          body: body || 'Here are some options for you.',
        });
      }
      return api.sendCatalog({
        to,
        body: body || 'Browse our full catalogue here.',
        thumbnail_product_retailer_id: product?.retailerId,
      });
    });

    if (result) {
      toast('Sent to the customer on WhatsApp.');
      setBody('');
      onClose();
    }
  };

  const title =
    mode === 'product'
      ? `Send "${product?.name || 'product'}"`
      : mode === 'collection'
        ? `Send "${collection?.name || 'collection'}"`
        : 'Send catalog';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="Delivered as an official WhatsApp interactive message."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} loading={pending}>
            Send on WhatsApp
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        <Select label="What to send" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="product">{product ? 'This product card' : 'A single product'}</option>
          {collection && <option value="collection">This collection (multi-product)</option>}
          <option value="catalog">The whole catalog</option>
        </Select>

        {needsPicker && (
          <Select
            label="Product"
            required
            value={pickedProductId}
            onChange={(e) => setPickedProductId(e.target.value)}
            hint={pickable.loading ? 'Loading published products…' : undefined}
          >
            <option value="">Choose a product…</option>
            {(pickable.data?.items || []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} — {item.retailerId}
              </option>
            ))}
          </Select>
        )}

        <Input
          label="Customer phone number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98765 43210"
          list="customer-phones"
          required
          hint="Include the country code."
        />
        <datalist id="customer-phones">
          {(customers.data || []).map((customer) => (
            <option key={customer.id} value={customer.phoneNumber}>
              {customer.name || customer.profileName || formatPhone(customer.phoneNumber)}
            </option>
          ))}
        </datalist>

        <Textarea
          label="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            mode === 'product'
              ? 'Optional note shown above the product card…'
              : 'Message shown with the products…'
          }
          rows={3}
          maxLength={1024}
        />

        {mode === 'product' && (
          <Checkbox
            label="Also send the product photos and videos first"
            checked={includeMedia}
            onChange={(e) => setIncludeMedia(e.target.checked)}
          />
        )}

        <Alert tone="info">
          WhatsApp only allows free-form messages within 24 hours of the customer&apos;s last
          message. Outside that window this will be refused, and you will need an approved template.
        </Alert>
      </div>
    </Modal>
  );
}
