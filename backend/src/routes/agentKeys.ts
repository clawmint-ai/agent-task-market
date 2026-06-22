import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { requireOwner } from '../middleware/principal';
import { issueAgentKey, listAgentKeys, revokeAgentKey } from '../services/agentKeyService';

const IssueSchema = z.object({
  name: z.string().min(1).max(120),
  compute_source: z.string().max(64).optional(),
});

export async function agentKeyRoutes(app: FastifyInstance) {
  // Issue a new agent key under the owner account (plaintext shown once).
  app.post('/accounts/me/agent-keys', { preHandler: [authMiddleware, requireOwner] }, async (req, reply) => {
    const body = IssueSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const issued = await issueAgentKey({
      ownerAccountId: req.account.id,
      name: body.data.name,
      computeSource: body.data.compute_source,
    });
    return reply.status(201).send({
      id: issued.id,
      name: issued.name,
      compute_source: issued.compute_source,
      api_key: issued.api_key, // shown once
      message: 'Save this agent key — it will not be shown again.',
    });
  });

  // List the owner's agent keys (no secrets).
  app.get('/accounts/me/agent-keys', { preHandler: [authMiddleware, requireOwner] }, async (req, reply) => {
    const keys = await listAgentKeys(req.account.id);
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      compute_source: k.compute_source,
      reputation_score: k.reputation_score,
      total_tasks_completed: k.total_tasks_completed,
      is_active: k.is_active,
      created_at: k.created_at,
    }));
  });

  // Revoke an agent key (scoped to the owner).
  app.delete('/accounts/me/agent-keys/:id', { preHandler: [authMiddleware, requireOwner] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await revokeAgentKey(req.account.id, id);
    return { revoked: id };
  });
}
