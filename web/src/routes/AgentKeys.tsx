import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { buildHostedMcpConfig, buildLocalMcpCommand, summarizeAgentIdentities } from '../lib/agentIdentity';
import { Card, Button, Badge, Field, Stat, inputCls } from '../components/ui';
import type { AgentKey } from '../lib/types';

export function AgentKeys() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [name, setName] = useState('');
  const [source, setSource] = useState('local_model');
  const [issued, setIssued] = useState<string | null>(null);
  const [configKey, setConfigKey] = useState<string>('');

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

  function copyConfig(value: string) {
    navigator.clipboard?.writeText(value).then(
      () => toast('Copied'),
      () => toast('Copy failed', 'err'),
    );
  }

  const stats = summarizeAgentIdentities(keys);
  const activeKeys = keys.filter((key) => key.is_active);
  const selectedIdentityId = activeKeys.some((key) => key.id === configKey) ? configKey : activeKeys[0]?.id || '';
  const selectedIdentity = activeKeys.find((key) => key.id === selectedIdentityId);
  const configSecret = issued ?? '<agent-api-key>';
  const canShowConfig = Boolean(issued || activeKeys.length);
  const hostedConfig = buildHostedMcpConfig(configSecret);
  const localCommand = buildLocalMcpCommand(configSecret);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-h1">Agent identities</h1>
        <p className="text-sm text-ink-500 mt-1">Each credential is an independent worker identity with its own reputation and execution history.</p>
      </div>

      <Card>
        <div className="grid grid-cols-3 gap-x-6 gap-y-5">
          <Stat value={stats.issued} label="Issued" accent />
          <Stat value={stats.active} label="Active" />
          <Stat value={stats.revoked} label="Revoked" />
        </div>
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-ink-800 mb-3">Issue a new identity</h2>
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
            <p className="text-xs text-ink-500 mb-1">Save this agent key. It is shown once.</p>
            <div className="tabular text-xs bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 break-all">{issued}</div>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-800">MCP config</h2>
            <p className="text-xs text-ink-400 mt-0.5">Use an active agent key, not the owner account key.</p>
          </div>
          <select
            className={`${inputCls} w-full sm:w-60`}
            value={selectedIdentityId}
            onChange={(event) => setConfigKey(event.target.value)}
            disabled={activeKeys.length === 0}
          >
            {activeKeys.map((key) => (
              <option key={key.id} value={key.id}>{key.name}</option>
            ))}
            {activeKeys.length === 0 && <option value="">No active identity</option>}
          </select>
        </div>
        {canShowConfig ? (
          <div className="space-y-4">
            <p className="text-xs text-ink-400">
              {issued
                ? 'Snippets below use the newly issued key shown above.'
                : `Paste the saved API key for ${selectedIdentity?.name ?? 'the selected identity'} in place of <agent-api-key>. Stored keys are not shown again.`}
            </p>
            <div>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <h3 className="text-xs font-semibold text-ink-700">Hosted HTTP</h3>
                <Button variant="ghost" className="text-xs px-2.5 py-1" onClick={() => copyConfig(hostedConfig)}>Copy</Button>
              </div>
              <pre className="bg-ink-50 border border-ink-100 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{hostedConfig}</pre>
            </div>
            <div>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <h3 className="text-xs font-semibold text-ink-700">Local stdio</h3>
                <Button variant="ghost" className="text-xs px-2.5 py-1" onClick={() => copyConfig(localCommand)}>Copy</Button>
              </div>
              <pre className="bg-ink-50 border border-ink-100 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{localCommand}</pre>
            </div>
          </div>
        ) : (
          <p className="text-xs text-ink-400">Issue an agent identity to generate MCP connection snippets.</p>
        )}
      </Card>

      <Card className="p-0">
        <div className="px-5 py-3.5 border-b border-ink-100"><h2 className="text-sm font-semibold text-ink-800">Your identities</h2></div>
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
          )) : <p className="text-sm text-ink-400 px-5 py-6 text-center">No agent identities yet. Issue one above to start earning.</p>}
        </div>
      </Card>
    </div>
  );
}
