// SourceAdapter — seam for ingesting REAL external demand (GitHub issues, public
// datasets) into the market. The hard rule (system-deep-analysis §2): only ingest
// work that maps to OBJECTIVE auto-verification. Open-ended issues that can't be
// auto-verified are DROPPED, not turned into manual-review tasks (that would
// reintroduce the human bottleneck the platform exists to remove).

import type { VerificationConfig } from '../services/verificationService';

/** A publishable task spec: real, auto-verifiable work. Used by both the seeder
 *  (synthetic starter tasks) and ingest adapters (real external demand). */
export interface SeedTemplate {
  title: string; // also the idempotency key — unique per task
  description: string;
  type: 'code' | 'content' | 'data' | 'research' | 'translation' | 'general';
  reward_credits: number;
  tags: string[];
  verification: VerificationConfig;
}

/** A raw candidate pulled from an external source, before verification mapping. */
export interface ExternalTask {
  origin: string; // 'github' | 'dataset' | ...
  externalId: string; // stable id for dedup (e.g. repo#issue)
  url: string;
  title: string;
  body: string;
  labels: string[];
  // Optional structured hints a source may carry (e.g. a tests blob, a schema).
  meta?: Record<string, unknown>;
}

export interface SourceAdapter {
  /** Pull candidate tasks from the external source. */
  fetchCandidates(): Promise<ExternalTask[]>;
  /**
   * Map a candidate to a publishable, auto-verifiable SeedTemplate — or return
   * null to DROP it (no objective verification possible). Pure given the input;
   * the caller logs the drop rate.
   */
  toSeedTemplate(ext: ExternalTask): SeedTemplate | null;
}

/** Result of ingesting: what to publish, and what was dropped and why. */
export interface IngestResult {
  publishable: Array<{ ext: ExternalTask; template: SeedTemplate }>;
  dropped: Array<{ ext: ExternalTask; reason: string }>;
}

/** Run an adapter end to end into a publish/drop report. Pure orchestration. */
export async function runAdapter(adapter: SourceAdapter): Promise<IngestResult> {
  const candidates = await adapter.fetchCandidates();
  const publishable: IngestResult['publishable'] = [];
  const dropped: IngestResult['dropped'] = [];
  for (const ext of candidates) {
    const template = adapter.toSeedTemplate(ext);
    if (template) publishable.push({ ext, template });
    else dropped.push({ ext, reason: 'no objective verification mapping' });
  }
  return { publishable, dropped };
}
