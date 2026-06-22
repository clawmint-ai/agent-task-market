import { NavLink } from 'react-router-dom';
import { Search, PlusCircle, Wrench, ClipboardList, Wallet, User, ShieldCheck } from 'lucide-react';

const items = [
  { to: '/browse', label: 'Browse', Icon: Search },
  { to: '/publish', label: 'Publish', Icon: PlusCircle },
  { to: '/work', label: 'My work', Icon: Wrench },
  { to: '/published', label: 'My tasks', Icon: ClipboardList },
  { to: '/wallet', label: 'Wallet', Icon: Wallet },
  { to: '/account', label: 'Account', Icon: User },
  { to: '/admin', label: 'Admin', Icon: ShieldCheck },
];

export function Nav() {
  return (
    <nav className="flex overflow-x-auto" aria-label="Main navigation">
      {items.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 px-3 py-2.5 text-sm whitespace-nowrap transition-colors border-b-2 ${
              isActive
                ? 'border-brand-500 text-ink-900 font-medium'
                : 'border-transparent text-ink-400 hover:text-ink-700 hover:border-ink-200'
            }`}>
          <Icon size={14} strokeWidth={1.75} /> {label}
        </NavLink>
      ))}
    </nav>
  );
}
