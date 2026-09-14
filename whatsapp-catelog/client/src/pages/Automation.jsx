import { useEffect, useState } from 'react';
import { IconBolt, IconClock, IconEdit, IconPlus, IconSync, IconTrash } from '../components/Icons';
import {
  Alert,
  Badge,
  Button,
  Card,
  ChipInput,
  ConfirmDialog,
  EmptyState,
  Input,
  Loading,
  Modal,
  Select,
  Switch,
  Textarea,
} from '../components/ui';
import { useAction, useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { formatDate, formatNumber, formatRelative } from '../lib/format';
import { useApp } from '../store/AppContext';

const REPLY_TYPES = [
  { value: 'text', label: 'Text reply' },
  { value: 'catalog', label: 'Open the catalog' },
  { value: 'product', label: 'A single product' },
  { value: 'product_list', label: 'A collection of products' },
];

const MATCH_TYPES = [
  { value: 'contains', label: 'Message contains the keyword' },
  { value: 'exact', label: 'Message is exactly the keyword' },
  { value: 'regex', label: 'Regular expression' },
];

const EMPTY_RULE = {
  name: '',
  keywords: [],
  matchType: 'contains',
  replyType: 'text',
  replyText: '',
  productRetailerIds: [],
  collectionId: '',
  isActive: true,
  priority: 0,
  cooldownMinutes: 60,
};

function RuleModal({ open, onClose, rule, collections, onSaved }) {
  const { toast } = useApp();
  const { pending, perform } = useAction();
  const [form, setForm] = useState(EMPTY_RULE);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(rule ? { ...EMPTY_RULE, ...rule, collectionId: rule.collectionId || '' } : EMPTY_RULE);
    setError('');
  }, [rule, open]);

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!form.name.trim()) return setError('Give the rule a name.');
    if (!form.keywords.length) return setError('Add at least one keyword.');
    if (form.replyType === 'text' && !form.replyText.trim()) {
      return setError('A text reply needs a message.');
    }
    if (form.replyType === 'product' && !form.productRetailerIds.length) {
      return setError('Enter the SKU of the product to send.');
    }
    if (form.replyType === 'product_list' && !form.collectionId && !form.productRetailerIds.length) {
      return setError('Choose a collection, or list the product SKUs to send.');
    }

    const payload = {
      name: form.name.trim(),
      keywords: form.keywords,
      matchType: form.matchType,
      replyType: form.replyType,
      replyText: form.replyText.trim() || undefined,
      productRetailerIds: form.productRetailerIds,
      collectionId: form.collectionId || undefined,
      isActive: form.isActive,
      priority: Number(form.priority) || 0,
      cooldownMinutes: Number(form.cooldownMinutes) || 0,
    };

    const result = await perform(() =>
      rule ? api.updateAutoReplyRule(rule.id, payload) : api.createAutoReplyRule(payload),
    );
    if (result) {
      toast(rule ? 'Rule updated.' : 'Rule created.');
      onClose();
      onSaved?.();
      return undefined;
    }
    return undefined;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={rule ? 'Edit auto-reply rule' : 'New auto-reply rule'}
      description="Answers an incoming customer message automatically when a keyword matches."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {rule ? 'Save changes' : 'Create rule'}
          </Button>
        </>
      }
    >
      <div className="col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <Input
          label="Rule name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="e.g. Property enquiry"
          autoFocus
        />

        <div className="field">
          <span className="field-label">
            Keywords<span className="req">*</span>
          </span>
          <ChipInput
            value={form.keywords}
            onChange={(value) => set('keywords', value)}
            placeholder="property details, price, send catalogue…"
          />
          <span className="field-hint">
            Press Enter or comma after each keyword. Matching ignores capitalisation.
          </span>
        </div>

        <Select
          label="Match type"
          value={form.matchType}
          onChange={(e) => set('matchType', e.target.value)}
          options={MATCH_TYPES}
        />

        <Select
          label="Reply with"
          value={form.replyType}
          onChange={(e) => set('replyType', e.target.value)}
          options={REPLY_TYPES}
        />

        {form.replyType === 'product_list' && (
          <Select
            label="Collection"
            value={form.collectionId}
            onChange={(e) => set('collectionId', e.target.value)}
            hint="The products in this collection are sent as one multi-product message."
          >
            <option value="">Use SKUs below instead</option>
            {(collections || []).map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name} ({collection.productCount} products)
              </option>
            ))}
          </Select>
        )}

        {(form.replyType === 'product' ||
          (form.replyType === 'product_list' && !form.collectionId) ||
          form.replyType === 'catalog') && (
          <div className="field">
            <span className="field-label">
              Product SKUs
              {form.replyType === 'catalog' ? ' (thumbnail)' : ''}
            </span>
            <ChipInput
              value={form.productRetailerIds}
              onChange={(value) => set('productRetailerIds', value)}
              placeholder="PROPERTY-123"
            />
            <span className="field-hint">
              {form.replyType === 'catalog'
                ? 'Optional — the first SKU is used as the catalog thumbnail.'
                : 'The retailer ID shown on each product.'}
            </span>
          </div>
        )}

        <Textarea
          label={form.replyType === 'text' ? 'Reply message' : 'Message shown with the products'}
          required={form.replyType === 'text'}
          value={form.replyText}
          onChange={(e) => set('replyText', e.target.value)}
          rows={3}
          placeholder="Thanks for your interest! Here are the details…"
        />

        <div className="form-grid">
          <Input
            label="Priority"
            type="number"
            min="0"
            value={form.priority}
            onChange={(e) => set('priority', e.target.value)}
            hint="Higher wins when several rules match."
          />
          <Input
            label="Cooldown (minutes)"
            type="number"
            min="0"
            value={form.cooldownMinutes}
            onChange={(e) => set('cooldownMinutes', e.target.value)}
            hint="Do not reply to the same customer again within this time."
          />
        </div>

        <Switch
          label="Rule is active"
          checked={form.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
        />
      </div>
    </Modal>
  );
}

