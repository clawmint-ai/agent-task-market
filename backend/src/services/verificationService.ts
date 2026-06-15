import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getSandboxRunner } from '../runtime/sandbox';

export interface VerificationResult {
  passed: boolean;
  score: number; // 0-10
  detail: Record<string, unknown>;
}

export interface VerificationConfig {
  mode: 'manual' | 'auto_tests' | 'auto_rules' | 'auto_llm';
  // auto_tests:
  language?: 'python' | 'javascript';
  tests?: string;          // test source code
  // auto_rules:
  rules?: VerificationRule[];
  // auto_llm:
  rubric?: string;
  pass_threshold?: number; // default 6
}

export interface VerificationRule {
  type: 'contains' | 'not_contains' | 'regex' | 'json_path_equals' | 'min_length';
  value: string | number;
  path?: string; // for json_path_equals
}

/** Main entry: verify a submitted result against the task's verification config. */
export async function autoVerify(
  config: VerificationConfig,
  result: string,
  resultMetadata: Record<string, unknown>
): Promise<VerificationResult> {
  switch (config.mode) {
    case 'auto_rules':
      return verifyRules(config.rules || [], result, resultMetadata);
    case 'auto_tests':
      return verifyTests(config, result);
    case 'auto_llm':
      return verifyLLM(config, result);
    default:
      throw new Error(`Mode ${config.mode} is not auto-verifiable`);
  }
}

// ── Rule-based verification ──────────────────────────────────────────────────
function verifyRules(
  rules: VerificationRule[],
  result: string,
  meta: Record<string, unknown>
): VerificationResult {
  if (rules.length === 0) {
    return { passed: false, score: 0, detail: { error: 'No rules defined' } };
  }
  const checks: Array<{ rule: VerificationRule; passed: boolean }> = [];
  for (const rule of rules) {
    let passed = false;
    try {
      switch (rule.type) {
        case 'contains':
          passed = result.includes(String(rule.value));
          break;
        case 'not_contains':
          passed = !result.includes(String(rule.value));
          break;
        case 'regex':
          passed = new RegExp(String(rule.value)).test(result);
          break;
        case 'min_length':
          passed = result.length >= Number(rule.value);
          break;
        case 'json_path_equals': {
          const obj = rule.path ? getPath(meta, rule.path) : undefined;
          passed = String(obj) === String(rule.value);
          break;
        }
      }
    } catch {
      passed = false;
    }
    checks.push({ rule, passed });
  }
  const passedCount = checks.filter((c) => c.passed).length;
  const allPassed = passedCount === checks.length;
  return {
    passed: allPassed,
    score: Number(((passedCount / checks.length) * 10).toFixed(2)),
    detail: { checks, passedCount, total: checks.length },
  };
}

function getPath(obj: unknown, p: string): unknown {
  return p.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

// ── Test-based verification (sandboxed) ──────────────────────────────────────
async function verifyTests(
  config: VerificationConfig,
  result: string
): Promise<VerificationResult> {
  const lang = config.language || 'python';
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-'));
  try {
    let out: { code: number; stdout: string; stderr: string };
    if (lang === 'python') {
      fs.writeFileSync(path.join(tmpDir, 'solution.py'), result);
      fs.writeFileSync(path.join(tmpDir, 'test_solution.py'), config.tests || '');
      out = await runSandboxed('python3', ['-m', 'pytest', '-q', 'test_solution.py'], tmpDir);
    } else {
      fs.writeFileSync(path.join(tmpDir, 'solution.js'), result);
      fs.writeFileSync(path.join(tmpDir, 'test.js'), config.tests || '');
      out = await runSandboxed('node', ['test.js'], tmpDir);
    }

    // Distinguish "the test ran and the code failed" (the agent's fault → reject)
    // from "the test harness could not run at all" (missing runtime/runner →
    // platform's fault). Failing an agent for our broken infra is unfair AND
    // poisons the reputation signal, so route infra failures to manual fallback
    // (lifecycle.ts honors detail.fallback === 'manual': no settlement, no rep hit).
    const infraError = detectInfraFailure(lang, out);
    if (infraError) {
      return {
        passed: false,
        score: 0,
        detail: { fallback: 'manual', infraError, stderr: out.stderr.slice(-1000), exitCode: out.code },
      };
    }

    const passed = out.code === 0;
    return {
      passed,
      score: passed ? 10 : 0,
      detail: { stdout: out.stdout.slice(-2000), stderr: out.stderr.slice(-1000), exitCode: out.code },
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Returns a reason string if the test process failed because the runner itself
 * could not execute (missing interpreter/runner/module), or null if it ran
 * normally (pass or genuine assertion failure). Conservative: only well-known
 * "couldn't even start" signatures count as infra failures, so a test that
 * legitimately fails is never excused.
 */
export function detectInfraFailure(
  lang: 'python' | 'javascript',
  out: { code: number; stdout: string; stderr: string }
): string | null {
  const err = out.stderr || '';
  // Interpreter/runner not found at all (spawn error or shell 127).
  if (out.code === 127 || /command not found|ENOENT|spawn .* ENOENT/i.test(err)) {
    return 'test runner not found';
  }
  if (lang === 'python') {
    // pytest not installed: `python3 -m pytest` → "No module named pytest".
    if (/No module named pytest|No module named '?pytest'?/i.test(err)) return 'pytest not installed';
    // pytest's own "usage error / collection could not start" exit code.
    if (out.code === 4 && /usage:|unrecognized arguments|no tests ran/i.test(err)) {
      return 'pytest could not start';
    }
  } else {
    // node couldn't load the test harness itself (not the solution under test).
    if (/Cannot find module '?(?:node:)?\w/i.test(err) && /test\.js/.test(err)) {
      return 'node test harness failed to load';
    }
  }
  return null;
}

function runSandboxed(
  cmd: string,
  args: string[],
  cwd: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Delegates to the SandboxRunner seam (beta: local process; commercial:
  // Firecracker/gVisor pool). See runtime/sandbox.ts.
  return getSandboxRunner().run(cmd, args, cwd);
}

// ── LLM-based verification ───────────────────────────────────────────────────
// Calls an OpenAI-compatible endpoint if configured; otherwise falls back to
// flagging for manual review. Keeps the market usable without an LLM key.
async function verifyLLM(
  config: VerificationConfig,
  result: string
): Promise<VerificationResult> {
  const apiUrl = process.env.LLM_API_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const threshold = config.pass_threshold ?? 6;

  if (!apiUrl || !apiKey) {
    return {
      passed: false,
      score: 0,
      detail: { error: 'LLM verification not configured; falling back to manual review', fallback: 'manual' },
    };
  }

  // Node 18+ provides a global fetch; no node-fetch dependency needed here.
  const prompt = `You are grading a task submission. Rubric:\n${config.rubric}\n\nSubmission:\n${result}\n\nReturn ONLY a JSON object: {"score": <0-10 number>, "reasoning": "<short>"}.`;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    }),
  });
  const data = (await res.json()) as any;
  try {
    const content = data.choices[0].message.content;
    const parsed = JSON.parse(content);
    const score = Number(parsed.score);
    return {
      passed: score >= threshold,
      score: Number(score.toFixed(2)),
      detail: { reasoning: parsed.reasoning, threshold },
    };
  } catch (e) {
    return { passed: false, score: 0, detail: { error: 'Failed to parse LLM response', raw: data } };
  }
}
