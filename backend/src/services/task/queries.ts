import db from '../../db/pool';
import { Task, parseTask, parseExecution } from './mappers';
import { computeTier, priorityScore } from '../../domain/compliance';
import type { ComputeSource } from '../../db/types';

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
    .innerJoin('accounts as a', 'a.id', 'te.executor_id')
    .selectAll('te')
    .select(['a.name as executor_name', 'a.compute_source as executor_compute_source', 'a.reputation_score as executor_reputation_score'])
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
