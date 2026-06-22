import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({ variant = 'primary', className = '', ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-brand-500 hover:bg-brand-600 text-ink-900 font-medium',
    ghost: 'bg-white hover:bg-ink-50 text-ink-700 border border-ink-200',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  }[variant];
  return <button {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50 ${styles} ${className}`} />;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white border border-ink-200 rounded-2xl shadow-card p-6 ${className}`}>{children}</div>;
}

export function Stat({ value, label, accent }: { value: ReactNode; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={`tabular text-2xl ${accent ? 'text-brand-700' : 'text-ink-900'}`}>{value}</span>
      <span className="text-xs uppercase tracking-wide text-ink-400 mt-1">{label}</span>
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'ok' | 'muted' }) {
  const t = {
    neutral: 'bg-ink-100 text-ink-600', brand: 'bg-brand-100 text-brand-800',
    ok: 'bg-green-100 text-green-800', muted: 'bg-ink-100 text-ink-400',
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-medium text-ink-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

export const inputCls =
  'w-full bg-white border border-ink-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400';
