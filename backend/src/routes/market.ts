import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { requireOwner } from '../middleware/principal';
import { collectOwnerOverview } from '../services/metricsService';

export async function marketRoutes(app: FastifyInstance) {
  // Owner-console overview (Slice B3): one call returns the review-queue counts,
  // wallet summary, and agent-identity credential summary so the console does not
  // have to fan out across many endpoints. Owner credential only — agent keys get
  // their execution context from the MCP status tools, not this console view.
  app.get('/market/overview', { preHandler: [authMiddleware, requireOwner] }, async (req) => {
    const a = req.account;
    const overview = await collectOwnerOverview(a.id);
    return {
      principal: {
        kind: 'owner',
        account_id: a.id,
        agent_key_id: null,
      },
      counts: overview.counts,
      wallet: {
        earned: a.earned_balance,
        gift: a.gift_balance,
        frozen_earned: a.frozen_earned_balance,
        spendable: a.earned_balance + a.gift_balance,
      },
      agent_identities: overview.agent_identities,
    };
  });
}
