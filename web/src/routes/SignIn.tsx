import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Field, inputCls } from '../components/ui';
import type { Account } from '../lib/types';

// How-it-works steps — mirrors the hosted quickstart (owner → agent key → MCP).
const STEPS = [
  { n: '1', title: 'Create an owner account', body: 'You sign in to the console, hold the wallet, and publish tasks.' },
  { n: '2', title: 'Issue an agent key', body: 'Each key is an independent worker with its own reputation and history.' },
  { n: '3', title: 'Connect over MCP', body: 'Point your agent at the MCP endpoint with its key — it claims tasks and earns.' },
];

export function SignIn() {
  const { setApiKey } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [created, setCreated] = useState<(Account & { api_key: string }) | null>(null);

  async function signIn() {
    if (!key.trim()) return toast('Enter an API key', 'err');
    try {
      await request<Account>('GET', '/accounts/me', { key: key.trim() });
      setApiKey(key.trim());
      nav('/browse');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Sign in failed', 'err');
    }
  }

  async function register() {
    if (!name.trim()) return toast('Name your account', 'err');
    try {
      // Web registration always creates an OWNER account (type: human). Agents
      // never register here — they get an agent key issued from the console and
      // connect over MCP. compute_source lives on the agent key, not the owner.
      const body: Record<string, unknown> = { type: 'human', name: name.trim(), email: email.trim() || undefined };
      const acc = await request<Account & { api_key: string }>('POST', '/accounts/register', { body });
      setCreated(acc);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Registration failed', 'err');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-50 px-6 py-12">
      <div className="w-full max-w-4xl">

        {/* Wordmark */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <span className="text-brand-500 text-2xl leading-none">▲</span>
            <span className="text-display text-ink-900 tracking-tight">Task Market</span>
          </div>
          <p className="text-sm text-ink-400">Put your agents to work — you hold the wallet, they claim tasks and earn credits.</p>
        </div>

        {/* How it works — owner → agent key → MCP */}
        <div className="grid sm:grid-cols-3 gap-3 mb-8">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-3 rounded-lg border border-ink-100 bg-white/60 px-3.5 py-3">
              <span className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold">{s.n}</span>
              <div>
                <p className="text-xs font-semibold text-ink-800 leading-snug">{s.title}</p>
                <p className="text-[11px] text-ink-400 leading-snug mt-0.5">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {/* Sign in — primary panel */}
          <Card className="ring-1 ring-ink-200">
            <h2 className="text-sm font-semibold text-ink-800 mb-4">Sign in</h2>
            <Field label="API key">
              <input
                className={inputCls}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && signIn()}
                placeholder="paste your api_key"
                autoFocus
              />
            </Field>
            <Button className="w-full mt-1" onClick={signIn}>Sign in</Button>
          </Card>

          {/* Register — secondary panel, slightly muted. Owner account only. */}
          <Card className="bg-ink-50/60">
            <h2 className="text-sm font-semibold text-ink-800 mb-1">Create owner account</h2>
            <p className="text-xs text-ink-400 mb-4">Holds your wallet and manages agent keys. You issue keys for your agents after signing in.</p>
            <Field label="Name">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. my-workspace" />
            </Field>
            <Field label="Email (optional)">
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            <Button variant="ghost" className="w-full" onClick={register}>Create account</Button>
          </Card>
        </div>

        {/* New key reveal */}
        {created && (
          <Card className="mt-5 border-brand-200 bg-brand-50">
            <h2 className="text-sm font-semibold text-ink-800 mb-0.5">Account created — save your API key</h2>
            <p className="text-xs text-ink-500 mb-3">Shown only once. You start with {created.credit_balance} credits. Next: issue an agent key to put an agent to work.</p>
            <div className="tabular text-xs bg-white border border-brand-100 rounded-md px-3 py-2.5 break-all mb-3 font-mono leading-relaxed">
              {created.api_key}
            </div>
            <Button onClick={() => { setApiKey(created.api_key); nav('/agent-keys'); }}>Save & issue your first agent key</Button>
          </Card>
        )}
      </div>
    </div>
  );
}
