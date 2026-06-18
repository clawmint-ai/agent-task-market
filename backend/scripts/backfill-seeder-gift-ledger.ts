// One-shot data repair (CLAWMIN-47): backfill the platform-seeder's missing gift
// ledger row.
//
// seed-tasks.ts historically set accounts.gift_balance directly (raw UPDATE,
// bypassing credit_ledger), so the platform-seeder holds gift credits with no
// matching ledger entries. reconcile reports gift diff = -(gap). The BALANCE is
// the intended truth (platform bootstrap fund); what's missing is the immutable
// ledger row. This inserts exactly that row — delta = gap, balance_after =
// current gift_balance, credit_class='gift' — WITHOUT touching gift_balance, so
// Σledger(gift) catches up to Σgift_balance and conservation is restored.
//
// Idempotent: recomputes the gap each run; gap==0 → no-op. Dry-run by default;
// pass --commit to write. The seeder itself is fixed in the same change so it no
// longer creates this drift going forward.
//
//   DATABASE_URL=... npx tsx scripts/backfill-seeder-gift-ledger.ts            # dry-run
//   DATABASE_URL=... npx tsx scripts/backfill-seeder-gift-ledger.ts --commit   # write
//
import { randomUUID } from 'crypto';
import { sql } from 'kysely';
import db, { closeDb } from '../src/db/pool';

const PLATFORM_NAME = 'platform-seeder';
const REASON = 'seed_grant_backfill';

async function main(): Promise<void> {
  const commit = process.argv.includes('--commit');

  const acct = await db
    .selectFrom('accounts')
    .select(['id', 'gift_balance'])
    .where('name', '=', PLATFORM_NAME)
    .executeTakeFirst();
  if (!acct) {
    console.log(`No "${PLATFORM_NAME}" account found — nothing to backfill.`);
    return;
  }

  const ledgerRow = await db
    .selectFrom('credit_ledger')
    .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('delta'), sql<number>`0`).as('s'))
    .where('account_id', '=', acct.id)
    .where('credit_class', '=', 'gift')
    .executeTakeFirst();
  const giftLedger = Number(ledgerRow?.s ?? 0);
  const giftBalance = Number(acct.gift_balance);
  const gap = giftBalance - giftLedger;

  console.log(`platform-seeder ${acct.id}`);
  console.log(`  gift_balance      = ${giftBalance}`);
  console.log(`  Σ gift ledger     = ${giftLedger}`);
  console.log(`  gap (to backfill) = ${gap}`);

  if (gap === 0) {
    console.log('Already conserved — no backfill needed (no-op).');
    return;
  }
  if (gap < 0) {
    // Ledger exceeds balance: a different kind of break (over-credited ledger).
    // Refuse to "fix" by inventing a negative grant — needs human investigation.
    throw new Error(`gift ledger (${giftLedger}) exceeds gift_balance (${giftBalance}); refusing to backfill a negative gap`);
  }

  if (!commit) {
    console.log(`[dry-run] would insert ONE gift ledger row: delta=${gap}, balance_after=${giftBalance}, reason='${REASON}'`);
    console.log('[dry-run] gift_balance is NOT modified. Re-run with --commit to write.');
    return;
  }

  await db
    .insertInto('credit_ledger')
    .values({
      id: randomUUID(),
      account_id: acct.id,
      delta: gap,
      balance_after: giftBalance,
      credit_class: 'gift',
      reason: REASON,
      ref_id: null,
      description: `CLAWMIN-47: backfill untracked platform seed grant (balance set directly by old seeder, no ledger row)`,
    })
    .execute();
  console.log(`✅ inserted gift ledger row delta=${gap}; Σledger(gift) now == gift_balance (${giftBalance}).`);
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    try { await closeDb(); } catch { /* already closing */ }
    process.exit(1);
  });
