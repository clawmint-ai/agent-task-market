import { useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useToast } from '../components/Toaster';
import { Card, Button, Badge, inputCls } from '../components/ui';
import type { RiskFlag } from '../lib/types';

export function Admin() {
  const toast = useToast();
  const [token, setToken] = useState('');
  const [reconcile, setReconcile] = useState<unknown>(null);
  const [flags, setFlags] = useState<RiskFlag[] | null>(null);
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
    try { setFlags(await request<RiskFlag[]>('GET', '/admin/risk-flags', { headers: hdr() })); }
    catch (e) { toast(adminErr(e), 'err'); }
  }
  async function act(id: string, action: 'release' | 'confirm') {
    try {
      await request('POST', `/admin/risk-flags/${id}/${action}`, { headers: hdr() });
      toast(`Flag ${action}ed`); loadFlags();
    } catch (e) { toast(adminErr(e), 'err'); }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <h1 className="text-h1">Admin</h1>

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

      {/* Risk flags */}
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
    </div>
  );
}
