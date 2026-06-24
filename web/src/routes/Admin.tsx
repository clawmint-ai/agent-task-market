import { useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useToast } from '../components/Toaster';
import { normalizeRiskFlagsResponse, riskFlagLabel } from '../lib/marketOps';
import { Card, Button, Badge, Stat, inputCls } from '../components/ui';
import type { RiskFlag } from '../lib/types';

export function Admin() {
  const toast = useToast();
  const [token, setToken] = useState('');
  const [reconcile, setReconcile] = useState<unknown>(null);
  const [flags, setFlags] = useState<RiskFlag[] | null>(null);
  const [selectedFlagId, setSelectedFlagId] = useState<string | null>(null);
  const hdr = () => ({ 'x-admin-token': token });

  function adminErr(e: unknown) {
    if (e instanceof ApiError && e.status === 404) return 'Admin is not enabled on this server';
    return e instanceof ApiError ? e.message : 'Request failed';
  }
  async function runReconcile() {
    try { setReconcile(await request('GET', '/admin/reconcile', { headers: hdr() })); }
    catch (e) { toast(adminErr(e), 'err'); }
  }
  async function loadFlags() {
    try {
      const data = await request<RiskFlag[] | { flags?: RiskFlag[] }>('GET', '/admin/risk-flags', { headers: hdr() });
      const normalized = normalizeRiskFlagsResponse(data);
      setFlags(normalized);
      setSelectedFlagId((current) => current && normalized.some((flag) => flag.id === current) ? current : normalized[0]?.id ?? null);
    }
    catch (e) { toast(adminErr(e), 'err'); }
  }
  async function act(id: string, action: 'release' | 'confirm') {
    try {
      await request('POST', `/admin/risk-flags/${id}/${action}`, { headers: hdr() });
      toast(`Flag ${action}ed`); loadFlags();
    } catch (e) { toast(adminErr(e), 'err'); }
  }

  const selectedFlag = flags?.find((flag) => flag.id === selectedFlagId) ?? null;

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-h1">Market ops</h1>

      {/* Token input */}
      <Card>
        <h2 className="text-sm font-semibold text-ink-800 mb-0.5">Admin token</h2>
        <p className="text-xs text-ink-400 mb-3">Required for operator actions. Stored only in this tab.</p>
        <input
          className={`${inputCls} max-w-sm font-mono text-xs`}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ADMIN_TOKEN"
          type="password"
        />
      </Card>

      <Card>
        <div className="grid grid-cols-3 gap-x-6 gap-y-5">
          <Stat value="Manual" label="Verifier health" accent />
          <Stat value="Unavailable" label="Stale claims" />
          <Stat value="Unavailable" label="Settlement latency" />
        </div>
        <p className="text-xs text-ink-400 mt-4">
          Dedicated verifier health, stale-claim counts, and settlement latency endpoints are not exposed yet. Reconcile and risk flags remain available when admin routes are enabled.
        </p>
      </Card>

      {/* Reconcile */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-ink-800">Ledger reconcile</h2>
            <p className="text-xs text-ink-400 mt-0.5">Check for balance drift across all accounts.</p>
          </div>
          <Button variant="ghost" onClick={runReconcile} disabled={!token}>Run check</Button>
        </div>
        {reconcile != null && (
          <pre className="bg-ink-50 border border-ink-100 rounded-md p-3 text-xs font-mono overflow-x-auto leading-relaxed">
            {JSON.stringify(reconcile, null, 2)}
          </pre>
        )}
      </Card>

      <div className="grid md:grid-cols-[1fr_18rem] gap-5">
      <Card className="p-0">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-ink-100">
          <div>
            <h2 className="text-sm font-semibold text-ink-800">Risk flags</h2>
            <p className="text-xs text-ink-400 mt-0.5">Frozen credits pending operator decision.</p>
          </div>
          <Button variant="ghost" onClick={loadFlags} disabled={!token}>Load</Button>
        </div>
        {flags && (
          flags.length ? (
            <div className="divide-y divide-ink-100">
              {flags.map((f) => (
                <div key={f.id} className="flex items-center gap-3 px-5 py-3.5">
                  <Badge tone="warn">{f.kind}</Badge>
                  <span className="tabular text-xs font-semibold text-ink-900">{f.amount}</span>
                  <span className="text-xs text-ink-400 flex-1 truncate font-mono">{f.account_id}</span>
                  <div className="flex gap-2 shrink-0">
                    <Button variant="ghost" className="text-xs px-2.5 py-1" onClick={() => setSelectedFlagId(f.id)}>Inspect</Button>
                    <Button variant="ghost" className="text-xs px-2.5 py-1" onClick={() => act(f.id, 'release')}>Release</Button>
                    <Button variant="danger" className="text-xs px-2.5 py-1" onClick={() => act(f.id, 'confirm')}>Confirm</Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ink-400 px-5 py-6 text-center">No open flags.</p>
          )
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-ink-800 mb-3">Risk detail</h2>
        {selectedFlag ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-ink-800">{riskFlagLabel(selectedFlag)}</p>
              <p className="text-[11px] text-ink-400 font-mono mt-0.5">{selectedFlag.account_id}</p>
            </div>
            <pre className="bg-ink-50 border border-ink-100 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap max-h-56">
              {JSON.stringify(selectedFlag.detail ?? {}, null, 2)}
            </pre>
            <textarea
              className={`${inputCls} text-xs`}
              rows={3}
              disabled
              placeholder="Resolution notes are disabled until backend note persistence ships."
            />
          </div>
        ) : (
          <p className="text-xs text-ink-400">Load risk flags to inspect a held payout.</p>
        )}
      </Card>
      </div>
    </div>
  );
}
