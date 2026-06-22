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
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Load failed', 'err'); }
  }

  async function verify(taskId: string, executionId: string, accepted: boolean) {
    try {
      await request('POST', `/tasks/${taskId}/verify`, { key: apiKey, body: { execution_id: executionId, accepted } });
      toast(accepted ? 'Accepted — paid' : 'Rejected — refunded');
      loadSubs(taskId); load();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Verify failed', 'err'); }
  }

  if (!tasks.length) return (
    <div className="border border-dashed border-ink-200 rounded-xl py-16 text-center">
      <p className="text-ink-400 text-sm">No published tasks yet.</p>
      <p className="text-ink-300 text-xs mt-1">Publish a task to see it here.</p>
    </div>
  );

  return (
    <div>
      <h1 className="text-h1 mb-5">My tasks</h1>
      <Card className="p-0 divide-y divide-ink-100">
        {tasks.map((t) => (
          <div key={t.id}>
            {/* Task row */}
            <div className="flex items-center gap-3 px-5 py-4">
              <span className="font-medium text-ink-900 text-sm flex-1 truncate">{t.title}</span>
              <span className="tabular text-xs font-semibold text-ink-900 shrink-0">
                {t.reward_credits}<span className="font-normal text-ink-400 ml-0.5">cr</span>
              </span>
              <div className="flex gap-1.5 shrink-0">
                <Badge tone="brand">{t.type}</Badge>
                <Badge tone={t.status === 'open' ? 'ok' : 'neutral'}>{t.status}</Badge>
              </div>
              {t.status === 'submitted' && (
                <Button variant="ghost" className="text-xs px-2.5 py-1 shrink-0" onClick={() => loadSubs(t.id)}>
                  Review
                </Button>
              )}
            </div>

            {/* Submissions panel */}
            {subs[t.id] && (
              <div className="bg-ink-50 border-t border-ink-100 px-5 py-4 space-y-3">
                {subs[t.id].length === 0 && (
                  <p className="text-xs text-ink-400">No submissions yet.</p>
                )}
                {subs[t.id].map((s) => (
                  <div key={s.id} className="bg-white border border-ink-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-ink-500">by {s.executor_name ?? s.executor_id}</span>
                      <Badge tone={s.status === 'accepted' ? 'ok' : s.status === 'rejected' ? 'warn' : 'neutral'}>
                        {s.status}
                      </Badge>
                    </div>
                    <pre className="bg-ink-50 border border-ink-100 rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap font-mono mb-3 max-h-40">
                      {s.result}
                    </pre>
                    {s.status === 'submitted' && (
                      <div className="flex gap-2">
                        <Button onClick={() => verify(t.id, s.id, true)}>Accept</Button>
                        <Button variant="danger" onClick={() => verify(t.id, s.id, false)}>Reject</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
