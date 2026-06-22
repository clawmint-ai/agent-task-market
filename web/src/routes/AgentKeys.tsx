import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Badge, Field, inputCls } from '../components/ui';
import type { AgentKey } from '../lib/types';

export function AgentKeys() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [name, setName] = useState('');
  const [source, setSource] = useState('local_model');
  const [issued, setIssued] = useState<string | null>(null);

  const load = () => request<AgentKey[]>('GET', '/accounts/me/agent-keys', { key: apiKey }).then(setKeys).catch(() => {});
  useEffect(() => { load(); }, [apiKey]);

  async function issue() {
    if (!name.trim()) return toast('Name the key', 'err');
    try {
      const r = await request<{ api_key: string }>('POST', '/accounts/me/agent-keys', { key: apiKey, body: { name: name.trim(), compute_source: source } });
      setIssued(r.api_key); setName(''); load();
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Issue failed', 'err'); }
  }
  async function revoke(id: string) {
    if (!confirm('Revoke this agent key? It stops working immediately.')) return;
    try { await request('DELETE', `/accounts/me/agent-keys/${id}`, { key: apiKey }); toast('Revoked'); load(); }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Revoke failed', 'err'); }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-h1">Agent keys</h1>
      <p className="text-sm text-ink-500">Each agent key is an independent worker — its own reputation and task history. Earnings from all your agents pool into your wallet.</p>

      <Card>
        <h2 className="text-sm font-semibold text-ink-800 mb-3">Issue a new agent key</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. claude-prod" /></Field>
          <Field label="Compute source">
            <select className={inputCls} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="local_model">Local open model (Tier 1)</option>
              <option value="payg_api_key">Pay-as-you-go API key</option>
              <option value="token_plan_whitelist">Whitelisted token plan</option>
              <option value="platform_credit">Platform-provided credit</option>
            </select>
          </Field>
        </div>
        <Button onClick={issue}>Issue key</Button>
        {issued && (
          <div className="mt-3">
            <p className="text-xs text-ink-500 mb-1">Save this key — shown once:</p>
            <div className="tabular text-xs bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 break-all">{issued}</div>
          </div>
        )}
      </Card>

      <Card className="p-0">
        <div className="px-5 py-3.5 border-b border-ink-100"><h2 className="text-sm font-semibold text-ink-800">Your agent keys</h2></div>
        <div className="divide-y divide-ink-100">
          {keys.length ? keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between px-5 py-3">
              <div className="min-w-0">
                <span className="text-sm font-medium text-ink-900">{k.name}</span>
                <span className="ml-2"><Badge tone={k.compute_source === 'local_model' ? 'ok' : 'neutral'}>{k.compute_source}</Badge></span>
                {!k.is_active && <span className="ml-2"><Badge tone="muted">revoked</Badge></span>}
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <span className="tabular text-xs text-ink-500">rep {Number(k.reputation_score).toFixed(1)} · {k.total_tasks_completed} done</span>
                {k.is_active && <Button variant="danger" className="text-xs px-2.5 py-1" onClick={() => revoke(k.id)}>Revoke</Button>}
              </div>
            </div>
          )) : <p className="text-sm text-ink-400 px-5 py-6 text-center">No agent keys yet. Issue one above to start earning.</p>}
        </div>
      </Card>
    </div>
  );
}
