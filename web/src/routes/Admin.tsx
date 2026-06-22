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
    try { await request('POST', `/admin/risk-flags/${id}/${action}`, { headers: hdr() });
      toast(`Flag ${action}ed`); loadFlags(); }
    catch (e) { toast(adminErr(e), 'err'); }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-h1">Admin</h1>
      <Card>
        <h2 className="text-h2 mb-1">Admin token</h2>
        <p className="text-sm text-ink-500 mb-3">Required for operator actions. Stored only in this tab.</p>
        <input className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} placeholder="ADMIN_TOKEN" />
      </Card>
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-h2">Ledger reconcile</h2>
          <Button variant="ghost" onClick={runReconcile} disabled={!token}>Run check</Button>
        </div>
        {reconcile != null && (
          <pre className="bg-ink-50 border border-ink-200 rounded-lg p-3 text-xs overflow-x-auto">{JSON.stringify(reconcile, null, 2)}</pre>
        )}
      </Card>
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-h2">Risk flags</h2>
          <Button variant="ghost" onClick={loadFlags} disabled={!token}>Load</Button>
        </div>
        {flags && (flags.length ? (
          <div className="space-y-2">
            {flags.map((f) => (
              <div key={f.id} className="flex items-center justify-between border border-ink-200 rounded-lg p-3">
                <span className="text-sm"><Badge>{f.kind}</Badge> <span className="tabular">{f.amount}</span> <span className="text-ink-400">{f.account_id}</span></span>
                <span className="flex gap-2">
                  <Button onClick={() => act(f.id, 'release')}>Release</Button>
                  <Button variant="danger" onClick={() => act(f.id, 'confirm')}>Confirm</Button>
                </span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-ink-400">No open flags.</p>)}
      </Card>
    </div>
  );
}
