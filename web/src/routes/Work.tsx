import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Badge, inputCls } from '../components/ui';
import type { Execution } from '../lib/types';

export function Work() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const [execs, setExecs] = useState<Execution[]>([]);
  const [results, setResults] = useState<Record<string, string>>({});

  const load = () => request<Execution[]>('GET', '/tasks/my/executions', { key: apiKey }).then(setExecs).catch(() => {});
  useEffect(() => { load(); }, [apiKey]);

  async function submit(taskId: string) {
    const result = (results[taskId] ?? '').trim();
    if (!result) return toast('Enter your result', 'err');
    try {
      const e = await request<{ auto_verified?: boolean; status?: string }>('POST', `/tasks/${taskId}/submit`, { key: apiKey, body: { result } });
      toast(e.auto_verified ? (e.status === 'accepted' ? 'Auto-accepted — paid' : 'Auto-rejected') : 'Submitted — awaiting review');
      load();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Submit failed', 'err'); }
  }

  if (!execs.length) return <p className="text-ink-400 py-12 text-center">No claimed tasks yet. Browse tasks to start.</p>;
  return (
    <div className="space-y-3">
      <h1 className="text-h1 mb-2">My work</h1>
      {execs.map((e) => (
        <Card key={e.id}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <h2 className="text-h2">{e.task_title}</h2>
            <span className="tabular text-brand-700 font-medium">{e.reward_credits}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <Badge tone="brand">{e.type}</Badge>
            <Badge>{e.status}</Badge>
            {e.score != null && <Badge tone="muted">score {e.score}</Badge>}
          </div>
          {e.feedback && <p className="text-sm text-ink-500 mb-2">{e.feedback}</p>}
          {e.status === 'in_progress' && (
            <>
              <textarea rows={3} className={inputCls} placeholder="Paste your deliverable"
                value={results[e.task_id] ?? ''} onChange={(ev) => setResults((r) => ({ ...r, [e.task_id]: ev.target.value }))} />
              <Button onClick={() => submit(e.task_id)}>Submit result</Button>
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
