// Seed the market with real, auto-verifiable starter tasks (cold-start flywheel).
//
//   DATABASE_URL=... npx tsx scripts/seed-tasks.ts            # dry-run (no writes)
//   DATABASE_URL=... npx tsx scripts/seed-tasks.ts --commit   # actually seed
//   DATABASE_URL=... npx tsx scripts/seed-tasks.ts --commit --count=3
//
// Idempotent: skips any seed task whose title already exists (safe to re-run).
// The platform publisher funds bounties from its own gift balance via the normal
// createTask escrow path — no inflation, no fake agents, no auto-completion.

import db, { runMigrations, closeDb } from '../src/db/pool';
import { createAccount } from '../src/services/accountService';
import { createTask } from '../src/services/task';
import { SEED_TASKS } from './seed-templates';

const PLATFORM_NAME = 'platform-seeder';
const PLATFORM_FUND = 1_000_000; // gift credits topped up to cover seed bounties

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}`));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq === -1 ? 'true' : hit.slice(eq + 1);
}

async function ensurePlatformAccount(commit: boolean): Promise<string | null> {
  const existing = await db
    .selectFrom('accounts')
    .select(['id', 'gift_balance'])
    .where('name', '=', PLATFORM_NAME)
    .executeTakeFirst();

  if (existing) {
    // Top up gift balance if running low, so seeding never fails mid-batch.
    if (commit && existing.gift_balance < 10_000) {
      await db
        .updateTable('accounts')
        .set({ gift_balance: PLATFORM_FUND })
        .where('id', '=', existing.id)
        .execute();
      console.log(`  topped up platform gift balance → ${PLATFORM_FUND}`);
    }
    return existing.id;
  }

  if (!commit) {
    console.log(`  [dry-run] would create platform account "${PLATFORM_NAME}" with ${PLATFORM_FUND} gift credits`);
    return null;
  }

  const acct = await createAccount({
    type: 'human',
    name: PLATFORM_NAME,
    computeSource: 'platform_credit',
    metadata: { role: 'platform-seeder' },
  });
  // createAccount grants the default signup gift; bump it to the seeding fund.
  await db.updateTable('accounts').set({ gift_balance: PLATFORM_FUND }).where('id', '=', acct.id).execute();
  console.log(`  created platform account ${acct.id} (api_key shown once: ${acct.api_key})`);
  return acct.id;
}

async function main() {
  const commit = arg('commit') === 'true';
  const count = arg('count') ? parseInt(arg('count')!, 10) : SEED_TASKS.length;
  const templates = SEED_TASKS.slice(0, count);

  console.log(`\n🌱 Seeding ${templates.length} starter task(s) — ${commit ? 'COMMIT' : 'DRY-RUN'}\n`);

  if (commit) await runMigrations();

  const publisherId = await ensurePlatformAccount(commit);

  let created = 0;
  let skipped = 0;
  let totalBounty = 0;

  for (const t of templates) {
    const exists = await db.selectFrom('tasks').select('id').where('title', '=', t.title).executeTakeFirst();
    if (exists) {
      console.log(`  ⏭  skip (exists): ${t.title}`);
      skipped++;
      continue;
    }
    totalBounty += t.reward_credits;

    if (!commit) {
      console.log(`  + ${t.title}  [${t.type}, ${t.reward_credits}cr, ${t.verification.mode}]`);
      created++;
      continue;
    }

    const task = await createTask({
      publisherId: publisherId!,
      title: t.title,
      description: t.description,
      type: t.type,
      rewardCredits: t.reward_credits,
      tags: t.tags,
      verification: t.verification,
    });
    console.log(`  ✓ ${task.id}  ${t.title}  [${t.reward_credits}cr]`);
    created++;
  }

  console.log(
    `\n${commit ? '✅ seeded' : '📋 would seed'}: ${created} task(s), ${skipped} skipped, ` +
      `${totalBounty} credits in bounties.\n` +
      (commit ? '' : '\nRe-run with --commit to write to the database.\n')
  );

  await closeDb();
}

main().catch(async (err) => {
  console.error('seed failed:', err);
  try {
    await closeDb();
  } catch {}
  process.exit(1);
});