/** Dry run: type a message and see which rule would answer it. */
function RuleTester() {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const { pending, perform } = useAction();

  const test = async () => {
    if (!text.trim()) return;
    const outcome = await perform(() => api.previewAutoReply(text.trim()));
    setResult(outcome || null);
  };

  return (
    <Card title="Test a message" description="Check which rule would fire. Nothing is sent.">
      <div className="col gap-3">
        <div className="row gap-2">
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && test()}
            placeholder="Send me property details"
          />
          <Button variant="secondary" onClick={test} loading={pending}>
            Test
          </Button>
        </div>

        {result &&
          (result.matched ? (
            <Alert tone="success" title={`"${result.rule.name}" would reply`}>
              Reply type: {REPLY_TYPES.find((t) => t.value === result.rule.replyType)?.label}
              {result.rule.replyText && <div className="small" style={{ marginTop: 4 }}>“{result.rule.replyText}”</div>}
            </Alert>
          ) : (
            <Alert tone="info" title="No rule matches">
              This message would be left for you to answer manually.
            </Alert>
          ))}
      </div>
    </Card>
  );
}

export default function Automation() {
  const { toast } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const status = useAsync(() => api.automationStatus(), []);
  const rules = useAsync(() => api.autoReplyRules(), []);
  const collections = useAsync(() => api.collections().catch(() => []), []);
  const { pending, perform } = useAction();

  const toggleRule = async (rule) => {
    const result = await perform(() => api.updateAutoReplyRule(rule.id, { isActive: !rule.isActive }));
    if (result) {
      toast(rule.isActive ? 'Rule paused.' : 'Rule activated.');
      rules.reload();
    }
  };

  const remove = async () => {
    const result = await perform(() => api.deleteAutoReplyRule(deleting.id));
    if (result) {
      toast('Rule deleted.');
      setDeleting(null);
      rules.reload();
    }
  };

  const runSyncNow = async () => {
    const result = await perform(() => api.runAutomationSync());
    if (result) {
      toast('Sync run across every connected catalog.');
      status.reload();
    }
  };

  const list = rules.data || [];

  return (
    <main className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Automation</h1>
          <p>Keep the catalog in step with Meta, and answer common questions without lifting a finger.</p>
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
            New rule
          </Button>
        </div>
      </div>

      <div className="col gap-5">
        {/* ------------------------------------------------- scheduled sync */}
        <Card
          title={
            <span className="row gap-2">
              <IconClock size={16} />
              Scheduled catalog sync
            </span>
          }
          actions={
            <Button size="sm" variant="secondary" icon={<IconSync size={14} />} loading={pending} onClick={runSyncNow}>
              Run now
            </Button>
          }
        >
          {status.loading ? (
            <Loading />
          ) : (
            <>
              <dl className="kv">
                <dt>Status</dt>
                <dd>
                  {status.data?.syncEnabled ? (
                    <Badge tone="success" dot>
                      Enabled
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Disabled</Badge>
                  )}
                </dd>

                <dt>Schedule</dt>
                <dd className="mono">{status.data?.syncCron || '—'}</dd>

                <dt>Next run</dt>
                <dd>
                  {status.data?.nextSyncAt
                    ? `${formatDate(status.data.nextSyncAt, { withTime: true })} (${formatRelative(status.data.nextSyncAt)})`
                    : status.data?.syncEnabled
                      ? 'Not scheduled — check the cron expression'
                      : '—'}
                </dd>
              </dl>

              <div style={{ marginTop: 'var(--space-4)' }}>
                <Alert tone="info">
                  Each run pulls every connected catalog from Meta, reconciles it, and pushes any
                  local changes that are still pending. Change the schedule with{' '}
                  <code>CATALOG_SYNC_CRON</code> in the server environment.
                </Alert>
              </div>
            </>
          )}
        </Card>

        {/* --------------------------------------------------- auto replies */}
        {!status.loading && !status.data?.autoReplyEnabled && (
          <Alert tone="warn" title="Auto-reply is switched off on the server">
            Rules below are saved but will not fire until <code>AUTO_REPLY_ENABLED=true</code>.
          </Alert>
        )}

        <Card
          title={
            <span className="row gap-2">
              <IconBolt size={16} />
              Keyword auto-replies ({list.length})
            </span>
          }
          bodyClass=""
        >
          {rules.loading ? (
            <Loading />
          ) : !list.length ? (
            <EmptyState
              icon={<IconBolt size={22} />}
              title="No rules yet"
              description="Create a rule so a customer asking for “property details” is answered instantly with your catalog."
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditing(null);
                    setModalOpen(true);
                  }}
                >
                  Create a rule
                </Button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Keywords</th>
                    <th>Replies with</th>
                    <th className="num hide-sm">Fired</th>
                    <th className="hide-sm">Last fired</th>
                    <th>Active</th>
                    <th className="col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        <div className="strong">{rule.name}</div>
                        <div className="tiny muted">
                          Priority {rule.priority} · {rule.cooldownMinutes}m cooldown
                        </div>
                      </td>
                      <td>
                        <div className="row wrap gap-1" style={{ maxWidth: 260 }}>
                          {rule.keywords.slice(0, 3).map((keyword) => (
                            <Badge key={keyword} tone="neutral">
                              {keyword}
                            </Badge>
                          ))}
                          {rule.keywords.length > 3 && (
                            <span className="tiny muted">+{rule.keywords.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="small">
                        {REPLY_TYPES.find((t) => t.value === rule.replyType)?.label || rule.replyType}
                      </td>
                      <td className="num hide-sm">{formatNumber(rule.timesFired)}</td>
                      <td className="hide-sm small muted nowrap">
                        {rule.lastFiredAt ? formatRelative(rule.lastFiredAt) : 'Never'}
                      </td>
                      <td>
                        <label className="switch">
                          <input
                            type="checkbox"
                            role="switch"
                            checked={rule.isActive}
                            onChange={() => toggleRule(rule)}
                            disabled={pending}
                          />
                        </label>
                      </td>
                      <td className="col-actions">
                        <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(rule);
                              setModalOpen(true);
                            }}
                            title="Edit"
                          >
                            <IconEdit size={14} />
                          </Button>
                          <Button
                            size="sm"
                            variant="danger-ghost"
                            onClick={() => setDeleting(rule)}
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

        <RuleTester />
      </div>

      <RuleModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        rule={editing}
        collections={collections.data}
        onSaved={rules.reload}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        pending={pending}
        title={`Delete "${deleting?.name}"?`}
        confirmLabel="Delete rule"
      >
        <p className="small">This rule will stop answering customers immediately.</p>
      </ConfirmDialog>
    </main>
  );
}
