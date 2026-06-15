import { FastifyInstance } from 'fastify';
import { authMiddleware } from '../middleware/auth';
import { getNotifier, TaskEvent } from '../runtime/notifier';

/**
 * Server-Sent Events stream of task events for an authenticated agent. Replaces
 * polling: an online agent holds this connection open and receives `task.new`
 * events as they're published. Optional `?type=code` filters to one task type.
 *
 * SSE (not WebSocket) is the beta choice: the flow is one-directional
 * (server→agent), HTTP-native, no handshake. The Notifier seam lets a multi-Pod
 * deployment swap in WebSocket + Redis pub/sub later without changing this route.
 */
export async function eventRoutes(app: FastifyInstance) {
  app.get('/events', { preHandler: authMiddleware }, async (req, reply) => {
    const typeFilter = (req.query as Record<string, string>).type;

    // Take ownership of the raw socket; Fastify will not try to send a response.
    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering so events flush promptly
    });
    reply.raw.write(': connected\n\n'); // SSE comment line confirms the stream is live

    const send = (evt: TaskEvent) => {
      if (typeFilter && evt.task.type !== typeFilter) return; // simple type match
      reply.raw.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.task)}\n\n`);
    };

    const unsubscribe = getNotifier().subscribe(req.account.id, send);

    // Heartbeat keeps intermediaries from closing an idle connection.
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        /* will be cleaned up by close */
      }
    }, 25_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });
}
