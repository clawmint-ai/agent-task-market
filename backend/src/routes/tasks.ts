import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { InsufficientCreditsError } from '../domain/errors';
import type { RateLimiter } from '../middleware/rateLimit';
import {
  listTasks, getTaskById, createTask,
  claimTask, submitResult, verifyResult, getMyExecutions, getTaskSubmissions, getMyPublished
} from '../services/task';
import { z } from 'zod';

const VerificationSchema = z.object({
  mode: z.enum(['manual', 'auto_tests', 'auto_rules', 'auto_llm']).default('manual'),
  language: z.enum(['python', 'javascript']).optional(),
  tests: z.string().optional(),
  rules: z.array(z.object({
    type: z.enum(['contains', 'not_contains', 'regex', 'json_path_equals', 'min_length']),
    value: z.union([z.string(), z.number()]),
    path: z.string().optional(),
  })).optional(),
  rubric: z.string().optional(),
  pass_threshold: z.number().min(0).max(10).optional(),
});

const CreateTaskSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().min(1),
  type: z.enum(['code', 'content', 'data', 'research', 'translation', 'general']).default('general'),
  reward_credits: z.number().int().positive(),
  requirements: z.record(z.unknown()).optional(),
  input_data: z.record(z.unknown()).optional(),
  deadline: z.string().datetime().optional(),
  max_executors: z.number().int().positive().max(10).default(1),
  tags: z.array(z.string()).optional(),
  verification: VerificationSchema.optional(),
  min_reputation: z.number().min(0).max(10).optional(),
});

const SubmitResultSchema = z.object({
  result: z.string().min(1),
  result_metadata: z.record(z.unknown()).optional(),
});

const VerifyResultSchema = z.object({
  execution_id: z.string().uuid(),
  accepted: z.boolean(),
  feedback: z.string().optional(),
  score: z.number().min(0).max(10).optional(),
});

export async function taskRoutes(app: FastifyInstance, opts: { taskLimiter: RateLimiter }) {
  // Money-moving routes (publish escrow, claim, submit, verify→settle) get an
  // explicit per-route limiter on top of the global one: an authed, balance-
  // mutating endpoint warrants a tighter, dedicated budget (defense-in-depth).
  // The limiter hook is named directly in each route's preHandler array (not via
  // an indirection) so it's statically visible to scanners.
  const rateLimit = opts.taskLimiter.hook;
  // List open tasks (public browse, but auth required for claim)
  app.get('/tasks', { preHandler: authMiddleware }, async (req, reply) => {
    const { status, type, limit, offset } = req.query as Record<string, string>;
    const result = await listTasks({
      status,
      type,
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    return result;
  });

  // Get single task
  app.get('/tasks/:id', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await getTaskById(id);
    if (!task) return reply.status(404).send({ error: 'Task not found' });
    return task;
  });

  // Publish a new task
  app.post('/tasks', { preHandler: [authMiddleware, rateLimit] }, async (req, reply) => {
    const body = CreateTaskSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    try {
      const task = await createTask({
        publisherId: req.account.id,
        title: body.data.title,
        description: body.data.description,
        type: body.data.type,
        rewardCredits: body.data.reward_credits,
        requirements: body.data.requirements,
        inputData: body.data.input_data,
        deadline: body.data.deadline,
        maxExecutors: body.data.max_executors,
        tags: body.data.tags,
        verification: body.data.verification as any,
        minReputation: body.data.min_reputation,
      });
      return reply.status(201).send(task);
    } catch (e: any) {
      if (e.message === 'Insufficient credits') {
        // Re-throw as typed so the central handler maps it (preserves 402 + adds code).
        throw new InsufficientCreditsError('Insufficient credits to publish task');
      }
      throw e;
    }
  });

  // Claim a task (agent takes ownership)
  app.post('/tasks/:id/claim', { preHandler: [authMiddleware, rateLimit] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const execution = await claimTask(id, req.account.id);
    return reply.status(201).send(execution);
  });

  // Submit result for a claimed task
  app.post('/tasks/:id/submit', { preHandler: [authMiddleware, rateLimit] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = SubmitResultSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const execution = await submitResult({
      taskId: id,
      executorId: req.account.id,
      result: body.data.result,
      resultMetadata: body.data.result_metadata,
    });
    return execution;
  });

  // Publisher verifies/rejects a submitted result.
  // codeql[js/missing-rate-limiting] — false positive: this route IS rate-limited
  // (the inline `rateLimit` preHandler = the project's hand-rolled createRateLimiter,
  // plus the app-level globalLimiter hook). CodeQL only recognizes a fixed set of
  // third-party limiter packages, not this custom one, so it can't see the guard.
  app.post('/tasks/:id/verify', { preHandler: [authMiddleware, rateLimit] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = VerifyResultSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    const execution = await verifyResult({
      taskId: id,
      executionId: body.data.execution_id,
      publisherId: req.account.id,
      accepted: body.data.accepted,
      feedback: body.data.feedback,
      score: body.data.score,
    });
    return execution;
  });

  // My executions (as executor)
  app.get('/tasks/my/executions', { preHandler: authMiddleware }, async (req, reply) => {
    const executions = await getMyExecutions(req.account.id);
    return executions;
  });

  // Submissions for a task I published
  app.get('/tasks/:id/submissions', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await getTaskSubmissions(id, req.account.id);
    } catch (e: any) {
      if (e.message?.startsWith('Task not found')) return reply.status(403).send({ error: e.message });
      throw e;
    }
  });

  // My published tasks
  app.get('/tasks/my/published', { preHandler: authMiddleware }, async (req, reply) => {
    const { limit, offset } = req.query as Record<string, string>;
    return getMyPublished(req.account.id, parseInt(limit || '20', 10), parseInt(offset || '0', 10));
  });
}
