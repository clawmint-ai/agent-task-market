import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Button({ variant = 'primary', className = '', ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const styles = {
    // Gold fill — reserve for the single primary action per view
    primary: 'bg-brand-400 hover:bg-brand-500 text-ink-900 font-medium shadow-sm',
    // Ghost — clearly secondary: muted border, no background
    ghost: 'bg-transparent hover:bg-ink-100 text-ink-600 hover:text-ink-900 border border-ink-200 hover:border-ink-300',
    danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm',
  }[variant];
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed ${styles} ${className}`}
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  // Slightly reduced radius + tighter shadow for a less "bubbly" SaaS feel
  return (
    <div className={`bg-white border border-ink-100 rounded-xl shadow-card p-5 ${className}`}>
      {children}
    </div>
  );
}

// Borderless section container — for grouping without another card border
export function Section({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`space-y-1 ${className}`}>{children}</div>;
}

export function Stat({ value, label, accent }: { value: ReactNode; label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      {/* accent stat uses brand only for the value itself, not a background */}
      <span className={`tabular text-2xl font-semibold leading-none ${accent ? 'text-brand-600' : 'text-ink-900'}`}>
        {value}
      </span>
      <span className="text-[11px] uppercase tracking-widest text-ink-400 font-medium">{label}</span>
    </div>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'brand' | 'ok' | 'muted' | 'warn' }) {
  const t: Record<string, string> = {
    neutral: 'bg-ink-100 text-ink-500',
    brand:   'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
    ok:      'bg-green-50 text-green-700 ring-1 ring-green-200',
    muted:   'text-ink-400',
    warn:    'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium tracking-wide ${t[tone]}`}>
      {children}
    </span>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mb-4">
      <span className="block text-xs font-medium uppercase tracking-wide text-ink-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}

// Scannable ledger row — use instead of a Card when listing many similar items
export function Row({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center justify-between py-3 border-b border-ink-100 last:border-0 gap-3 ${className}`}>
      {children}
    </div>
  );
}

export const inputCls =
  'w-full bg-white border border-ink-200 rounded-md px-3 py-2 text-sm placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-0 focus:border-transparent transition-shadow';
