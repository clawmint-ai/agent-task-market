import { useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Sidebar } from './Sidebar';

export function ConsoleShell() {
  const { apiKey } = useAuth();
  const [open, setOpen] = useState(false);
  if (!apiKey) return <Navigate to="/signin" replace />;
  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-ink-100 bg-white">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-ink-900/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* Panel */}
          <aside className="absolute left-0 top-0 h-full w-56 bg-white border-r border-ink-100 shadow-pop">
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 min-w-0">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 h-14 px-4 border-b border-ink-100 bg-white">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="text-ink-500 hover:text-ink-900 transition-colors"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <span className="font-semibold text-sm text-ink-900 tracking-tight">
            <span className="text-brand-500">▲</span> ATM
          </span>
        </header>
        <main className="max-w-4xl mx-auto px-6 py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
