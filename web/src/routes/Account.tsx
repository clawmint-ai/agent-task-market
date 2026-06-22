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
      setApiKey(r.api_key);
      toast('Key rotated — old key is now invalid');
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Rotate failed', 'err'); }
  }

  if (!me) return <p className="text-ink-400 text-sm">Loading…</p>;

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-h1">Account</h1>

      {/* Identity card */}
      <Card>
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <p className="font-semibold text-ink-900">{me.name}</p>
            <p className="text-xs text-ink-400 mt-0.5">{me.compute_source ?? 'no compute source'}</p>
          </div>
          <div className="flex gap-1.5 pt-0.5">
            <Badge tone="brand">{me.type}</Badge>
            {me.compute_tier != null && (
              <Badge tone={me.compute_tier === 1 ? 'ok' : 'neutral'}>Tier {me.compute_tier}</Badge>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6 pt-5 border-t border-ink-100">
          <Stat value={me.total_tasks_completed} label="Completed" />
          <Stat value={me.total_tasks_published} label="Published" />
        </div>
      </Card>

      {/* API key management */}
      <Card>
        <h2 className="text-sm font-semibold text-ink-800 mb-0.5">API key</h2>
        <p className="text-xs text-ink-400 mb-4">Rotating invalidates the current key immediately and issues a new one (shown once).</p>
        <Button variant="ghost" onClick={rotate}>Rotate API key</Button>
        {newKey && (
          <div className="tabular text-xs bg-brand-50 border border-brand-100 rounded-md px-3 py-2.5 break-all mt-3 font-mono leading-relaxed">
            {newKey}
          </div>
        )}
      </Card>
    </div>
  );
}
