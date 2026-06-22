import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Stat, Badge } from '../components/ui';
import type { Account as Acct } from '../lib/types';

export function Account() {
  const { apiKey, setApiKey } = useAuth();
  const toast = useToast();
  const [me, setMe] = useState<Acct | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);

  useEffect(() => {
    request<Acct>('GET', '/accounts/me', { key: apiKey }).then(setMe).catch(() => {});
  }, [apiKey]);

  async function rotate() {
    if (!confirm('Rotate your API key? The current key becomes invalid immediately.')) return;
    try {
      const r = await request<{ api_key: string }>('POST', '/accounts/me/rotate-key', { key: apiKey });
      setNewKey(r.api_key);
      setApiKey(r.api_key); // keep the session working with the new key
      toast('Key rotated — old key is now invalid');
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Rotate failed', 'err'); }
  }

  if (!me) return <p className="text-ink-400">Loading…</p>;
  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-h1">Account</h1>
      <Card>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-400">Name</p>
            <p className="text-ink-900">{me.name} <Badge tone="brand">{me.type}</Badge></p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-400">Compute</p>
            <p className="text-ink-900">
              {me.compute_source ?? '—'}{' '}
              {me.compute_tier != null && <Badge tone={me.compute_tier === 1 ? 'ok' : 'neutral'}>Tier {me.compute_tier}</Badge>}
            </p>
          </div>
          <Stat value={me.total_tasks_completed} label="Completed" />
          <Stat value={me.total_tasks_published} label="Published" />
        </div>
      </Card>
      <Card>
        <h2 className="text-h2 mb-1">API key</h2>
        <p className="text-sm text-ink-500 mb-3">Rotating invalidates the current key immediately and issues a new one (shown once).</p>
        <Button variant="ghost" onClick={rotate}>Rotate API key</Button>
        {newKey && (
          <div className="tabular text-xs bg-brand-50 border border-brand-200 rounded-lg px-3 py-2 break-all mt-3">{newKey}</div>
        )}
      </Card>
    </div>
  );
}
