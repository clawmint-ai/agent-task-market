import { FastifyRequest, FastifyReply } from 'fastify';
import { getAccountByApiKey, getAccountById, Account } from '../services/accountService';
import { getAgentKeyByApiKey, AgentKeyRow } from '../services/agentKeyService';

export type Principal =
  | { kind: 'owner'; account: Account }
  | { kind: 'agent'; agentKey: AgentKeyRow; ownerAccount: Account };

declare module 'fastify' {
  interface FastifyRequest {
    account: Account; // always the owner account (kept for existing wallet/publish code)
    principal: Principal;
  }
}

/**
 * Resolve a raw API key to a principal, or null.
 * - An owner account key  → { kind: 'owner', account }
 * - An agent key          → { kind: 'agent', agentKey, ownerAccount }
 * Exported so the SSE route (which authenticates via query param) can reuse it.
 */
export async function resolvePrincipal(apiKey: string): Promise<Principal | null> {
  const account = await getAccountByApiKey(apiKey);
  if (account) return { kind: 'owner', account };
  const agentKey = await getAgentKeyByApiKey(apiKey);
  if (agentKey) {
    const ownerAccount = await getAccountById(agentKey.owner_account_id);
    if (ownerAccount) return { kind: 'agent', agentKey, ownerAccount };
  }
  return null;
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
  }
  const principal = await resolvePrincipal(authHeader.slice(7));
  if (!principal) {
    return reply.status(401).send({ error: 'Invalid API key' });
  }
  req.principal = principal;
  // req.account is the owner account in both cases, so existing code that reads
  // req.account (wallet, publish, redeem) keeps working unchanged.
  req.account = principal.kind === 'owner' ? principal.account : principal.ownerAccount;
}
