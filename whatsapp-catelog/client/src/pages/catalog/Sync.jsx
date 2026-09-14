import { useState } from 'react';
import { IconAlert, IconCheck, IconSync } from '../../components/Icons';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Loading,
  Stat,
} from '../../components/ui';
import { useAction, useAsync } from '../../hooks/useAsync';
import { api } from '../../lib/api';
import { formatDate, formatNumber, formatRelative, syncRunTone } from '../../lib/format';
import { useApp } from '../../store/AppContext';

/**
 * Sync control and conflict resolution.
 *
 * The conflict list is the important half: when the same product changed both
 * here and in Commerce Manager, the system refuses to guess and asks which
 * side wins.
 */
export default function Sync() {
  const { toast } = useApp();
  const [push, setPush] = useState(false);

  const overview = useAsync(() => api.catalogOverview().catch(() => null), []);
  const history = useAsync(() => api.syncHistory({ limit: 15 }).catch(() => []), []);
  const conflicts = useAsync(() => api.syncConflicts().catch(() => []), []);
  const { pending, perform } = useAction();

  const reloadAll = () => {
    overview.reload();
    history.reload();
    conflicts.reload();
  };

  const run = async () => {
    const result = await perform(() => api.runSync({ push }));
    if (result) {
      toast(
        `Sync ${result.status.toLowerCase()} — ${result.created} added, ${result.updated} updated, ` +
          `${result.deleted} missing at Meta, ${result.conflicts} conflicts.`,
        result.status === 'SUCCESS' ? 'success' : 'warn',
      );
      reloadAll();
    }
  };

  const resolve = async (productId, resolution) => {
    const result = await perform(() => api.resolveConflict(productId, resolution));
    if (result) {
      toast(
        resolution === 'local'
          ? 'Your version will overwrite Meta on the next sync.'
          : "Meta's version will be accepted on the next sync.",
      );
      conflicts.reload();
    }
  };

  const runs = history.data || [];
  const conflictList = conflicts.data || [];
  const last = overview.data?.lastSync;

  return (
    <main className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Catalog sync</h1>
          <p>Reconcile this catalog with what Meta actually has.</p>
        </div>
        <div className="page-actions">
          <Checkbox
            label="Also push my pending changes"
            checked={push}
            onChange={(e) => setPush(e.target.checked)}
          />
          <Button variant="primary" icon={<IconSync size={15} />} loading={pending} onClick={run}>
            Sync now
          </Button>
        </div>
      </div>

      <div className="col gap-5">
        {/* ---------------------------------------------------- last result */}
        <div className="stats">
          <Stat
            label="Last synced"
            value={last ? formatRelative(last.finishedAt || last.startedAt) : 'Never'}
            sub={last ? last.status : undefined}
            tone={last?.status === 'FAILED' ? 'danger' : last?.status === 'PARTIAL' ? 'warn' : undefined}
          />
          <Stat label="Added" value={formatNumber(last?.created || 0)} />
          <Stat label="Updated" value={formatNumber(last?.updated || 0)} />
          <Stat
            label="Missing at Meta"
            value={formatNumber(last?.deleted || 0)}
            tone={last?.deleted ? 'warn' : undefined}
          />
          <Stat
            label="Conflicts"
            value={formatNumber(conflictList.length)}
            tone={conflictList.length ? 'danger' : undefined}
          />
        </div>

        <Alert tone="info" title="What sync does">
          A sync pulls every product from your Meta catalog and compares it with the local record.
          Products only Meta has are imported; products only changed at Meta are updated here.
          Anything changed in <span className="strong">both</span> places is flagged as a conflict
          rather than silently overwritten. Ticking &quot;push my pending changes&quot; also sends
          your local edits up to Meta.
        </Alert>

        {/* ------------------------------------------------------ conflicts */}
        <Card
          title={`Conflicts (${conflictList.length})`}
          description="These need a decision before the next sync can settle them."
          bodyClass=""
        >
          {conflicts.loading ? (
            <Loading />
          ) : !conflictList.length ? (
            <EmptyState
              icon={<IconCheck size={22} />}
              title="No conflicts"
              description="Your catalog and Meta's agree."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Problem</th>
                    <th className="hide-sm">Changed</th>
                    <th className="col-actions">Resolve as</th>
                  </tr>
                </thead>
                <tbody>
                  {conflictList.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="strong">{item.name}</div>
                        <div className="tiny muted mono">{item.retailerId}</div>
                      </td>
                      <td className="small" style={{ maxWidth: 380 }}>
                        {item.syncError}
                      </td>
                      <td className="hide-sm small muted nowrap">{formatRelative(item.updatedAt)}</td>
                      <td className="col-actions">
                        <div className="row gap-1" style={{ justifyContent: 'flex-end' }}>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => resolve(item.id, 'local')}
                            disabled={pending}
                            title="Overwrite Meta with your version"
                          >
                            Keep mine
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => resolve(item.id, 'meta')}
                            disabled={pending}
                            title="Accept the version at Meta"
                          >
                            Use Meta&apos;s
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

        {/* -------------------------------------------------------- history */}
        <Card title="Sync history" bodyClass="">
          {history.loading ? (
            <Loading />
          ) : !runs.length ? (
            <EmptyState
              icon={<IconSync size={22} />}
              title="No syncs yet"
              description="Run your first sync to pull the catalog from Meta."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Trigger</th>
                    <th>Result</th>
                    <th className="num">Added</th>
                    <th className="num">Updated</th>
                    <th className="num hide-sm">Missing</th>
                    <th className="num hide-sm">Conflicts</th>
                    <th className="num">Failed</th>
                    <th className="hide-sm">By</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td className="nowrap small">{formatDate(run.startedAt, { withTime: true })}</td>
                      <td>
                        <Badge tone={run.trigger === 'scheduled' ? 'info' : 'neutral'}>{run.trigger}</Badge>
                      </td>
                      <td>
                        <Badge tone={syncRunTone(run.status)} dot>
                          {run.status}
                        </Badge>
                      </td>
                      <td className="num">{run.created}</td>
                      <td className="num">{run.updated}</td>
                      <td className="num hide-sm">{run.deleted}</td>
                      <td className="num hide-sm">{run.conflicts}</td>
                      <td className="num">
                        {run.failed ? <span style={{ color: 'var(--danger-fg)' }}>{run.failed}</span> : 0}
                      </td>
                      <td className="hide-sm small muted truncate" style={{ maxWidth: 160 }}>
                        {run.triggeredBy || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {runs.some((run) => run.status === 'FAILED') && (
          <Alert tone="warn" title="Some syncs failed">
            A failed run usually means an expired token or a Meta permission problem. Check WhatsApp
            settings, then run the sync again.
          </Alert>
        )}
      </div>
    </main>
  );
}
