import { useEffect, useState } from 'react';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Stat, inputCls } from '../components/ui';
import type { CreditsView, ReputationView } from '../lib/types';

export function Wallet() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const [credits, setCredits] = useState<CreditsView | null>(null);
  const [rep, setRep] = useState<ReputationView | null>(null);
  const [amount, setAmount] = useState(0);

  const load = () => {
    request<CreditsView>('GET', '/accounts/me/credits', { key: apiKey }).then(setCredits).catch(() => {});
    request<ReputationView>('GET', '/accounts/me/reputation', { key: apiKey }).then(setRep).catch(() => {});
  };
  useEffect(() => { load(); }, [apiKey]);

  async function redeem() {
    if (amount <= 0) return toast('Enter an amount', 'err');
    try { await request('POST', '/accounts/me/redeem', { key: apiKey, body: { amount } });
      toast('Redeemed'); setAmount(0); load(); }
    catch (e) {
      const msg = e instanceof ApiError
        ? (e.status === 403 ? 'Redemption is not enabled on this server yet' : e.message)
        : 'Redeem failed';
      toast(msg, 'err');
    }
  }

  if (!credits || !rep) return <p className="text-ink-400">Loading…</p>;
  return (
    <div className="space-y-6">
      <h1 className="text-h1">Wallet</h1>
      <Card>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <Stat value={credits.earned} label="Earned (redeemable)" accent />
          <Stat value={credits.gift} label="Gift (publish-only)" />
          <Stat value={credits.frozen_earned} label="Frozen (in review)" />
          <Stat value={Number(rep.score).toFixed(1)} label="Reputation" />
        </div>
      </Card>
      <Card>
        <h2 className="text-h2 mb-1">Redeem earned credits</h2>
        <p className="text-sm text-ink-500 mb-3">Only earned credits are redeemable. Gift and frozen credits never redeem.</p>
        <div className="flex gap-2 items-end">
          <div className="flex-1"><input type="number" className={inputCls} value={amount} onChange={(e) => setAmount(Number(e.target.value))} placeholder="amount" /></div>
          <Button onClick={redeem}>Redeem</Button>
        </div>
      </Card>
      <Card>
        <h2 className="text-h2 mb-4">Credit history</h2>
        <div className="divide-y divide-ink-100">
          {credits.history.length ? credits.history.map((h, i) => (
            <div key={i} className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-ink-700">{h.reason}</span>
              <span className={`tabular font-medium ${h.delta > 0 ? 'text-green-600' : 'text-red-500'}`}>{h.delta > 0 ? '+' : ''}{h.delta}</span>
            </div>
          )) : <p className="text-sm text-ink-400 py-4">No transactions yet.</p>}
        </div>
      </Card>
    </div>
  );
}
