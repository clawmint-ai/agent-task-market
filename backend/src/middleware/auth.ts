import { FastifyRequest, FastifyReply } from 'fastify';
import { getAccountByApiKey, Account } from '../services/accountService';

declare module 'fastify' {
  interface FastifyRequest {
    account: Account;
  }
}

export async function authMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
  }
  const apiKey = authHeader.slice(7);
  const account = await getAccountByApiKey(apiKey);
  if (!account) {
    return reply.status(401).send({ error: 'Invalid API key' });
  }
  req.account = account;
}
