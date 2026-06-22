import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Field, inputCls } from '../components/ui';
import type { Verification } from '../lib/types';

export function Publish() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('general');
  const [reward, setReward] = useState(100);
  const [minRep, setMinRep] = useState(0);
  const [mode, setMode] = useState<Verification['mode']>('manual');
  const [contains, setContains] = useState('');
  const [lang, setLang] = useState('python');
  const [tests, setTests] = useState('');
  const [rubric, setRubric] = useState('');
  const [threshold, setThreshold] = useState(6);

  async function publish() {
    const verification: Verification = { mode };
    if (mode === 'auto_rules') verification.rules = contains ? [{ type: 'contains', value: contains }] : [];
    else if (mode === 'auto_tests') { verification.language = lang; verification.tests = tests; }
    else if (mode === 'auto_llm') { verification.rubric = rubric; verification.pass_threshold = threshold; }
    try {
      await request('POST', '/tasks', {
        key: apiKey,
        body: { title: title.trim(), description: description.trim(), type, reward_credits: Number(reward), min_reputation: Number(minRep), verification },
      });
      toast('Task published');
      nav('/published');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Publish failed', 'err');
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-h1 mb-1">Publish a task</h1>
      <p className="text-sm text-ink-500 mb-5">Reward credits are escrowed from your balance immediately.</p>
      <Card>
        <Field label="Title"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Description"><textarea rows={4} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
              {['general','code','content','data','research','translation'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Reward credits"><input type="number" className={inputCls} value={reward} onChange={(e) => setReward(Number(e.target.value))} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min reputation (0–10)"><input type="number" step="0.5" className={inputCls} value={minRep} onChange={(e) => setMinRep(Number(e.target.value))} /></Field>
          <Field label="Verification">
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as Verification['mode'])}>
              <option value="manual">manual (you review)</option>
              <option value="auto_rules">auto_rules (keyword)</option>
              <option value="auto_tests">auto_tests (run tests)</option>
              <option value="auto_llm">auto_llm (LLM grades)</option>
            </select>
          </Field>
        </div>
        {mode === 'auto_rules' && (
          <Field label="Required substring (result must contain)"><input className={inputCls} value={contains} onChange={(e) => setContains(e.target.value)} /></Field>
        )}
        {mode === 'auto_tests' && (
          <>
            <Field label="Language">
              <select className={inputCls} value={lang} onChange={(e) => setLang(e.target.value)}><option>python</option><option>javascript</option></select>
            </Field>
            <Field label="Test code"><textarea rows={4} className={inputCls} value={tests} onChange={(e) => setTests(e.target.value)} /></Field>
          </>
        )}
        {mode === 'auto_llm' && (
          <>
            <Field label="Grading rubric"><textarea rows={3} className={inputCls} value={rubric} onChange={(e) => setRubric(e.target.value)} /></Field>
            <Field label="Pass threshold (0–10)"><input type="number" className={inputCls} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></Field>
          </>
        )}
        <Button className="mt-2" onClick={publish}>Publish task</Button>
      </Card>
    </div>
  );
}
