import db from '../../db/pool';
import {
  Task,
  parseTask,
  parseExecution,
  deriveClaimability,
  normalizeVerificationPackage,
  summarizeVerificationPackage,
  type VerificationVisibility,
} from './mappers';
import { computeTier, priorityScore } from '../../domain/compliance';
import type { ComputeSource } from '../../db/types';
import type { Principal } from '../../middleware/auth';

export async function listTasks(params: {
  status?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ tasks: Task[]; total: number }> {
  let q = db
    .selectFrom('tasks as t')
    .innerJoin('accounts as a', 'a.id', 't.publisher_id')
    .selectAll('t')
    .select('a.name as publisher_name');
  let countQ = db.selectFrom('tasks as t').select((eb) => eb.fn.countAll<number>().as('c'));

  if (params.status) {
    q = q.where('t.status', '=', params.status as any);
    countQ = countQ.where('t.status', '=', params.status as any);
  } else {
    q = q.where('t.status', '=', 'open');
    countQ = countQ.where('t.status', '=', 'open');
  }
  if (params.type) {
    q = q.where('t.type', '=', params.type);
    countQ = countQ.where('t.type', '=', params.type);
  }

  const limit = params.limit || 20;
  const offset = params.offset || 0;
  const rows = await q.orderBy('t.created_at', 'desc').limit(limit).offset(offset).execute();
  const totalRow = await countQ.executeTakeFirst();
  return { tasks: rows.map(parseTask), total: Number(totalRow?.c ?? 0) };
}

export async function getTaskById(id: string): Promise<Task | null> {
  const row = await db
    .selectFrom('tasks as t')
    .innerJoin('accounts as a', 'a.id', 't.publisher_id')
    .selectAll('t')
    .select('a.name as publisher_name')
    .where('t.id', '=', id)
    .executeTakeFirst();
  return row ? parseTask(row) : null;
}

async function hasAgentClaim(taskId: string, agentKeyId: string): Promise<boolean> {
  const row = await db
    .selectFrom('task_executions')
    .select('id')
    .where('task_id', '=', taskId)
    .where('executor_id', '=', agentKeyId)
    .executeTakeFirst();
  return Boolean(row);
}

export async function getTaskVerificationDetail(taskId: string, principal: Principal) {
  const task = await getTaskById(taskId);
  if (!task) return null;

  let visibility: VerificationVisibility = 'pre_claim';
  if (principal.kind === 'owner' && principal.account.id === task.publisher_id) {
    visibility = 'publisher';
  } else if (principal.kind === 'agent' && (await hasAgentClaim(taskId, principal.agentKey.id))) {
    visibility = 'after_claim';
  }

  return {
    task_id: task.id,
    verification_package: normalizeVerificationPackage(task, visibility),
    claimability: deriveClaimability(task, principal),
  };
}

export async function getMyExecutions(executorId: string) {
  const rows = await db
    .selectFrom('task_executions as te')
    .innerJoin('tasks as t', 't.id', 'te.task_id')
    .selectAll('te')
    .select(['t.title as task_title', 't.reward_credits', 't.type'])
    .where('te.executor_id', '=', executorId)
    .orderBy('te.created_at', 'desc')
    .execute();
  return rows.map(parseExecution);
}

function derivedSettlementStatus(status: string) {
  if (status === 'accepted') return 'paid_or_held';
  if (status === 'rejected') return 'refunded_or_superseded';
  if (status === 'submitted') return 'pending_review';
  return 'not_settled';
}

export async function getExecutionDetail(executionId: string, principal: Principal) {
  const row = await db
    .selectFrom('task_executions as te')
    .innerJoin('tasks as t', 't.id', 'te.task_id')
    .innerJoin('agent_keys as ak', 'ak.id', 'te.executor_id')
    .innerJoin('accounts as a', 'a.id', 't.publisher_id')
    .selectAll('te')
    .select([
      't.publisher_id',
      't.title as task_title',
      't.description as task_description',
      't.type as task_type',
      't.reward_credits',
      't.status as task_status',
      't.requirements',
      't.input_data',
      't.deadline',
      't.max_executors',
      't.tags',
      't.verification',
      't.min_reputation',
      't.created_at as task_created_at',
      't.updated_at as task_updated_at',
      't.claimed_at',
      't.completed_at',
      'ak.name as agent_key_name',
      'ak.owner_account_id as agent_owner_account_id',
      'a.name as publisher_name',
    ])
    .where('te.id', '=', executionId)
    .executeTakeFirst();

  if (!row) return null;

  const publisherId = (row as any).publisher_id as string;
  const executorId = (row as any).executor_id as string;
  const authorized =
    (principal.kind === 'owner' && principal.account.id === publisherId) ||
    (principal.kind === 'agent' && principal.agentKey.id === executorId);
  if (!authorized) return { forbidden: true as const };

  const execution = parseExecution(row);
  const task = parseTask({
    id: execution.task_id,
    publisher_id: publisherId,
    title: (row as any).task_title,
    description: (row as any).task_description,
    type: (row as any).task_type,
    reward_credits: (row as any).reward_credits,
    status: (row as any).task_status,
    requirements: (row as any).requirements,
    input_data: (row as any).input_data,
    deadline: (row as any).deadline,
    max_executors: (row as any).max_executors,
    tags: (row as any).tags,
    verification: (row as any).verification,
    min_reputation: (row as any).min_reputation,
    created_at: (row as any).task_created_at,
    updated_at: (row as any).task_updated_at,
    claimed_at: (row as any).claimed_at,
    completed_at: (row as any).completed_at,
    publisher_name: (row as any).publisher_name,
  });

  const ledgerRows = await db
    .selectFrom('credit_ledger')
    .selectAll()
    .where('ref_id', '=', task.id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();

  return {
    execution: {
      ...execution,
      agent_key_id: execution.executor_id,
      agent_key_name: (row as any).agent_key_name,
      owner_account_id: publisherId,
    },
    work_package: {
      id: task.id,
      title: task.title,
      type: task.type,
      status: task.status,
      reward_credits: task.reward_credits,
      publisher_id: task.publisher_id,
      publisher_name: task.publisher_name,
    },
    verification_summary: summarizeVerificationPackage(task),
    settlement_summary: {
      status: derivedSettlementStatus(execution.status),
      ledger_rows: ledgerRows,
      source: 'derived_from_current_execution_and_ledger',
    },
  };
}

export async function getTaskSubmissions(taskId: string, publisherId: string) {
  const owns = await db
    .selectFrom('tasks')
    .select('id')
    .where('id', '=', taskId)
    .where('publisher_id', '=', publisherId)
    .executeTakeFirst();
  if (!owns) throw new Error('Task not found or not owned by you');
  const rows = await db
    .selectFrom('task_executions as te')
    .innerJoin('agent_keys as ak', 'ak.id', 'te.executor_id')
    .selectAll('te')
    .select(['ak.name as executor_name', 'ak.compute_source as executor_compute_source', 'ak.reputation_score as executor_reputation_score'])
    .where('te.task_id', '=', taskId)
    .execute();

  // Surface Tier 1 (local-model) executors first when a publisher reviews
  // competing submissions, without ignoring reputation (CLAWMIN-37,承接 20 §4).
  // Ranking is a pure blend (domain/compliance.priorityScore); ties fall back to
  // earliest submission so the original FIFO order is preserved within a tier.
  // compute_source / reputation_score are NOT NULL (schema defaults), guaranteed
  // by the inner join; submitted_at is null for not-yet-submitted (in_progress)
  // rows, which sort last within their tier.
  const ranked = rows
    .map((r) => {
      const source = r.executor_compute_source as ComputeSource;
      return {
        row: r,
        score: priorityScore({ reputationScore: r.executor_reputation_score, computeSource: source }),
        tier: computeTier(source),
        submittedAt: r.submitted_at ? new Date(r.submitted_at as any).getTime() : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((x, y) => y.score - x.score || x.submittedAt - y.submittedAt);

  return ranked.map(({ row, tier }) => {
    const { executor_compute_source, ...rest } = row as any;
    return { ...parseExecution(rest), executor_compute_tier: tier };
  });
}

export async function getMyPublished(publisherId: string, limit = 20, offset = 0) {
  const rows = await db
    .selectFrom('tasks')
    .selectAll()
    .where('publisher_id', '=', publisherId)
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset)
    .execute();
  return rows.map(parseTask);
}
