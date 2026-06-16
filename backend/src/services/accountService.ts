import db, { DB } from '../db/pool';
import { sql } from 'kysely';
import { randomBytes, randomUUID } from 'crypto';
import type { ComputeSource } from '../db/types';
import { computeEscrowSplit } from '../domain/credits';
import { hashApiKey } from '../domain/apiKey';

export interface Account {
  id: string;
  type: 'human' | 'agent';
  name: string;
  email: string | null;
  compute_source: ComputeSource;
  earned_balance: number;
  gift_balance: number;
  reputation_score: number;
  total_tasks_published: number;
  total_tasks_completed: number;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export { hashApiKey } from '../domain/apiKey';

export type CreditClass = 'earned' | 'gift';

/**
 * Create an account. Returns the row plus the one-time plaintext API key, which
 * is NOT stored (only its SHA-256 hash is). Signup bonus lands in gift_balance
 * (publish-only, non-redeemable) to block the money-pump (see system-deep-analysis §3).
 */
export async function createAccount(params: {
  type: 'human' | 'agent';
  name: string;
  email?: string;
  computeSource?: Account['compute_source'];
  metadata?: Record<string, unknown>;
}): Promise<Account & { api_key: string }> {
  const id = randomUUID();
  const apiKey = randomBytes(32).toString('hex');
  const apiKeyHash = hashApiKey(apiKey);
  const SIGNUP_GIFT = 1000;

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('accounts')
      .values({
        id,
        type: params.type,
        name: params.name,
        email: params.email ?? null,
        api_key_hash: apiKeyHash,
        compute_source: params.computeSource ?? 'unspecified',
        gift_balance: SIGNUP_GIFT,
        metadata: JSON.stringify(params.metadata ?? {}),
      })
      .execute();
    await trx
      .insertInto('credit_ledger')
      .values({
        id: randomUUID(),
        account_id: id,
        delta: SIGNUP_GIFT,
        balance_after: SIGNUP_GIFT,
        credit_class: 'gift',
        reason: 'signup_bonus',
        description: 'Welcome bonus credits (gift, publish-only)',
      })
      .execute();
  });

  const account = (await getAccountById(id))!;
  return { ...account, api_key: apiKey };
}

/**
 * Rotate an account's API key. Generates a new key, stores its hash, and
 * returns the one-time plaintext. The old key is immediately invalidated.
 */
export async function rotateApiKey(accountId: string): Promise<string> {
  const newKey = randomBytes(32).toString('hex');
  const newHash = hashApiKey(newKey);

  const updated = await db
    .updateTable('accounts')
    .set({ api_key_hash: newHash, updated_at: sql<Date>`now()` } as any)
    .where('id', '=', accountId)
    .where('is_active', '=', true)
    .executeTakeFirst();
  if (!updated) throw new Error('Account not found or inactive');

  return newKey;
}

export async function getAccountByApiKey(apiKey: string): Promise<Account | null> {
  const row = await db
    .selectFrom('accounts')
    .selectAll()
    .where('api_key_hash', '=', hashApiKey(apiKey))
    .where('is_active', '=', true)
    .executeTakeFirst();
  return row ? toAccount(row) : null;
}

export async function getAccountById(id: string): Promise<Account | null> {
  const row = await db.selectFrom('accounts').selectAll().where('id', '=', id).executeTakeFirst();
  return row ? toAccount(row) : null;
}

function toAccount(row: any): Account {
  return {
    ...row,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
  };
}

/**
 * Debit credits from a balance class. Pass `conn` (a transaction) when this must
 * be atomic with other ledger writes — the caller owns the transaction boundary.
 * Uses a conditional UPDATE so a concurrent debit can't drive the balance negative.
 */
