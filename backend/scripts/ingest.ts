// Ingest real external demand (GitHub issues with a verify contract) into the
// market. Only auto-verifiable candidates are published; the rest are dropped
// and reported. Mirrors the seeder's dry-run/--commit safety model.
//
//   GITHUB_TOKEN=... DATABASE_URL=... npx tsx scripts/ingest.ts --repo=owner/name
//   ...                                                          --repo=owner/name --commit
//
// Dedup: skips any candidate whose externalId is already recorded in tasks.source.

import db, { runMigrations, closeDb } from '../src/db/pool';
import { createAccount } from '../src/services/accountService';
import { createTask } from '../src/services/task';
import { GitHubIssuesAdapter } from '../src/ingest/githubIssues';
import { runAdapter } from '../src/ingest/types';
import { sql } from 'kysely';

const PLATFORM_NAME = 'platform-seeder';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq === -1 ? 'true' : hit.slice(eq + 1);
}

async function ensurePlatformId(commit: boolean): Promise<string | null> {
  const existing = await db.selectFrom('accounts').select('id').where('name', '=', PLATFORM_NAME).executeTakeFirst();
  if (existing) return existing.id;
  if (!commit) return null;
  const acct = await createAccount({ type: 'human', name: PLATFORM_NAME, computeSource: 'platform_credit' });
  await db.updateTable('accounts').set({ gift_balance: 1_000_000 }).where('id', '=', acct.id).execute();
  return acct.id;
}

async function alreadyIngested(externalId: string): Promise<boolean> {
  const row = await db
    .selectFrom('tasks')
    .select('id')
    .where(sql<boolean>`source->>'externalId' = ${externalId}`)
    .executeTakeFirst();
  return !!row;
}

async function main() {
  const repo = arg('repo');
  const commit = arg('commit') === 'true';
  if (!repo) throw new Error('--repo=owner/name is required');

  console.log(`\n📥 Ingesting ${repo} — ${commit ? 'COMMIT' : 'DRY-RUN'}\n`);
  if (commit) await runMigrations();

  const { publishable, dropped } = await runAdapter(new GitHubIssuesAdapter(repo));
  console.log(`  candidates: ${publishable.length + dropped.length}  publishable: ${publishable.length}  dropped: ${dropped.length}`);
  for (const d of dropped) console.log(`  ⏭  drop ${d.ext.externalId}: ${d.reason}`);

  const publisherId = await ensurePlatformId(commit);
  let created = 0, skipped = 0;

  for (const { ext, template } of publishable) {
    if (await alreadyIngested(ext.externalId)) {
      console.log(`  ⏭  skip (already ingested): ${ext.externalId}`);
      skipped++;
      continue;
    }
    if (!commit) {
      console.log(`  + ${ext.externalId}  ${template.title}  [${template.type}, ${template.reward_credits}cr, ${template.verification.mode}]`);
      created++;
      continue;
    }
    const task = await createTask({
      publisherId: publisherId!,
      title: template.title,
      description: template.description,
      type: template.type,
      rewardCredits: template.reward_credits,
      tags: template.tags,
      verification: template.verification,
      source: { origin: ext.origin, externalId: ext.externalId, url: ext.url },
    });
    console.log(`  ✓ ${task.id}  ${ext.externalId}`);
    created++;
  }

  console.log(`\n${commit ? '✅ ingested' : '📋 would ingest'}: ${created}, skipped ${skipped}, dropped ${dropped.length}.\n` +
    (commit ? '' : 'Re-run with --commit to publish.\n'));
  await closeDb();
}

main().catch(async (err) => {
  console.error('ingest failed:', err);
  try { await closeDb(); } catch {}
  process.exit(1);
});
