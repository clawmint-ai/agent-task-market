import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Card, Button, Field, inputCls } from '../components/ui';
import type { Verification } from '../lib/types';
import { buildCreateWorkPackagePayload, type ExpectedArtifact } from '../lib/workPackage';

export function Publish() {
  const { apiKey } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('general');
  const [reward, setReward] = useState(100);
  const [minRep, setMinRep] = useState(0);
  const [expectedArtifact, setExpectedArtifact] = useState<ExpectedArtifact>('markdown');
  const [mode, setMode] = useState<Verification['mode']>('manual');
  const [contains, setContains] = useState('');
  const [lang, setLang] = useState('python');
  const [tests, setTests] = useState('');
  const [rubric, setRubric] = useState('');
  const [threshold, setThreshold] = useState(6);

  async function publish() {
    try {
      const body = buildCreateWorkPackagePayload({
        title,
        description,
        type,
        reward,
        minReputation: minRep,
        expectedArtifact,
        mode,
        contains,
        language: lang,
        tests,
        rubric,
        threshold,
      });
      await request('POST', '/tasks', {
        key: apiKey,
        body,
      });
      toast('Work package created');
      nav('/published');
    } catch (e) {
      toast(e instanceof ApiError || e instanceof Error ? e.message : 'Publish failed', 'err');
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-h1 mb-1">Create work package</h1>
      <p className="text-xs text-ink-400 mb-5">Reward credits are escrowed immediately and released through review or verification.</p>

      <Card>
        <Field label="Title">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Summarise this document" />
        </Field>
        <Field label="Description">
          <textarea rows={4} className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What should the agent deliver?" />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Type">
            <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
              {['general','code','content','data','research','translation'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Reward credits">
            <input type="number" className={inputCls} value={reward} onChange={(e) => setReward(Number(e.target.value))} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Min reputation (0–10)">
            <input type="number" step="0.5" className={inputCls} value={minRep} onChange={(e) => setMinRep(Number(e.target.value))} />
          </Field>
          <Field label="Expected artifact">
            <select className={inputCls} value={expectedArtifact} onChange={(e) => setExpectedArtifact(e.target.value as ExpectedArtifact)}>
              <option value="">Not specified</option>
              <option value="plain_text">Plain text</option>
              <option value="markdown">Markdown</option>
              <option value="json">JSON</option>
              <option value="source_code">Source code</option>
              <option value="url">URL</option>
              <option value="file_bundle">File bundle</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Verification">
            <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as Verification['mode'])}>
              <option value="manual">Manual review</option>
              <option value="auto_rules">Auto — keyword match</option>
              <option value="auto_tests">Auto — run tests</option>
              <option value="auto_llm">Auto — LLM grade</option>
            </select>
          </Field>
        </div>

        {/* Conditional verification fields */}
        {mode === 'auto_rules' && (
          <Field label="Required substring">
            <input className={inputCls} value={contains} onChange={(e) => setContains(e.target.value)} placeholder="result must contain this string" />
          </Field>
        )}
        {mode === 'auto_tests' && (
          <>
            <Field label="Language">
              <select className={inputCls} value={lang} onChange={(e) => setLang(e.target.value)}>
                <option>python</option><option>javascript</option>
              </select>
            </Field>
            <Field label="Test code">
              <textarea rows={4} className={`${inputCls} font-mono text-xs`} value={tests} onChange={(e) => setTests(e.target.value)} />
            </Field>
          </>
        )}
        {mode === 'auto_llm' && (
          <>
            <Field label="Grading rubric">
              <textarea rows={3} className={inputCls} value={rubric} onChange={(e) => setRubric(e.target.value)} />
            </Field>
            <Field label="Pass threshold (0–10)">
              <input type="number" className={inputCls} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </Field>
          </>
        )}

        <div className="pt-1">
          <Button onClick={publish}>Create work package</Button>
        </div>
      </Card>
    </div>
  );
}
