import db from '../db/pool';
import type { Account } from './accountService';

type CountRow = { count: number | string | bigint };

async function readCount(query: Promise<CountRow | undefined>): Promise<number> {
  const row = await query;
  return Number(row?.count ?? 0);
}

export async function getOwnerMarketOverview(owner: Account) {
  const [
    workPackagesOpen,
    executionsInProgress,
    submissionsAwaitingReview,
    riskHoldsOpen,
    agentIssued,
    agentActive,
    agentRevoked,
  ] = await Promise.all([
    readCount(
      db
        .selectFrom('tasks')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('publisher_id', '=', owner.id)
        .where('status', '=', 'open')
        .executeTakeFirst()
    ),
    readCount(
      db
        .selectFrom('task_executions as te')
        .innerJoin('tasks as t', 't.id', 'te.task_id')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('t.publisher_id', '=', owner.id)
        .where('te.status', '=', 'in_progress')
        .executeTakeFirst()
    ),
    readCount(
      db
        .selectFrom('task_executions as te')
        .innerJoin('tasks as t', 't.id', 'te.task_id')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('t.publisher_id', '=', owner.id)
        .where('te.status', '=', 'submitted')
        .executeTakeFirst()
    ),
    readCount(
      db
        .selectFrom('risk_flags')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('account_id', '=', owner.id)
        .where('status', '=', 'open')
        .executeTakeFirst()
    ),
    readCount(
      db
        .selectFrom('agent_keys')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('owner_account_id', '=', owner.id)
        .executeTakeFirst()
    ),
    readCount(
      db
        .selectFrom('agent_keys')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('owner_account_id', '=', owner.id)
        .where('is_active', '=', true)
        .executeTakeFirst()
    ),
    readCount(
      db
        .selectFrom('agent_keys')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('owner_account_id', '=', owner.id)
        .where('is_active', '=', false)
        .executeTakeFirst()
    ),
  ]);

  return {
    principal: {
      kind: 'owner',
      account_id: owner.id,
      agent_key_id: null,
    },
    counts: {
      work_packages_open: workPackagesOpen,
      executions_in_progress: executionsInProgress,
      submissions_awaiting_review: submissionsAwaitingReview,
      risk_holds_open: riskHoldsOpen,
    },
    wallet: {
      earned: owner.earned_balance,
      gift: owner.gift_balance,
      frozen_earned: owner.frozen_earned_balance,
      spendable: owner.earned_balance + owner.gift_balance,
    },
    agent_identities: {
      issued: agentIssued,
      active_credentials: agentActive,
      revoked: agentRevoked,
    },
  };
}
