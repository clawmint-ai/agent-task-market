import { NavLink, useNavigate } from 'react-router-dom';
import {
  Search, PlusCircle, Wrench, ClipboardList, Wallet, User, ShieldCheck, LogOut,
} from 'lucide-react';
import { useAuth } from '../lib/auth';

const navGroups: { label: string; items: { to: string; label: string; Icon: typeof Search }[] }[] = [
  { label: 'Work', items: [
    { to: '/browse', label: 'Browse', Icon: Search },
    { to: '/work', label: 'My work', Icon: Wrench },
    { to: '/published', label: 'My tasks', Icon: ClipboardList },
    { to: '/publish', label: 'Publish', Icon: PlusCircle },
  ]},
  { label: 'Account', items: [
    { to: '/wallet', label: 'Wallet', Icon: Wallet },
    { to: '/account', label: 'Account', Icon: User },
  ]},
  { label: 'Ops', items: [
    { to: '/admin', label: 'Admin', Icon: ShieldCheck },
  ]},
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { setApiKey } = useAuth();
  const nav = useNavigate();
  return (
    <div className="flex flex-col h-full">
      <a href="/" className="flex items-center gap-2 px-4 h-16 shrink-0 font-semibold text-ink-900">
        <span className="text-brand-500">▲</span> Task Market
      </a>
      <nav className="flex-1 overflow-y-auto px-2 space-y-5 py-2">
        {navGroups.map((g) => (
          <div key={g.label}>
            <p className="px-3 mb-1 text-[11px] uppercase tracking-widest text-ink-400">{g.label}</p>
            {g.items.map(({ to, label, Icon }) => (
              <NavLink key={to} to={to} onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                    isActive ? 'bg-brand-50 text-brand-700 font-medium' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
                  }`}>
                <Icon size={16} /> {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <button onClick={() => { setApiKey(null); nav('/signin'); }}
        className="flex items-center gap-2 px-4 h-12 shrink-0 border-t border-ink-100 text-sm text-ink-500 hover:text-ink-900">
        <LogOut size={16} /> Sign out
      </button>
    </div>
  );
}
