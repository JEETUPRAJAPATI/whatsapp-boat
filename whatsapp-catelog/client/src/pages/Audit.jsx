import { useEffect, useState } from 'react';
import { IconShield } from '../components/Icons';
import { Badge, Card, EmptyState, ErrorState, Loading, Pagination, SearchInput } from '../components/ui';
import { useAsync, useDebounced } from '../hooks/useAsync';
import { api } from '../lib/api';
import { formatDate, humanize } from '../lib/format';

const ENTITIES = [
  { value: '', label: 'Everything' },
  { value: 'product', label: 'Products' },
  { value: 'catalog', label: 'Catalog' },
  { value: 'collection', label: 'Collections' },
  { value: 'category', label: 'Categories' },
  { value: 'whatsapp_account', label: 'WhatsApp accounts' },
  { value: 'auto_reply_rule', label: 'Auto-reply rules' },
];

/** Colour-codes the action so a scan of the list reads at a glance. */
function actionTone(action, result) {
  if (result === 'failure') return 'danger';
  if (/deleted|disconnected|failed/.test(action)) return 'warn';
  if (/created|published|connected|sent/.test(action)) return 'success';
  return 'neutral';
}

export default function Audit() {
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState('');
  const [result, setResult] = useState('');
  const [page, setPage] = useState(1);

  const debounced = useDebounced(search, 350);
  const logs = useAsync(
    () => api.auditLogs({ action: debounced, entity, result, page, pageSize: 30 }),
    [debounced, entity, result, page],
  );

  useEffect(() => {
    setPage(1);
  }, [debounced, entity, result]);

  const items = logs.data?.items || [];

  return (
    <main className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>Every change made through this panel, and whether it succeeded.</p>
        </div>
      </div>

      <Card bodyClass="">
        <div className="toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Search actions…" />

          <select className="select" style={{ width: 'auto' }} value={entity} onChange={(e) => setEntity(e.target.value)}>
            {ENTITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select className="select" style={{ width: 'auto' }} value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="">Any result</option>
            <option value="success">Succeeded</option>
            <option value="failure">Failed</option>
          </select>
        </div>

        {logs.loading && !logs.data ? (
          <Loading label="Loading audit log…" />
        ) : logs.error ? (
          <ErrorState error={logs.error} onRetry={logs.reload} />
        ) : !items.length ? (
          <EmptyState
            icon={<IconShield size={22} />}
            title="Nothing recorded yet"
            description="Actions like publishing a product or connecting an account appear here."
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Action</th>
                    <th className="hide-sm">Entity</th>
                    <th>Details</th>
                    <th className="hide-sm">By</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((log) => (
                    <tr key={log.id}>
                      <td className="nowrap small muted">{formatDate(log.createdAt, { withTime: true })}</td>
                      <td>
                        <Badge tone={actionTone(log.action, log.result)} dot={log.result === 'failure'}>
                          {log.action}
                        </Badge>
                      </td>
                      <td className="hide-sm small">{humanize(log.entity)}</td>
                      <td className="small" style={{ maxWidth: 420 }}>
                        {log.message || '—'}
                      </td>
                      <td className="hide-sm small muted truncate" style={{ maxWidth: 180 }}>
                        {log.userEmail || 'system'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={logs.data.page}
              pages={logs.data.pages}
              total={logs.data.total}
              pageSize={logs.data.pageSize}
              onPage={setPage}
            />
          </>
        )}
      </Card>
    </main>
  );
}
