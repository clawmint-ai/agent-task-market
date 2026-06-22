import { randomUUID, randomBytes } from 'crypto';
import db from '../db/pool';
import { hashApiKey } from '../domain/apiKey';
import type { ComputeSource } from '../db/types';

function newKey(): string {
  return 'atm_' + randomBytes(24).toString('hex');
}

export interface AgentKeyRow {
  id: string;
  owner_account_id: string;
  name: string;
  compute_source: string;
  reputation_score: number;
  total_tasks_completed: number;
  is_active: boolean;
  created_at: Date;
}

/** Issue a new agent key under an owner account. Returns the plaintext key ONCE. */
export async function issueAgentKey(params: {
  ownerAccountId: string;
  name: string;
  computeSource?: string;
}): Promise<AgentKeyRow & { api_key: string }> {
  const apiKey = newKey();
  const row = await db
    .insertInto('agent_keys')
    .values({
      id: randomUUID(),
      owner_account_id: params.ownerAccountId,
      name: params.name,
      api_key_hash: hashApiKey(apiKey),
      compute_source: (params.computeSource ?? 'unspecified') as ComputeSource,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { ...(row as unknown as AgentKeyRow), api_key: apiKey };
}

/** List an owner's agent keys (no secrets), newest first. */
export async function listAgentKeys(ownerAccountId: string): Promise<AgentKeyRow[]> {
  const rows = await db
    .selectFrom('agent_keys')
    .selectAll()
    .where('owner_account_id', '=', ownerAccountId)
    .orderBy('created_at', 'desc')
    .execute();
  return rows as unknown as AgentKeyRow[];
}

/** Revoke an owner's agent key (scoped to the owner so one owner can't revoke another's). */
export async function revokeAgentKey(ownerAccountId: string, keyId: string): Promise<void> {
  await db
    .updateTable('agent_keys')
    .set({ is_active: false, revoked_at: new Date() })
    .where('id', '=', keyId)
    .where('owner_account_id', '=', ownerAccountId)
    .execute();
}

/** Resolve an active agent key by its plaintext API key, or null. */
export async function getAgentKeyByApiKey(apiKey: string): Promise<AgentKeyRow | null> {
  const row = await db
    .selectFrom('agent_keys')
    .selectAll()
    .where('api_key_hash', '=', hashApiKey(apiKey))
    .where('is_active', '=', true)
    .executeTakeFirst();
  return (row as unknown as AgentKeyRow) ?? null;
}

/** Set an agent key's reputation and increment its completed-task count. */
export async function bumpAgentKeyReputation(keyId: string, newScore: number): Promise<void> {
  const { sql } = await import('kysely');
  await db
    .updateTable('agent_keys')
    .set({
      reputation_score: newScore,
      total_tasks_completed: sql`total_tasks_completed + 1`,
    })
    .where('id', '=', keyId)
    .execute();
}
