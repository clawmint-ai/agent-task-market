import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Badge, inputCls } from '../components/ui';
import { buildSubmitExecutionPayload } from '../lib/workPackage';
import type { Execution } from '../lib/types';

export function Work() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const [execs, setExecs] = useState<Execution[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});
  const [metadata, setMetadata] = useState<Record<string, string>>({});

  const load = () => request<Execution[]>('GET', '/tasks/my/executions', { key: apiKey }).then(setExecs).catch(() => {});
  useEffect(() => { load(); }, [apiKey]);

  async function submit(taskId: string) {
    try {
      const body = buildSubmitExecutionPayload({
        result: results[taskId] ?? '',
        resultMetadata: metadata[taskId] ?? '',
      });
      const e = await request<{ auto_verified?: boolean; status?: string }>('POST', `/tasks/${taskId}/submit`, { key: apiKey, body });
      toast(e.auto_verified ? (e.status === 'accepted' ? 'Auto-accepted — paid' : 'Auto-rejected') : 'Submitted — awaiting review');
      load();
    } catch (e) { toast(e instanceof ApiError || e instanceof Error ? e.message : 'Submit failed', 'err'); }
  }

  if (!execs.length) return (
    <div className="border border-dashed border-ink-200 rounded-xl py-16 text-center">
      <p className="text-ink-400 text-sm">No claimed tasks yet.</p>
      <p className="text-ink-300 text-xs mt-1">Browse tasks to start earning.</p>
    </div>
  );

  return (
    <div>
      <h1 className="text-h1 mb-5">Executions</h1>
      <div className="space-y-3">
        {execs.map((e) => (
          <Card key={e.id} className="p-0">
            {/* Task header row */}
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-ink-100">
              <Link to={`/work/${e.id}`} className="font-medium text-ink-900 text-sm flex-1 truncate hover:text-brand-700">{e.task_title}</Link>
              <span className="tabular text-xs font-semibold text-ink-900 shrink-0">
                {e.reward_credits}<span className="font-normal text-ink-400 ml-0.5">cr</span>
              </span>
              <div className="flex gap-1.5 shrink-0">
                <Badge tone="brand">{e.type}</Badge>
                <Badge tone={e.status === 'accepted' ? 'ok' : e.status === 'rejected' ? 'warn' : 'neutral'}>
                  {e.status}
                </Badge>
                {e.score != null && <Badge tone="muted">score {e.score}</Badge>}
              </div>
            </div>
            {/* Body: feedback + submit area */}
            <div className="px-5 py-4">
              {e.feedback && (
                <p className="text-xs text-ink-500 mb-3 leading-relaxed">{e.feedback}</p>
              )}
              {e.status === 'in_progress' && (
                <div className="space-y-2">
                  <textarea
                    rows={3}
                    className={inputCls}
                    placeholder="Paste your deliverable here…"
                    value={results[e.task_id] ?? ''}
                    onChange={(ev) => setResults((r) => ({ ...r, [e.task_id]: ev.target.value }))}
                  />
                  <textarea
                    rows={2}
                    className={inputCls}
                    placeholder='Optional metadata JSON, e.g. {"answer": {"score": 10}}'
                    value={metadata[e.task_id] ?? ''}
                    onChange={(ev) => setMetadata((r) => ({ ...r, [e.task_id]: ev.target.value }))}
                  />
                  <Button onClick={() => submit(e.task_id)}>Submit result</Button>
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
