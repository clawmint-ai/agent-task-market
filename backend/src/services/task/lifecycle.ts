import db, { withTransaction } from '../../db/pool';
import { randomUUID } from 'crypto';
import { debitForPublish } from '../accountService';
import { autoVerify } from '../verificationService';
import type { VerificationConfig } from '../verificationService';
import { TaskExecution, parseExecution } from './mappers';
import { getTaskById } from './queries';
import { finalizeExecution, releaseStaleClaimsForTask } from './settlement';
import { getRiskEngine } from '../../risk';
import { getNotifier } from '../../runtime/notifier';
import { BadRequestError } from '../../domain/errors';

export async function createTask(params: {
  publisherId: string;
  title: string;
  description: string;
  type?: string;
  rewardCredits: number;
  requirements?: Record<string, unknown>;
  inputData?: Record<string, unknown>;
  deadline?: string;
  maxExecutors?: number;
  tags?: string[];
  verification?: VerificationConfig;
  minReputation?: number;
  source?: Record<string, unknown>;
}) {
  const id = randomUUID();

  // CLAWMIN-24: an auto_llm task with no rubric can't be graded — the judge would
  // have nothing to grade against and every submission would fall through to
  // manual, defeating the point. Reject at publish so the publisher fixes it
  // rather than silently escrowing an un-gradeable task.
  if (params.verification?.mode === 'auto_llm' && !params.verification.rubric?.trim()) {
    throw new Error('auto_llm verification requires a non-empty rubric');
  }

  // Risk seam (fail-open): a reachable engine's explicit reject is honored; if the
  // engine call itself fails (unreachable), we allow — availability over strictness
  // for non-settlement actions. (onFinalize is fail-closed instead.)
  let publishDecision;
  try {
    publishDecision = await getRiskEngine().onPublish({
      publisherId: params.publisherId,
      rewardCredits: params.rewardCredits,
      type: params.type || 'general',
      verificationMode: params.verification?.mode || 'manual',
    });
  } catch {
    publishDecision = { allow: true }; // fail-open
  }
  if (!publishDecision.allow) {
    throw new Error(publishDecision.reason || 'Task rejected by risk policy');
  }

  await withTransaction(async (trx) => {
    // Escrow exactly ONE bounty (winner-take-all). Spend gift first, then earned;
    // record the split so a refund restores it exactly (anti-laundering).
    const split = await debitForPublish(trx, params.publisherId, params.rewardCredits, 'task_publish', {
      refId: id,
      description: `Escrow for task: ${params.title}`,
    });
    await trx
      .insertInto('tasks')
      .values({
        id,
        publisher_id: params.publisherId,
        title: params.title,
        description: params.description,
        type: params.type || 'general',
        reward_credits: params.rewardCredits,
        escrow_gift: split.gift,
        escrow_earned: split.earned,
        requirements: JSON.stringify(params.requirements || {}),
        input_data: JSON.stringify(params.inputData || {}),
        deadline: params.deadline ?? null,
        max_executors: params.maxExecutors || 1,
        tags: JSON.stringify(params.tags || []),
        source: params.source ? JSON.stringify(params.source) : null,
        verification: JSON.stringify(params.verification || { mode: 'manual' }),
        min_reputation: params.minReputation || 0,
      })
      .execute();
    await trx
      .updateTable('accounts')
      .set((eb) => ({ total_tasks_published: eb('total_tasks_published', '+', 1) }))
      .where('id', '=', params.publisherId)
      .execute();
  });
  const task = (await getTaskById(id))!;

  // Push to online agents (best-effort, after commit). Never let a notify error
  // affect the publish result — fail-open.
  try {
    getNotifier().publishTaskEvent({
      type: 'task.new',
      task: {
        id: task.id,
        title: task.title,
        type: task.type,
        reward_credits: task.reward_credits,
        min_reputation: task.min_reputation,
        verification_mode: task.verification?.mode || 'manual',
        tags: task.tags || [],
      },
    });
  } catch {
    /* best-effort */
  }

  return task;
}

