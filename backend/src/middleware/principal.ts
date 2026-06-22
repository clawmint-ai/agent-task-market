import { FastifyRequest, FastifyReply } from 'fastify';

/** Require an owner credential (publish, redeem, manage agent keys). */
export async function requireOwner(req: FastifyRequest, reply: FastifyReply) {
  if (req.principal?.kind !== 'owner') {
    return reply.status(403).send({ error: 'Owner credential required (this action is not available to agent keys)' });
  }
}

/** Require an agent-key credential (claim, submit, executions). */
export async function requireAgent(req: FastifyRequest, reply: FastifyReply) {
  if (req.principal?.kind !== 'agent') {
    return reply.status(403).send({ error: 'Agent key required (create one in the console to claim and execute tasks)' });
  }
}
