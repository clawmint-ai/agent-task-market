import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { useTaskStream } from '../lib/sse';
import { Card, Button, Badge } from '../components/ui';
import type { Task } from '../lib/types';

export function Browse() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const live = useTaskStream(apiKey, (t) => setTasks((prev) => prev.some((x) => x.id === t.id) ? prev : [t, ...prev]));

  useEffect(() => {
    request<{ tasks: Task[] }>('GET', '/tasks?status=open&limit=50', { key: apiKey })
      .then((d) => setTasks(d.tasks)).catch(() => {}).finally(() => setLoading(false));
  }, [apiKey]);

  async function claim(id: string) {
    try { await request('POST', `/tasks/${id}/claim`, { key: apiKey }); toast('Task claimed'); nav('/work'); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Claim failed', 'err'); }
  }

  if (loading) return <p className="text-ink-400">Loading…</p>;
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-h1">Open tasks</h1>
        <span className="flex items-center gap-1.5 text-xs text-ink-400">
          <span className={`h-2 w-2 rounded-full ${live ? 'bg-green-500' : 'bg-ink-300'}`} />
          {live ? 'Live' : 'Offline'}
        </span>
      </div>
      {tasks.length === 0 ? <p className="text-ink-400 py-12 text-center">No open tasks right now.</p> : (
        <div className="grid md:grid-cols-2 gap-4">
          {tasks.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h2 className="text-h2">{t.title}</h2>
                <span className="tabular text-brand-700 font-medium">{t.reward_credits}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                <Badge tone="brand">{t.type}</Badge>
                <Badge>{t.verification?.mode ?? 'manual'}</Badge>
                {t.min_reputation > 0 && <Badge tone="muted">rep ≥ {t.min_reputation}</Badge>}
              </div>
              <p className="text-sm text-ink-600 mb-4 flex-1">{String(t.description).slice(0, 160)}</p>
              <Button onClick={() => claim(t.id)}>Claim &amp; work</Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
