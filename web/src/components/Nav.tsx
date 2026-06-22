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
    <nav className="flex gap-1 overflow-x-auto">
      {items.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg whitespace-nowrap transition-colors ${
              isActive ? 'bg-brand-100 text-brand-800' : 'text-ink-500 hover:text-ink-800 hover:bg-ink-100'
            }`}>
          <Icon size={16} /> {label}
        </NavLink>
      ))}
    </nav>
  );
}