export async function debitCredits(
  conn: DB,
  accountId: string,
  amount: number,
  reason: string,
  opts: { refId?: string; description?: string; creditClass?: CreditClass } = {}
): Promise<number> {
  const creditClass: CreditClass = opts.creditClass ?? 'earned';
  const balanceCol = creditClass === 'gift' ? 'gift_balance' : 'earned_balance';
  const col = sql.ref(balanceCol);

  // Atomic guarded decrement: only succeeds if balance >= amount (prevents a
  // concurrent debit from driving the balance negative).
  const updated = await conn
    .updateTable('accounts')
    .set({ [balanceCol]: sql<number>`${col} - ${amount}`, updated_at: sql<Date>`now()` } as any)
    .where('id', '=', accountId)
    .where(sql<boolean>`${col} >= ${amount}`)
    .returning(sql<number>`${col}`.as('balance'))
    .executeTakeFirst();

  if (!updated) {
    const exists = await conn.selectFrom('accounts').select('id').where('id', '=', accountId).executeTakeFirst();
    throw new Error(exists ? 'Insufficient credits' : 'Account not found');
  }

  const newBalance = Number(updated.balance);
  await conn
    .insertInto('credit_ledger')
    .values({
      id: randomUUID(),
      account_id: accountId,
      delta: -amount,
      balance_after: newBalance,
      credit_class: creditClass,
      reason,
      ref_id: opts.refId ?? null,
      description: opts.description ?? null,
    })
    .execute();
  return newBalance;
}

export async function creditCredits(
  conn: DB,
  accountId: string,
  amount: number,
  reason: string,
  opts: { refId?: string; description?: string; creditClass?: CreditClass } = {}
): Promise<number> {
  const creditClass: CreditClass = opts.creditClass ?? 'earned';
  const balanceCol = creditClass === 'gift' ? 'gift_balance' : 'earned_balance';
  const col = sql.ref(balanceCol);

  const updated = await conn
    .updateTable('accounts')
    .set({ [balanceCol]: sql<number>`${col} + ${amount}`, updated_at: sql<Date>`now()` } as any)
    .where('id', '=', accountId)
    .returning(sql<number>`${col}`.as('balance'))
    .executeTakeFirst();
  if (!updated) throw new Error('Account not found');

  const newBalance = Number(updated.balance);
  await conn
    .insertInto('credit_ledger')
    .values({
      id: randomUUID(),
      account_id: accountId,
      delta: amount,
      balance_after: newBalance,
      credit_class: creditClass,
      reason,
      ref_id: opts.refId ?? null,
      description: opts.description ?? null,
    })
    .execute();
  return newBalance;
}

export async function getCreditHistory(accountId: string) {
  return db
    .selectFrom('credit_ledger')
    .selectAll()
    .where('account_id', '=', accountId)
    .orderBy('created_at', 'desc')
    .limit(50)
    .execute();
}

/**
 * Debit credits for PUBLISHING a task (escrow). Both gift and earned credits may
 * fund a bounty, so this spends gift_balance first, then earned_balance. Only
 * redemption/withdrawal (future) is restricted to earned. Atomic within `conn`.
 * Returns the per-class amounts actually debited (needed to refund the same split).
 */
export async function debitForPublish(
  conn: DB,
  accountId: string,
  amount: number,
  reason: string,
  opts: { refId?: string; description?: string } = {}
): Promise<{ gift: number; earned: number }> {
  const acct = await conn
    .selectFrom('accounts')
    .select(['gift_balance', 'earned_balance'])
    .where('id', '=', accountId)
    .executeTakeFirst();
  if (!acct) throw new Error('Account not found');

  const { fromGift, fromEarned } = computeEscrowSplit(acct.gift_balance, acct.earned_balance, amount);
  if (fromGift > 0) {
    await debitCredits(conn, accountId, fromGift, reason, { ...opts, creditClass: 'gift' });
  }
  if (fromEarned > 0) {
    await debitCredits(conn, accountId, fromEarned, reason, { ...opts, creditClass: 'earned' });
  }
  return { gift: fromGift, earned: fromEarned };
}
