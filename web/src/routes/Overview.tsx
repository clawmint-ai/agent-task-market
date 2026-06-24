import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ClipboardCheck, KeyRound, PackageOpen, WalletCards, Wrench } from 'lucide-react';
import { request } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Button, Stat, Badge } from '../components/ui';
import type { MarketOverview } from '../lib/types';

export function Overview() {
  const { apiKey } = useAuth();
  const [overview, setOverview] = useState<MarketOverview | null>(null);

  useEffect(() => {
    request<MarketOverview>('GET', '/market/overview', { key: apiKey }).then(setOverview).catch(() => {});
  }, [apiKey]);

  if (!overview) return <p className="text-ink-400 text-sm">Loading…</p>;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 leading-none">Overview</h1>
          <p className="text-sm text-ink-400 mt-1">Owner console for verifiable agent work.</p>
        </div>
        <Link to="/publish">
          <Button>Create work package</Button>
        </Link>
      </div>

      <Card>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5">
          <Stat value={overview.counts.work_packages_open} label="Open packages" accent />
          <Stat value={overview.counts.submissions_awaiting_review} label="Review queue" />
          <Stat value={overview.counts.executions_in_progress} label="In progress" />
          <Stat value={overview.counts.risk_holds_open} label="Risk holds" />
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-5">
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <WalletCards size={16} className="text-ink-400" />
            <h2 className="text-sm font-semibold text-ink-800">Ledger</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Stat value={overview.wallet.spendable} label="Spendable" accent />
            <Stat value={overview.wallet.frozen_earned} label="Frozen earned" />
            <Stat value={overview.wallet.earned} label="Earned" />
            <Stat value={overview.wallet.gift} label="Gift" />
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-4">
            <KeyRound size={16} className="text-ink-400" />
            <h2 className="text-sm font-semibold text-ink-800">Agent identities</h2>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Stat value={overview.agent_identities.issued} label="Issued" />
            <Stat value={overview.agent_identities.active_credentials} label="Active keys" accent />
            <Stat value={overview.agent_identities.revoked} label="Revoked" />
          </div>
        </Card>
      </div>

      <Card className="p-0">
        <div className="grid md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-ink-100">
          <QuickLink to="/published" Icon={ClipboardCheck} label="Review queue" badge={`${overview.counts.submissions_awaiting_review}`} />
          <QuickLink to="/browse" Icon={PackageOpen} label="Work packages" badge={`${overview.counts.work_packages_open}`} />
          <QuickLink to="/work" Icon={Wrench} label="Executions" badge={`${overview.counts.executions_in_progress}`} />
          <QuickLink to="/admin" Icon={AlertTriangle} label="Market ops" badge={`${overview.counts.risk_holds_open}`} />
        </div>
      </Card>
    </div>
  );
}

function QuickLink({ to, Icon, label, badge }: {
  to: string;
  Icon: typeof PackageOpen;
  label: string;
  badge: string;
}) {
  return (
    <Link to={to} className="flex items-center justify-between gap-3 px-5 py-4 hover:bg-ink-50 transition-colors">
      <span className="flex items-center gap-2.5 text-sm font-medium text-ink-800">
        <Icon size={15} className="text-ink-400" />
        {label}
      </span>
      <Badge tone={badge === '0' ? 'neutral' : 'brand'}>{badge}</Badge>
    </Link>
  );
}
