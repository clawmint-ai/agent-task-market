// Integration test for RemoteRiskEngine (CLAWMIN-9). Unlike the unit tests
// (test/unit/remoteRiskEngine.test.ts) which mock global fetch, this spins up a
// REAL http stub server on loopback and does a genuine round-trip through the
// real fetch path: request serialization, the Bearer header, {baseUrl}/{hook}
// URL formatting, response parsing, and the throw-on-error contract.
// No DB needed. Run: npm run test:integration

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { RemoteRiskEngine } = require('../../dist/risk/remote.js');

let server, baseUrl;
// Records what the stub actually received, so we can assert the wire format.
const received = [];
// Per-path canned responses the stub returns; each test sets what it needs.
let routes = {};

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({
        method: req.method,
        url: req.url,
        auth: req.headers['authorization'],
        contentType: req.headers['content-type'],
        body: body ? JSON.parse(body) : undefined,
      });
      const route = routes[req.url];
      if (!route) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(route.status, { 'Content-Type': 'application/json' });
      res.end(typeof route.body === 'string' ? route.body : JSON.stringify(route.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

// Reset captured state between tests.
function reset() {
  received.length = 0;
  routes = {};
}

test('round-trips a hook through a real server: POST {baseUrl}/onClaim, parses decision', async () => {
  reset();
  routes['/onClaim'] = { status: 200, body: { allow: true, reason: 'clean', flags: [] } };

  const engine = new RemoteRiskEngine(baseUrl, undefined, 2000);
  const decision = await engine.onClaim({ taskId: 't1', executorId: 'e1', publisherId: 'p1' });

  assert.equal(decision.allow, true);
  assert.equal(decision.reason, 'clean');
  assert.equal(received.length, 1);
  assert.equal(received[0].method, 'POST');
  assert.equal(received[0].url, '/onClaim');
  assert.equal(received[0].contentType, 'application/json');
  assert.deepEqual(received[0].body, { taskId: 't1', executorId: 'e1', publisherId: 'p1' });
});

test('sends Bearer auth over the wire when a key is configured', async () => {
  reset();
  routes['/onRegister'] = { status: 200, body: { allow: false, reason: 'blocked' } };

  const engine = new RemoteRiskEngine(baseUrl, 'secret-123', 2000);
  const decision = await engine.onRegister({ type: 'agent', name: 'bot', ip: '10.0.0.1' });

  assert.equal(decision.allow, false, 'allow:false is a valid decision, not an error');
  assert.equal(received[0].auth, 'Bearer secret-123');
});

test('non-2xx from the real server throws (call site applies fail-open/closed)', async () => {
  reset();
  routes['/onPublish'] = { status: 503, body: { error: 'risk engine down' } };

  const engine = new RemoteRiskEngine(baseUrl, undefined, 2000);
  await assert.rejects(
    () => engine.onPublish({ publisherId: 'p', rewardCredits: 5, type: 'code', verificationMode: 'auto_tests' }),
    /HTTP 503/,
  );
});

test('a 200 body missing boolean "allow" throws', async () => {
  reset();
  routes['/onRegister'] = { status: 200, body: { reason: 'no allow field' } };

  const engine = new RemoteRiskEngine(baseUrl, undefined, 2000);
  await assert.rejects(
    () => engine.onRegister({ type: 'human', name: 'alice' }),
    /missing boolean "allow"/,
  );
});
