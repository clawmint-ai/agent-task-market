/**
 * Frozen-reward review CLI (ops). Resolves the risk_flags that settlement raises
 * when the risk engine flags a payout (self-dealing / collusion):
 *   npm run review-flags -- list [open|frozen|released]   → print flags (default open)
 *   npm run review-flags -- release <flagId>              → unfreeze, return to executor
 *   npm run review-flags -- confirm <flagId>              → uphold the freeze
 *
 * Wraps services/riskFlagService (already transactional + conservation-safe), the
 * same way reconcile.ts wraps reconcileService. Runs inside the backend container
 * with DB access, so no HTTP and no ADMIN_TOKEN — reads DATABASE_URL via db/pool.
 *
 * The reminder half is the existing RiskReviewQueueStuck alert (Prometheus →
 * Alertmanager → Telegram); this CLI is only the resolution half. See CLAWMIN-48
 * and docs/deploy.md "Reviewing frozen rewards".
 */
import { listRiskFlags, releaseRiskFlag, confirmRiskFlag } from '../src/services/riskFlagService';
import { closeDb } from '../src/db/pool';
import { parseArgs, USAGE } from './review-flags-args';

const RESOLVED_BY = 'cli-admin'; // distinguishes CLI resolutions from the HTTP admin path

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.cmd === 'error') {
    console.error(parsed.message + '\n\n' + USAGE);
    process.exitCode = 1;
    return;
  }

  if (parsed.cmd === 'list') {
    const flags = await listRiskFlags(parsed.status);
    // Indented JSON: eyeballable, and greppable by id/kind like reconcile's report.
    console.log(JSON.stringify(flags, null, 2));
    console.log(`${flags.length} ${parsed.status} flag(s)`);
    return;
  }

  // release | confirm
  const action = parsed.cmd === 'release' ? releaseRiskFlag : confirmRiskFlag;
  const id = await action(parsed.flagId, RESOLVED_BY);
  const newStatus = parsed.cmd === 'release' ? 'released' : 'frozen';
  console.log(JSON.stringify({ id, status: newStatus, resolvedBy: RESOLVED_BY }, null, 2));
}

// Only run when executed directly (npm run review-flags), not when imported by a
// test — importing just exposes parseArgs; the IIFE below calls process.exit().
if (require.main === module) {
  main()
    .then(async () => {
      await closeDb();
      process.exit(process.exitCode ?? 0);
    })
    .catch(async (err) => {
      // Service throws e.g. 'Risk flag not found or not open' — surface to stderr, exit 1.
      console.error(String((err as Error).message || err));
      try { await closeDb(); } catch { /* already closing */ }
      process.exit(1);
    });
}
