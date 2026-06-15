// WorkflowRunner — seam for durable, resumable money flows (verification,
// deadline reclaim, payout, webhook ingestion). beta uses an in-process runner
// (direct execution + Postgres state, see tech-stack-assessment.md); the
// commercial target swaps in a Temporal-backed runner WITHOUT touching callers.

export interface WorkflowRunner {
  /**
   * Run a named workflow step to completion. The beta in-proc runner simply
   * invokes `fn`; a Temporal runner would schedule a durable activity keyed by
   * `idempotencyKey` so retries/restarts don't double-execute.
   */
  run<T>(name: string, idempotencyKey: string, fn: () => Promise<T>): Promise<T>;
}

/** beta: execute inline. No durability beyond the surrounding DB transaction. */
export class InProcWorkflowRunner implements WorkflowRunner {
  run<T>(_name: string, _idempotencyKey: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

let instance: WorkflowRunner | null = null;
export function getWorkflowRunner(): WorkflowRunner {
  if (!instance) instance = new InProcWorkflowRunner();
  return instance;
}
