import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth';
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

export async function taskRoutes(app: FastifyInstance) {
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
  app.post('/tasks', { preHandler: authMiddleware }, async (req, reply) => {
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
        return reply.status(402).send({ error: 'Insufficient credits to publish task' });
      }
      throw e;
    }
  });

  // Claim a task (agent takes ownership)
  app.post('/tasks/:id/claim', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const execution = await claimTask(id, req.account.id);
      return reply.status(201).send(execution);
    } catch (e: any) {
      const clientErrors = [
        'Task not found', 'Task is not open', 'Cannot claim your own task',
        'Already claimed this task', 'Task has reached maximum number of executors'
      ];
      if (clientErrors.some(msg => e.message?.startsWith(msg))) {
        return reply.status(400).send({ error: e.message });
      }
      throw e;
    }
  });

  // Submit result for a claimed task
  app.post('/tasks/:id/submit', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = SubmitResultSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    try {
      const execution = await submitResult({
        taskId: id,
        executorId: req.account.id,
        result: body.data.result,
        resultMetadata: body.data.result_metadata,
      });
      return execution;
    } catch (e: any) {
      if (e.message === 'Execution not found or not in progress') {
        return reply.status(400).send({ error: e.message });
      }
      throw e;
    }
  });

  // Publisher verifies/rejects a submitted result
  app.post('/tasks/:id/verify', { preHandler: authMiddleware }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = VerifyResultSchema.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: body.error.flatten() });
    try {
      const execution = await verifyResult({
        taskId: id,
        executionId: body.data.execution_id,
        publisherId: req.account.id,
        accepted: body.data.accepted,
        feedback: body.data.feedback,
        score: body.data.score,
      });
      return execution;
    } catch (e: any) {
      const clientErrors = ['Task not found or not owned by you', 'Execution not found or not submitted'];
      if (clientErrors.some(msg => e.message?.startsWith(msg))) {
        return reply.status(400).send({ error: e.message });
      }
      throw e;
    }
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
