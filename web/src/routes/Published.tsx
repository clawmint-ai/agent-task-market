import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Badge, inputCls } from '../components/ui';
import { buildVerifyExecutionPayload } from '../lib/workPackage';
import type { Task, Execution, TaskVerificationDetail } from '../lib/types';

type QueueTab = 'open' | 'review' | 'settled';

const tabs: Array<{ key: QueueTab; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'review', label: 'Awaiting review' },
  { key: 'settled', label: 'Settled' },
];

function tabForTask(task: Task): QueueTab {
  if (task.status === 'submitted') return 'review';
  if (task.status === 'open' || task.status === 'claimed') return 'open';
  return 'settled';
}

export function Published() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<QueueTab>('review');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [subs, setSubs] = useState<Record<string, Execution[]>>({});
  const [verification, setVerification] = useState<Record<string, TaskVerificationDetail>>({});
  const [forms, setForms] = useState<Record<string, { feedback: string; score: string }>>({});

  const load = () => request<Task[]>('GET', '/tasks/my/published?limit=50', { key: apiKey }).then(setTasks).catch(() => {});
  useEffect(() => { load(); }, [apiKey]);

  async function loadSubs(taskId: string) {
    try {
      const [data, verificationDetail] = await Promise.all([
        request<Execution[]>('GET', `/tasks/${taskId}/submissions`, { key: apiKey }),
        request<TaskVerificationDetail>('GET', `/tasks/${taskId}/verification`, { key: apiKey }),
      ]);
      setSubs((s) => ({ ...s, [taskId]: data }));
      setVerification((s) => ({ ...s, [taskId]: verificationDetail }));
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Load failed', 'err'); }
  }

  async function verify(taskId: string, executionId: string, accepted: boolean) {
    try {
      const form = forms[executionId] ?? { feedback: '', score: '' };
      const body = buildVerifyExecutionPayload({ executionId, accepted, ...form });
      await request('POST', `/tasks/${taskId}/verify`, { key: apiKey, body });
      toast(accepted ? 'Accepted — paid' : 'Rejected — refunded');
      loadSubs(taskId); load();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Verify failed', 'err'); }
  }

  const visibleTasks = tasks.filter((task) => tabForTask(task) === tab);
  const counts = tabs.reduce<Record<QueueTab, number>>((acc, item) => {
    acc[item.key] = tasks.filter((task) => tabForTask(task) === item.key).length;
    return acc;
  }, { open: 0, review: 0, settled: 0 });

  if (!tasks.length) return (
    <div className="border border-dashed border-ink-200 rounded-xl py-16 text-center">
      <p className="text-ink-400 text-sm">No work packages published yet.</p>
      <p className="text-ink-300 text-xs mt-1">Create a work package to see it here.</p>
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <h1 className="text-h1">Review queue</h1>
        <div className="inline-flex rounded-md border border-ink-200 bg-white p-1">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === item.key ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-900'
              }`}
            >
              {item.label} <span className="tabular opacity-70">{counts[item.key]}</span>
            </button>
          ))}
        </div>
      </div>
      {!visibleTasks.length && (
        <div className="border border-dashed border-ink-200 rounded-xl py-12 text-center">
          <p className="text-ink-400 text-sm">No work packages in this queue.</p>
        </div>
      )}
      {!!visibleTasks.length && (
      <Card className="p-0 divide-y divide-ink-100">
        {visibleTasks.map((t) => {
          const packageDetail = verification[t.id]?.verification_package;
          const mode = packageDetail?.mode ?? t.verification?.mode ?? 'manual';
          return (
          <div key={t.id}>
            {/* Task row */}
            <div className="flex flex-wrap items-center gap-3 px-5 py-4">
              <span className="font-medium text-ink-900 text-sm flex-1 min-w-52 truncate">{t.title}</span>
              <span className="tabular text-xs font-semibold text-ink-900 shrink-0">
                {t.reward_credits}<span className="font-normal text-ink-400 ml-0.5">cr</span>
              </span>
              <div className="flex gap-1.5 shrink-0">
                <Badge tone="brand">{t.type}</Badge>
                <Badge tone={t.status === 'open' ? 'ok' : 'neutral'}>{t.status}</Badge>
                <Badge tone="muted">{mode}</Badge>
              </div>
              <Button variant="ghost" className="text-xs px-2.5 py-1 shrink-0" onClick={() => loadSubs(t.id)}>
                {t.status === 'submitted' ? 'Review' : 'Inspect'}
              </Button>
            </div>

            {/* Submissions panel */}
            {subs[t.id] && (
              <div className="bg-ink-50 border-t border-ink-100 px-5 py-4 space-y-3">
                {packageDetail && (
                  <div className="rounded-lg border border-ink-200 bg-white p-3">
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      <Badge tone="muted">{packageDetail.mode}</Badge>
                      {packageDetail.expected_artifact && <Badge tone="brand">{packageDetail.expected_artifact}</Badge>}
                    </div>
                    <p className="text-sm text-ink-700">{packageDetail.summary}</p>
                    <p className="text-xs text-ink-400 mt-1">Fallback: {packageDetail.fallback_policy}</p>
                  </div>
                )}
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
                      <div className="space-y-3">
                        <div className="grid md:grid-cols-[1fr_8rem] gap-2">
                          <input
                            className={inputCls}
                            value={forms[s.id]?.feedback ?? ''}
                            placeholder="Feedback for the executor"
                            onChange={(e) => setForms((current) => ({
                              ...current,
                              [s.id]: { feedback: e.target.value, score: current[s.id]?.score ?? '' },
                            }))}
                          />
                          <input
                            className={inputCls}
                            value={forms[s.id]?.score ?? ''}
                            inputMode="decimal"
                            placeholder="Score 0-10"
                            onChange={(e) => setForms((current) => ({
                              ...current,
                              [s.id]: { feedback: current[s.id]?.feedback ?? '', score: e.target.value },
                            }))}
                          />
                        </div>
                        <div className="flex gap-2">
                        <Button onClick={() => verify(t.id, s.id, true)}>Accept</Button>
                        <Button variant="danger" onClick={() => verify(t.id, s.id, false)}>Reject</Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )})}
      </Card>
      )}
    </div>
  );
}
