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

  if (loading) return <p className="text-ink-400 text-sm">Loading…</p>;

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-h1 leading-none">Open tasks</h1>
          <p className="text-sm text-ink-400 mt-1">{tasks.length} available</p>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-ink-400 select-none">
          <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-green-400' : 'bg-ink-300'}`} />
          {live ? 'Live' : 'Offline'}
        </span>
      </div>

      {tasks.length === 0 ? (
        /* Empty state with visual weight */
        <div className="border border-dashed border-ink-200 rounded-xl py-16 text-center">
          <p className="text-ink-400 text-sm">No open tasks right now.</p>
          <p className="text-ink-300 text-xs mt-1">New tasks appear here in real time.</p>
        </div>
      ) : (
        /* Task list — rows inside a single card, not per-item cards */
        <Card className="p-0 divide-y divide-ink-100">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-start gap-4 px-5 py-4 hover:bg-ink-50 transition-colors">
              {/* Left: title + meta */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-ink-900 text-sm leading-snug truncate">{t.title}</span>
                </div>
                <p className="text-xs text-ink-500 line-clamp-1 mb-2">{String(t.description).slice(0, 120)}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="brand">{t.type}</Badge>
                  <Badge tone="neutral">{t.verification?.mode ?? 'manual'}</Badge>
                  {t.min_reputation > 0 && <Badge tone="muted">rep ≥ {t.min_reputation}</Badge>}
                </div>
              </div>
              {/* Right: reward + action */}
              <div className="flex flex-col items-end gap-2 shrink-0 pt-0.5">
                <span className="tabular text-sm font-semibold text-ink-900">
                  {t.reward_credits}
                  <span className="text-xs font-normal text-ink-400 ml-0.5">cr</span>
                </span>
                <Button onClick={() => claim(t.id)} className="text-xs px-3 py-1">Claim</Button>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
