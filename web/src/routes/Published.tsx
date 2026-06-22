import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Badge } from '../components/ui';
import type { Task, Execution } from '../lib/types';

export function Published() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subs, setSubs] = useState<Record<string, Execution[]>>({});

  const load = () => request<Task[]>('GET', '/tasks/my/published?limit=50', { key: apiKey }).then(setTasks).catch(() => {});
  useEffect(() => { load(); }, [apiKey]);

  async function loadSubs(taskId: string) {
    try {
      const data = await request<Execution[]>('GET', `/tasks/${taskId}/submissions`, { key: apiKey });
      setSubs((s) => ({ ...s, [taskId]: data }));
    }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Load failed', 'err'); }
  }
  async function verify(taskId: string, executionId: string, accepted: boolean) {
    try { await request('POST', `/tasks/${taskId}/verify`, { key: apiKey, body: { execution_id: executionId, accepted } });
      toast(accepted ? 'Accepted — paid' : 'Rejected — refunded'); loadSubs(taskId); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Verify failed', 'err'); }
  }

  if (!tasks.length) return <p className="text-ink-400 py-12 text-center">You haven't published any tasks yet.</p>;
  return (
    <div className="space-y-3">
      <h1 className="text-h1 mb-2">My tasks</h1>
      {tasks.map((t) => (
        <Card key={t.id}>
          <div className="flex items-start justify-between gap-2 mb-2">
            <h2 className="text-h2">{t.title}</h2>
            <span className="tabular text-brand-700 font-medium">{t.reward_credits}</span>
          </div>
          <div className="flex flex-wrap gap-1.5"><Badge tone="brand">{t.type}</Badge><Badge>{t.status}</Badge></div>
          {t.status === 'submitted' && (
            <Button variant="ghost" className="mt-3" onClick={() => loadSubs(t.id)}>Review submissions</Button>
          )}
          {subs[t.id]?.map((s) => (
            <div key={s.id} className="border border-ink-200 rounded-lg p-4 mt-3 bg-ink-50">
              <p className="text-xs text-ink-500 mb-2">by {s.executor_name ?? s.executor_id} · <Badge>{s.status}</Badge></p>
              <pre className="bg-white border border-ink-200 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap mb-3">{s.result}</pre>
              {s.status === 'submitted' && (
                <div className="flex gap-2">
                  <Button onClick={() => verify(t.id, s.id, true)}>Accept</Button>
                  <Button variant="danger" onClick={() => verify(t.id, s.id, false)}>Reject</Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}
