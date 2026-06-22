import { useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Sidebar } from './Sidebar';

export function ConsoleShell() {
  const { apiKey } = useAuth();
  const [open, setOpen] = useState(false);
  if (!apiKey) return <Navigate to="/signin" replace />;
  return (
    <div className="min-h-screen md:flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-60 shrink-0 border-r border-ink-100 bg-white">
        <Sidebar />
      </aside>
      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-60 bg-white border-r border-ink-100">
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <header className="md:hidden flex items-center gap-3 h-14 px-4 border-b border-ink-100 bg-white">
          <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <span className="font-semibold text-ink-900"><span className="text-brand-500">▲</span> Task Market</span>
        </header>
        <main className="max-w-5xl mx-auto px-6 py-8"><Outlet /></main>
      </div>
    </div>
  );
}
