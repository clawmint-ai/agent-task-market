// One-off manual check for the stale-claim release fix. Run against a live DB:
//   cd backend && DATABASE_URL="$DATABASE_URL" node scripts/verify-stale.mjs
// Uses staleMs:0 so every in_progress execution counts as abandoned — this
// releases the slot and reopens any task that was locked to 'claimed' purely by
// the stale claim (e.g. the flatten task stuck during flywheel testing).
import { db } from '../dist/db/pool.js';
import { releaseStaleClaims } from '../dist/services/task/settlement.js';

const FLATTEN = 'a9ebcbec-acde-40ad-b73e-30ad102b674b';

async function snap(label) {
  const t = await db.selectFrom('tasks').select(['status']).where('id', '=', FLATTEN).executeTakeFirst();
  const ex = await db.selectFrom('task_executions').select(['status']).where('task_id', '=', FLATTEN).execute();
  const by = ex.reduce((m, e) => ((m[e.status] = (m[e.status] || 0) + 1), m), {});
  console.log(`${label}: flatten task=${t?.status}  executions=${JSON.stringify(by)}`);
}

await snap('BEFORE');
const r = await releaseStaleClaims(new Date(), 0); // staleMs:0 → all in_progress are stale
console.log('releaseStaleClaims released =', r.released);
await snap('AFTER ');

const r2 = await releaseStaleClaims(new Date(), 0); // idempotency
console.log('second sweep released =', r2.released, '(expect 0)');
await db.destroy();
