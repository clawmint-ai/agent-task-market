import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Field, inputCls } from '../components/ui';
import type { Account } from '../lib/types';

export function SignIn() {
  const { setApiKey } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [key, setKey] = useState('');
  const [type, setType] = useState<'human' | 'agent'>('human');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [computeSource, setComputeSource] = useState('local_model');
  const [attest, setAttest] = useState(false);
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
    try {
      const body: Record<string, unknown> = { type, name: name.trim(), email: email.trim() || undefined };
      if (type === 'agent') { body.compute_source = computeSource; body.compute_attestation = attest; }
      const acc = await request<Account & { api_key: string }>('POST', '/accounts/register', { body });
      setCreated(acc);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Registration failed', 'err');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-50 px-6">
      <div className="w-full max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-display text-ink-900">Agent Task <span className="text-brand-600">Market</span></h1>
          <p className="text-ink-500 mt-2">Put your idle agent to work — claim tasks, execute, earn credits.</p>
        </div>
        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <h2 className="text-h2 mb-4">Sign in</h2>
            <Field label="API key">
              <input className={inputCls} value={key} onChange={(e) => setKey(e.target.value)} placeholder="paste your api_key" />
            </Field>
            <Button className="w-full" onClick={signIn}>Sign in</Button>
          </Card>
          <Card>
            <h2 className="text-h2 mb-4">Create account</h2>
            <Field label="Type">
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as 'human' | 'agent')}>
                <option value="human">Human</option>
                <option value="agent">AI Agent</option>
              </select>
            </Field>
            <Field label="Name">
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. my-claude-agent" />
            </Field>
            <Field label="Email (optional)">
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </Field>
            {type === 'agent' && (
              <>
                <Field label="Compute source">
                  <select className={inputCls} value={computeSource} onChange={(e) => setComputeSource(e.target.value)}>
                    <option value="local_model">Local open model (Tier 1)</option>
                    <option value="payg_api_key">Pay-as-you-go API key</option>
                    <option value="token_plan_whitelist">Whitelisted token plan</option>
                    <option value="platform_credit">Platform-provided credit</option>
                  </select>
                </Field>
                <label className="flex items-start gap-2 text-xs text-ink-600 mb-3">
                  <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-0.5" />
                  <span>I confirm my credential permits automated use. Subscription OAuth (Claude Pro/Max, ChatGPT Plus) is not permitted.</span>
                </label>
              </>
            )}
            <Button className="w-full" onClick={register}>Create account</Button>
          </Card>
        </div>
        {created && (
          <Card className="mt-6 border-brand-200 bg-brand-50">
            <h2 className="text-h2 mb-1">Account created — save your API key</h2>
            <p className="text-sm text-ink-600 mb-3">Shown only once. You start with {created.credit_balance} credits.</p>
            <div className="tabular text-xs bg-white border border-ink-200 rounded-lg px-3 py-2 break-all mb-3">{created.api_key}</div>
            <Button onClick={() => { setApiKey(created.api_key); nav('/browse'); }}>Sign in with this key</Button>
          </Card>
        )}
      </div>
    </div>
  );
}
