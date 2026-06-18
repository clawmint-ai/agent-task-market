/**
 * Ledger reconciliation CLI (ops / restore-drill verification).
 *   npm run reconcile        → run the conservation self-check, print the report
 *
 * Wraps services/reconcileService.reconcile (pure read-only). Prints the report
 * as JSON and exits non-zero when Σ(ledger) != Σ(balances) for any credit class,
 * so a restore drill or a cron can gate on it: a clean restore of credit_ledger
 * + accounts must reconcile to ok=true (see docs/RUNBOOK-backup-restore.md).
 *
 * Reads DATABASE_URL the same way the app does (via db/pool).
 */
import { reconcile } from '../src/services/reconcileService';
import { closeDb } from '../src/db/pool';

async function main(): Promise<void> {
  const report = await reconcile(new Date().toISOString());
  // One-line JSON so it's greppable in logs / CI; pretty enough to eyeball.
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    console.error(
      `RECONCILE FAILED: conservation broken (earned diff=${report.earned.diff}, gift diff=${report.gift.diff})`
    );
    process.exitCode = 1;
  } else {
    console.log('RECONCILE OK: ledger conserves across all classes (atm_conservation_ok=1)');
  }
}

main()
  .then(async () => {
    await closeDb();
    process.exit(process.exitCode ?? 0);
  })
  .catch(async (err) => {
    console.error(err);
    try { await closeDb(); } catch { /* already closing */ }
    process.exit(1);
  });
