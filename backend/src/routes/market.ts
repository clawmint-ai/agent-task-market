import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { requireOwner } from '../middleware/principal';
import { getOwnerMarketOverview } from '../services/marketService';

export async function marketRoutes(app: FastifyInstance) {
  app.get('/market/overview', { preHandler: [authMiddleware, requireOwner] }, async (req) => {
    return getOwnerMarketOverview(req.account);
  });
}
