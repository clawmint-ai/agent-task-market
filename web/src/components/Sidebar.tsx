import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, PackageOpen, PlusCircle, Wrench, ClipboardList, WalletCards, User, ShieldCheck, LogOut, KeyRound,
} from 'lucide-react';
import { useAuth } from '../lib/auth';

const navGroups: { label: string; items: { to: string; label: string; Icon: typeof LayoutDashboard }[] }[] = [
  { label: 'Work', items: [
    { to: '/overview', label: 'Overview', Icon: LayoutDashboard },
    { to: '/browse', label: 'Work packages', Icon: PackageOpen },
    { to: '/work', label: 'Executions', Icon: Wrench },
    { to: '/published', label: 'Review queue', Icon: ClipboardList },
    { to: '/publish', label: 'Create work package', Icon: PlusCircle },
  ]},
  { label: 'Account', items: [
    { to: '/wallet', label: 'Ledger', Icon: WalletCards },
    { to: '/agent-keys', label: 'Agent identities', Icon: KeyRound },
    { to: '/account', label: 'Account', Icon: User },
  ]},
  { label: 'Ops', items: [
    { to: '/admin', label: 'Market ops', Icon: ShieldCheck },
  ]},
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { setApiKey } = useAuth();
  const nav = useNavigate();
  return (
    <div className="flex flex-col h-full">
      {/* Wordmark */}
      <a
        href="/"
        className="flex items-center gap-2 px-4 h-14 shrink-0 font-semibold text-sm text-ink-900 tracking-tight hover:text-ink-900 transition-colors"
      >
        <span className="text-brand-500">▲</span> ATM
      </a>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {navGroups.map((g) => (
          <div key={g.label}>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-ink-300 select-none">
              {g.label}
            </p>
            <ul className="space-y-0.5">
              {g.items.map(({ to, label, Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors relative ${
                        isActive
                          ? 'bg-ink-100 text-ink-900 font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-0.5 before:rounded-full before:bg-brand-400'
                          : 'text-ink-500 hover:bg-ink-50 hover:text-ink-800'
                      }`
                    }
                  >
                    <Icon size={15} strokeWidth={1.75} />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Sign out */}
      <button
        onClick={() => { setApiKey(null); nav('/signin'); }}
        className="flex items-center gap-2.5 px-4 py-3.5 shrink-0 border-t border-ink-100 text-sm text-ink-400 hover:text-ink-700 transition-colors"
      >
        <LogOut size={15} strokeWidth={1.75} />
        Sign out
      </button>
    </div>
  );
}
