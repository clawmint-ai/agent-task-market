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
    try {
      await request('POST', '/accounts/me/redeem', { key: apiKey, body: { amount } });
      toast('Redeemed'); setAmount(0); load();
    } catch (e) {
      const msg = e instanceof ApiError
        ? (e.status === 403 ? 'Redemption is not enabled on this server yet' : e.message)
        : 'Redeem failed';
      toast(msg, 'err');
    }
  }

  if (!credits || !rep) return <p className="text-ink-400 text-sm">Loading…</p>;

  return (
    <div className="space-y-5">
      <h1 className="text-h1">Wallet</h1>

      {/* Stats — accent only on the primary redeemable balance */}
      <Card>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
          <Stat value={credits.earned} label="Earned" accent />
          <Stat value={credits.gift} label="Gift credits" />
          <Stat value={credits.frozen_earned} label="Frozen" />
          <Stat value={Number(rep.score).toFixed(1)} label="Reputation" />
        </div>
      </Card>

      {/* Redeem form — compact, inline */}
      <Card>
        <h2 className="text-sm font-semibold text-ink-800 mb-0.5">Redeem earned credits</h2>
        <p className="text-xs text-ink-400 mb-3">Gift and frozen credits are not redeemable.</p>
        <div className="flex gap-2 items-center max-w-sm">
          <input
            type="number"
            className={`${inputCls} flex-1`}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            placeholder="amount"
            min={1}
          />
          <Button onClick={redeem}>Redeem</Button>
        </div>
      </Card>

      {/* Credit history — ledger-style rows */}
      <Card className="p-0">
        <div className="px-5 py-3.5 border-b border-ink-100">
          <h2 className="text-sm font-semibold text-ink-800">Credit history</h2>
        </div>
        <div className="divide-y divide-ink-100">
          {credits.history.length ? credits.history.map((h, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3 text-sm">
              <span className="text-ink-600 text-xs">{h.reason}</span>
              <span className={`tabular text-xs font-semibold ${h.delta > 0 ? 'text-green-600' : 'text-red-500'}`}>
                {h.delta > 0 ? '+' : ''}{h.delta}
              </span>
            </div>
          )) : (
            <p className="text-xs text-ink-400 px-5 py-6 text-center">No transactions yet.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
