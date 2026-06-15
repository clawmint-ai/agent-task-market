import type { SourceAdapter, ExternalTask, SeedTemplate } from './types';

// GitHubIssuesAdapter — ingests issues that carry an EXPLICIT, machine-checkable
// acceptance contract, and drops everything else. Convention:
//
//   * The issue is labeled with INGEST_LABEL (default 'agent-task').
//   * The body contains a fenced ```verify block holding JSON:
//       { "mode": "auto_rules", "rules": [...] }                      or
//       { "mode": "auto_tests", "language": "python", "tests": "..." }
//
// This is the honest boundary: an open-ended "please refactor X" issue has no
// objective verification, so it is NOT ingested. Only issues whose author opted
// in with a concrete, auto-checkable contract become tasks. No LLM/manual here.

const INGEST_LABEL = process.env.GITHUB_INGEST_LABEL || 'agent-task';
const VERIFY_BLOCK = /```verify\s*\n([\s\S]*?)```/;

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels: Array<{ name: string } | string>;
  pull_request?: unknown; // present on PRs — we skip those
}

export class GitHubIssuesAdapter implements SourceAdapter {
  constructor(
    private repo: string, // 'owner/name'
    private token = process.env.GITHUB_TOKEN,
    private fetchImpl: typeof fetch = fetch
  ) {}

  async fetchCandidates(): Promise<ExternalTask[]> {
    const url = `https://api.github.com/repos/${this.repo}/issues?state=open&labels=${encodeURIComponent(
      INGEST_LABEL
    )}&per_page=50`;
    const res = await this.fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
    const issues = (await res.json()) as GitHubIssue[];
    return issues
      .filter((i) => !i.pull_request) // issues only, not PRs
      .map((i) => ({
        origin: 'github',
        externalId: `${this.repo}#${i.number}`,
        url: i.html_url,
        title: i.title,
        body: i.body || '',
        labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
      }));
  }

  toSeedTemplate(ext: ExternalTask): SeedTemplate | null {
    // Parse the verify block. Pure: same body → same result. The mapping is what
    // makes a real issue safe to auto-settle; without it, drop.
    return parseVerifyContract(ext);
  }
}

/** Exported for unit testing — pure body → template|null. */
export function parseVerifyContract(ext: ExternalTask): SeedTemplate | null {
  const m = ext.body.match(VERIFY_BLOCK);
  if (!m) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch {
    return null; // malformed contract → drop, don't guess
  }

  const reward = typeof parsed.reward_credits === 'number' ? parsed.reward_credits : 50;
  const base = {
    title: `[${ext.externalId}] ${ext.title}`.slice(0, 500),
    description: `${ext.body.replace(VERIFY_BLOCK, '').trim()}\n\nSource: ${ext.url}`,
    reward_credits: reward,
    tags: ['github', ...ext.labels],
  };

  if (parsed.mode === 'auto_rules' && Array.isArray(parsed.rules) && parsed.rules.length > 0) {
    return { ...base, type: 'data', verification: { mode: 'auto_rules', rules: parsed.rules } };
  }
  if (parsed.mode === 'auto_tests' && typeof parsed.tests === 'string' && parsed.tests.length > 0) {
    const language = parsed.language === 'javascript' ? 'javascript' : 'python';
    return { ...base, type: 'code', verification: { mode: 'auto_tests', language, tests: parsed.tests } };
  }
  return null; // unknown/incomplete contract → drop
}
