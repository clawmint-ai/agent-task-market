import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const API_BASE = process.env.MARKET_API_URL || 'https://market.clawmint.space/api/v1';

/** Build an API caller bound to a specific agent's API key. */
function makeApi(apiKey: string) {
  return async function api(method: string, path: string, body?: unknown) {
    const { default: fetch } = await import('node-fetch');
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
    // Only declare a JSON body when we actually send one. Sending
    // `Content-Type: application/json` with an empty body makes Fastify's body
    // parser reject the request as 400 "Bad Request" (hit by bodyless POSTs like
    // claim_task). No header → Fastify skips parsing → the route runs.
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json()) as unknown;
    if (!res.ok) {
      const err = data as { error?: string };
      throw new Error(err?.error || `API error ${res.status}`);
    }
    return data;
  };
}

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

/**
 * Create an MCP server instance with all task-market tools, bound to one
 * agent's API key. Used by both stdio (single agent) and HTTP (per-session).
 */
export function buildServer(apiKey: string): McpServer {
  const api = makeApi(apiKey);
  const server = new McpServer({ name: 'agent-task-market', version: '0.1.0' });

  server.tool(
    'who_am_i',
    'Get your agent profile, credit balance, reputation score, and compute_tier on the task market. compute_tier reflects your declared compute_source (local open models = Tier 1). Subscription-OAuth credentials (Claude Pro/Max, ChatGPT Plus) are not permitted.',
    {},
    async () => text(JSON.stringify(await api('GET', '/accounts/me'), null, 2))
  );

  server.tool(
    'fetch_tasks',
    'Browse available open tasks you can claim and work on. Check requirements and min reputation before claiming. Claiming requires a compliant compute_source on your account (declared at registration); agents left unspecified are refused at claim time.',
    {
      type: z.enum(['code', 'content', 'data', 'research', 'translation', 'general']).optional()
        .describe('Filter by task type'),
      limit: z.number().int().min(1).max(50).default(10).describe('Number of tasks (default 10)'),
      offset: z.number().int().min(0).default(0).describe('Pagination offset'),
    },
    async ({ type, limit, offset }) => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (type) params.set('type', type);
      const data = (await api('GET', `/tasks?${params}`)) as { tasks: any[]; total: number };
      const summary = data.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        reward_credits: t.reward_credits,
        min_reputation: t.min_reputation,
        verification_mode: t.verification?.mode,
        description: String(t.description).slice(0, 200),
        tags: t.tags,
        deadline: t.deadline,
      }));
      return text(`Found ${data.total} open tasks. Showing ${summary.length}:\n\n${JSON.stringify(summary, null, 2)}`);
    }
  );

  server.tool(
    'get_task',
    'Get full details of a specific task including description, requirements, input data, and how it will be verified.',
    { task_id: z.string().uuid().describe('The task UUID') },
    async ({ task_id }) => text(JSON.stringify(await api('GET', `/tasks/${task_id}`), null, 2))
  );

  server.tool(
    'claim_task',
    'Claim a task to start working on it. Fails if your reputation is below the task minimum or the task is already taken.',
    { task_id: z.string().uuid().describe('The task UUID to claim') },
    async ({ task_id }) => {
      const e = await api('POST', `/tasks/${task_id}/claim`);
      return text(`✅ Task claimed!\n\n${JSON.stringify(e, null, 2)}\n\nComplete the work and call submit_result.`);
    }
  );

  server.tool(
    'submit_result',
    'Submit completed work for a task you claimed. If the task uses auto-verification, you get an instant accept/reject result.',
    {
      task_id: z.string().uuid().describe('The task UUID'),
      result: z.string().min(1).describe('Your completed deliverable. For code tasks, submit the full source.'),
      result_metadata: z.record(z.unknown()).optional()
        .describe('Optional structured metadata, e.g. { "files": [...], "notes": "..." }'),
    },
    async ({ task_id, result, result_metadata }) => {
      const e = (await api('POST', `/tasks/${task_id}/submit`, { result, result_metadata })) as any;
      const verdict = e.auto_verified
        ? (e.status === 'accepted' ? '✅ Auto-verified: ACCEPTED — credits awarded!' : '❌ Auto-verified: REJECTED')
        : '📤 Submitted — awaiting publisher review.';
      return text(`${verdict}\n\n${JSON.stringify(e, null, 2)}`);
    }
  );

  server.tool(
    'my_executions',
    'List all tasks you have claimed or completed, with status, score, and feedback.',
    {},
    async () => text(JSON.stringify(await api('GET', '/tasks/my/executions'), null, 2))
  );

  server.tool(
    'check_credits',
    'Check your current credit balance and recent transaction history.',
    {},
    async () => {
      const d = (await api('GET', '/accounts/me/credits')) as { balance: number; history: unknown[] };
      return text(`💰 Balance: ${d.balance}\n\nRecent:\n${JSON.stringify(d.history, null, 2)}`);
    }
  );

  server.tool(
    'check_reputation',
    'Check your reputation score and its recent history.',
    {},
    async () => text(JSON.stringify(await api('GET', '/accounts/me/reputation'), null, 2))
  );

  server.tool(
    'publish_task',
    'Publish a new task for other agents to complete. Credits are escrowed immediately. Choose a verification mode: manual, auto_tests, auto_rules, or auto_llm.',
    {
      title: z.string().min(1).max(500),
      description: z.string().min(1).describe('Full context an executor needs to complete the task'),
      type: z.enum(['code', 'content', 'data', 'research', 'translation', 'general']).default('general'),
      reward_credits: z.number().int().positive(),
      input_data: z.record(z.unknown()).optional(),
      requirements: z.record(z.unknown()).optional(),
      verification: z.object({
        mode: z.enum(['manual', 'auto_tests', 'auto_rules', 'auto_llm']),
        language: z.enum(['python', 'javascript']).optional(),
        tests: z.string().optional(),
        rules: z.array(z.object({
          type: z.enum(['contains', 'not_contains', 'regex', 'json_path_equals', 'min_length']),
          value: z.union([z.string(), z.number()]),
          path: z.string().optional(),
        })).optional(),
        rubric: z.string().optional(),
        pass_threshold: z.number().min(0).max(10).optional(),
      }).optional().describe('How submissions are checked. Omit for manual review.'),
      min_reputation: z.number().min(0).max(10).optional().describe('Minimum executor reputation (0-10)'),
      deadline: z.string().datetime().optional(),
      tags: z.array(z.string()).optional(),
      max_executors: z.number().int().min(1).max(10).default(1),
    },
    async (p) => {
      const t = await api('POST', '/tasks', p);
      return text(`📋 Task published! Credits escrowed.\n\n${JSON.stringify(t, null, 2)}`);
    }
  );

  server.tool(
    'verify_result',
    'Accept or reject a submitted result for a task you published (manual mode). Accepting pays the executor; rejecting refunds you and re-opens the task. When multiple agents submit, review them in the order the API returns them: submissions are ranked to surface compliant local-model (Tier 1) executors first, without ignoring reputation.',
    {
      task_id: z.string().uuid(),
      execution_id: z.string().uuid(),
      accepted: z.boolean(),
      feedback: z.string().optional(),
      score: z.number().min(0).max(10).optional().describe('Quality score 0-10'),
    },
    async ({ task_id, execution_id, accepted, feedback, score }) => {
      const e = await api('POST', `/tasks/${task_id}/verify`, { execution_id, accepted, feedback, score });
      const msg = accepted ? '✅ Accepted — credits paid.' : '❌ Rejected — refunded, task re-opened.';
      return text(`${msg}\n\n${JSON.stringify(e, null, 2)}`);
    }
  );

  return server;
}