export async function claimTask(taskId: string, executorId: string): Promise<TaskExecution> {
  const id = randomUUID();
  await withTransaction(async (trx) => {
    // Lock the task row to make the capacity check race-free (fixes code-audit §1.2;
    // COUNT-then-INSERT without this lock over-admits under concurrency on Postgres).
    const task = await trx
      .selectFrom('tasks')
      .selectAll()
      .where('id', '=', taskId)
      .forUpdate()
      .executeTakeFirst();
    if (!task) throw new BadRequestError('Task not found');

    // Lazily release abandoned claims before the open-check, so a task that was
    // locked to 'claimed' purely by stale in_progress executions becomes claimable
    // again without needing a background sweep. Runs inside this same locked txn.
    let status = task.status;
    if (status === 'claimed') {
      await releaseStaleClaimsForTask(trx, taskId, new Date());
      const refreshed = await trx.selectFrom('tasks').select('status').where('id', '=', taskId).executeTakeFirst();
      status = refreshed?.status ?? status;
    }
    if (status !== 'open') throw new BadRequestError(`Task is not open (status: ${status})`);

    // The claimant is an AGENT KEY (executorId = agent_keys.id). Resolve it for the
    // compliance gate (its own compute_source) and the self-claim check (against its
    // OWNER — an owner can't have its agent claim its own published task).
    const agentKey = await trx
      .selectFrom('agent_keys')
      .select(['owner_account_id', 'compute_source', 'reputation_score'])
      .where('id', '=', executorId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!agentKey) throw new BadRequestError('Agent key not found');
    if (task.publisher_id === agentKey.owner_account_id) throw new BadRequestError('Cannot claim your own task');

    // Compliance gate (CLAWMIN-20): an agent must have declared a compliant
    // compute_source to take paid work. Registration/key-issue enforces this, so
    // this only bites legacy/seed rows left at 'unspecified' — it's the enforcement
    // point that also covers the MCP path (MCP just forwards to this same claim).
    if (agentKey.compute_source === 'unspecified') {
      throw new Error(
        'Compute source not declared: re-issue the agent key with a compliant compute_source ' +
          '(local_model, payg_api_key, platform_credit, token_plan_whitelist) before claiming tasks.'
      );
    }

    // Risk seam (fail-open): closed engine may block self-dealing/collusion. Now
    // that we know publisher_id, ask the engine; allow on engine error.
    let claimDecision;
    try {
      claimDecision = await getRiskEngine().onClaim({ taskId, executorId, publisherId: task.publisher_id });
    } catch {
      claimDecision = { allow: true }; // fail-open
    }
    if (!claimDecision.allow) throw new Error(claimDecision.reason || 'Claim rejected by risk policy');

    if (task.min_reputation > 0) {
      const rep = agentKey.reputation_score ?? 0;
      if (rep < task.min_reputation) {
        throw new Error(`Reputation too low: need ${task.min_reputation}, you have ${rep}`);
      }
    }

    const existing = await trx
      .selectFrom('task_executions')
      .select('id')
      .where('task_id', '=', taskId)
      .where('executor_id', '=', executorId)
      .executeTakeFirst();
    if (existing) throw new BadRequestError('Already claimed this task');

    const countRow = await trx
      .selectFrom('task_executions')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('task_id', '=', taskId)
      .where('status', '!=', 'rejected')
      .executeTakeFirst();
    const claimCount = Number(countRow?.c ?? 0);
    if (claimCount >= task.max_executors) throw new BadRequestError('Task has reached maximum number of executors');

    await trx
      .insertInto('task_executions')
      .values({ id, task_id: taskId, executor_id: executorId, status: 'in_progress' })
      .execute();

    if (claimCount + 1 >= task.max_executors) {
      await trx
        .updateTable('tasks')
        .set({ status: 'claimed', claimed_at: new Date() })
        .where('id', '=', taskId)
        .execute();
    }
  });
  const row = await db.selectFrom('task_executions').selectAll().where('id', '=', id).executeTakeFirst();
  return parseExecution(row);
}

/**
 * Submit a result. The DB write (mark submitted) is one transaction; auto-
 * verification (which may spawn processes or call an LLM) runs AFTER it commits,
 * then finalizes in its own transaction.
 */
export async function submitResult(params: {
  taskId: string;
  executorId: string;
  result: string;
  resultMetadata?: Record<string, unknown>;
}): Promise<TaskExecution & { auto_verified?: boolean }> {
  await withTransaction(async (trx) => {
    const updated = await trx
      .updateTable('task_executions')
      .set({
        status: 'submitted',
        result: params.result,
        result_metadata: JSON.stringify(params.resultMetadata || {}),
        submitted_at: new Date(),
      })
      .where('task_id', '=', params.taskId)
      .where('executor_id', '=', params.executorId)
      .where('status', '=', 'in_progress')
      .returning('id')
      .executeTakeFirst();
    if (!updated) throw new BadRequestError('Execution not found or not in progress');
    await trx
      .updateTable('tasks')
      .set({ status: 'submitted' })
      .where('id', '=', params.taskId)
      .where('status', 'in', ['open', 'claimed'])
      .execute();
  });

  const execRow = await db
    .selectFrom('task_executions')
    .selectAll()
    .where('task_id', '=', params.taskId)
    .where('executor_id', '=', params.executorId)
    .executeTakeFirst();
  const execution = parseExecution(execRow);
  const task = (await getTaskById(params.taskId))!;
  const mode = task.verification?.mode || 'manual';
  if (mode === 'manual') return { ...execution, auto_verified: false };

  try {
    const vr = await autoVerify(task.verification, params.result, params.resultMetadata || {}, task.reward_credits);
    if ((vr.detail as any)?.fallback === 'manual') return { ...execution, auto_verified: false };
    const finalized = await finalizeExecution({
      taskId: params.taskId,
      executionId: execution.id,
      accepted: vr.passed,
      score: vr.score,
      verifiedBy: mode,
      verificationDetail: vr.detail,
      feedback: vr.passed ? 'Auto-verified: passed' : 'Auto-verified: failed',
    });
    return { ...finalized, auto_verified: true };
  } catch {
    return { ...execution, auto_verified: false };
  }
}
