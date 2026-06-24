import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, request } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { buildSubmitExecutionPayload } from '../lib/workPackage';
import { Badge, Button, Card, Stat, inputCls } from '../components/ui';
import type { ExecutionDetail as ExecutionDetailView } from '../lib/types';

const terminalStatuses = new Set(['accepted', 'rejected']);

function formatDate(value?: string | null) {
  if (!value) return 'pending';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recorded';
  return date.toLocaleString();
}

function formatJson(value?: Record<string, unknown>) {
  if (!value || !Object.keys(value).length) return '';
  return JSON.stringify(value, null, 2);
}

function timeline(detail: ExecutionDetailView) {
  const execution = detail.execution;
  const submitted = execution.status !== 'in_progress';
  const verified = terminalStatuses.has(execution.status);
  const settled = detail.settlement_summary.status !== 'pending_review';

  return [
    { label: 'Claimed', state: 'complete', detail: formatDate(execution.created_at) },
    { label: 'Submitted', state: submitted ? 'complete' : 'current', detail: submitted ? formatDate(execution.submitted_at) : 'awaiting deliverable' },
    { label: 'Verified', state: verified ? 'complete' : submitted ? 'current' : 'pending', detail: verified ? formatDate(execution.verified_at) : submitted ? 'awaiting verification' : 'pending submission' },
    { label: 'Settled', state: settled ? 'complete' : 'pending', detail: detail.settlement_summary.status },
  ];
}

export function ExecutionDetail() {
  const { id } = useParams();
  const { apiKey } = useAuth();
  const toast = useToast();
  const [detail, setDetail] = useState<ExecutionDetailView | null>(null);
  const [result, setResult] = useState('');
  const [metadata, setMetadata] = useState('');

  useEffect(() => {
    if (!id) return;
    request<ExecutionDetailView>('GET', `/executions/${id}`, { key: apiKey }).then((data) => {
      setDetail(data);
      setResult(data.execution.result ?? '');
      setMetadata(formatJson(data.execution.result_metadata));
    }).catch(() => {});
  }, [apiKey, id]);

  async function submit() {
    if (!detail) return;
    try {
      const body = buildSubmitExecutionPayload({ result, resultMetadata: metadata });
      const updated = await request('POST', `/tasks/${detail.execution.task_id}/submit`, { key: apiKey, body });
      toast((updated as { auto_verified?: boolean; status?: string }).auto_verified
        ? ((updated as { status?: string }).status === 'accepted' ? 'Auto-accepted — paid' : 'Auto-rejected')
        : 'Submitted — awaiting review');
      const refreshed = await request<ExecutionDetailView>('GET', `/executions/${detail.execution.id}`, { key: apiKey });
      setDetail(refreshed);
      setResult(refreshed.execution.result ?? '');
      setMetadata(formatJson(refreshed.execution.result_metadata));
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : 'Submit failed', 'err');
    }
  }

  if (!detail) return <p className="text-ink-400 text-sm">Loading…</p>;

  return (
    <div className="space-y-5">
      <div>
        <Link to="/work" className="text-xs text-ink-400 hover:text-ink-700">Back to executions</Link>
        <h1 className="text-h1 mt-2 leading-none">{detail.work_package.title}</h1>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <Badge tone="brand">{detail.work_package.type}</Badge>
          <Badge tone="neutral">{detail.execution.status}</Badge>
          <Badge tone="muted">{detail.verification_summary.mode}</Badge>
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
          <Stat value={detail.work_package.reward_credits} label="Reward" accent />
          <Stat value={detail.execution.score ?? '—'} label="Score" />
          <Stat value={detail.settlement_summary.status} label="Settlement" />
          <Stat value={detail.execution.agent_key_name ?? detail.execution.agent_key_id ?? '—'} label="Agent identity" />
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-ink-800 mb-4">Lifecycle</h2>
        <div className="grid md:grid-cols-4 gap-3">
          {timeline(detail).map((step) => (
            <div key={step.label} className="flex gap-3">
              <span
                className={`mt-0.5 h-2.5 w-2.5 rounded-full shrink-0 ${
                  step.state === 'complete' ? 'bg-brand-500' : step.state === 'current' ? 'bg-amber-500' : 'bg-ink-200'
                }`}
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink-800">{step.label}</p>
                <p className="text-[11px] text-ink-400 leading-snug">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
        <Card>
          <h2 className="text-sm font-semibold text-ink-800 mb-2">Verification</h2>
          <p className="text-sm text-ink-700">{detail.verification_summary.summary}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-xs">
            <dt className="text-ink-400">Expected artifact</dt>
            <dd className="text-ink-700 text-right">{detail.verification_summary.expected_artifact ?? 'not specified'}</dd>
            <dt className="text-ink-400">Fallback</dt>
            <dd className="text-ink-700 text-right">{detail.verification_summary.fallback_policy}</dd>
          </dl>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink-800 mb-2">Settlement</h2>
          <p className="text-sm text-ink-700">{detail.settlement_summary.status}</p>
          <p className="text-xs text-ink-400 mt-1">{detail.settlement_summary.source}</p>
          <div className="mt-4 divide-y divide-ink-100">
            {detail.settlement_summary.ledger_rows.length ? detail.settlement_summary.ledger_rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between py-2 text-xs">
                <span className="text-ink-500">{row.reason}</span>
                <span className={row.delta > 0 ? 'text-green-600' : 'text-red-500'}>{row.delta > 0 ? '+' : ''}{row.delta}</span>
              </div>
            )) : <p className="text-xs text-ink-400">No ledger rows yet.</p>}
          </div>
        </Card>
      </div>

      {detail.execution.status === 'in_progress' && (
        <Card>
          <h2 className="text-sm font-semibold text-ink-800 mb-3">Submit deliverable</h2>
          <div className="space-y-3">
            <textarea
              rows={5}
              className={inputCls}
              placeholder="Paste your deliverable here..."
              value={result}
              onChange={(event) => setResult(event.target.value)}
            />
            <textarea
              rows={4}
              className={`${inputCls} font-mono text-xs`}
              placeholder='Optional metadata JSON, e.g. {"answer": {"score": 10}}'
              value={metadata}
              onChange={(event) => setMetadata(event.target.value)}
            />
            <Button onClick={submit}>Submit result</Button>
          </div>
        </Card>
      )}

      {(detail.execution.result || detail.execution.status !== 'in_progress') && (
        <Card>
          <h2 className="text-sm font-semibold text-ink-800 mb-2">Submitted artifact</h2>
          {detail.execution.result ? (
            <pre className="bg-ink-50 border border-ink-100 rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap font-mono max-h-72">
              {detail.execution.result}
            </pre>
          ) : (
            <p className="text-xs text-ink-400">No artifact recorded.</p>
          )}
          {!!formatJson(detail.execution.result_metadata) && (
            <>
              <h3 className="text-xs font-semibold text-ink-700 mt-4 mb-2">Result metadata</h3>
              <pre className="bg-ink-50 border border-ink-100 rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap font-mono max-h-56">
                {formatJson(detail.execution.result_metadata)}
              </pre>
            </>
          )}
          {detail.execution.feedback && (
            <p className="text-xs text-ink-500 mt-3 leading-relaxed">{detail.execution.feedback}</p>
          )}
        </Card>
      )}
    </div>
  );
}
