import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import express from 'express';
import { buildServer } from './tools.js';

const TRANSPORT = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();

// ── stdio mode: one local agent, API key from env ────────────────────────────
async function runStdio() {
  const apiKey = process.env.MARKET_API_KEY;
  if (!apiKey) {
    console.error('ERROR: MARKET_API_KEY is required in stdio mode');
    process.exit(1);
  }
  const server = buildServer(apiKey);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🤖 Agent Task Market MCP Server (stdio) started');
}

// ── HTTP mode: many remote agents (Hermes etc.), API key per request ─────────
async function runHttp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);

  // Per-session transports, keyed by mcp-session-id
  const sessions: Record<string, { transport: StreamableHTTPServerTransport }> = {};

  app.post('/mcp', async (req, res) => {
    // Each agent authenticates with its own market API key.
    const apiKey =
      (req.headers['x-market-api-key'] as string) ||
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : undefined);

    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessions[sessionId]) {
      await sessions[sessionId].transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — must be an initialize request and carry an API key
    if (!apiKey) {
      res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Missing market API key (X-Market-Api-Key or Authorization: Bearer)' },
        id: null,
      });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions[sid] = { transport };
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete sessions[transport.sessionId];
    };

    const server = buildServer(apiKey);
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // SSE stream + session termination
  const handleSession = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    await sessions[sessionId].transport.handleRequest(req, res);
  };
  app.get('/mcp', handleSession);
  app.delete('/mcp', handleSession);

  app.get('/health', (_req, res) => res.json({ status: 'ok', transport: 'http' }));

  app.listen(port, () => {
    console.error(`🤖 Agent Task Market MCP Server (HTTP) on http://0.0.0.0:${port}/mcp`);
    console.error('   Remote agents (Hermes etc.) connect with their own X-Market-Api-Key header.');
  });
}

async function main() {
  if (TRANSPORT === 'http') {
    await runHttp();
  } else {
    await runStdio();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
