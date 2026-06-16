import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  getSandboxRunner,
  resetSandboxRunnerForTest,
  DockerSandbox,
  LocalProcessSandbox,
} from '../../src/runtime/sandbox';

// The production guardrail (sandbox.ts) must refuse to start when untrusted code
// would run in-process in production. This regression-locks it, because the
// guard was once silently defeated by SANDBOX_ALLOW_LOCAL=1 leaking from base
// compose into the prod overlay (Compose merges environment maps).

const ENV_KEYS = ['NODE_ENV', 'SANDBOX_MODE', 'SANDBOX_ALLOW_LOCAL'] as const;
const saved: Record<string, string | undefined> = {};

function setEnv(env: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const k of ENV_KEYS) {
    if (k in env) {
      const v = env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    } else {
      delete process.env[k];
    }
  }
}

afterEach(() => {
  resetSandboxRunnerForTest();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// snapshot once at module load
for (const k of ENV_KEYS) saved[k] = process.env[k];

test('production + no docker mode → refuses to start (RCE guard)', () => {
  resetSandboxRunnerForTest();
  setEnv({ NODE_ENV: 'production' });
  assert.throws(() => getSandboxRunner(), /SANDBOX_MODE must be "docker"/);
});

test('production + SANDBOX_ALLOW_LOCAL=1 → bypasses guard (the leak that bit us)', () => {
  // ALLOW_LOCAL=1 is the deliberate override; it DOES bypass the guard. That is
  // exactly why the prod overlay must reset the key it inherits from base
  // compose — otherwise prod silently runs untrusted code in-process.
  resetSandboxRunnerForTest();
  setEnv({ NODE_ENV: 'production', SANDBOX_ALLOW_LOCAL: '1' });
  assert.ok(getSandboxRunner() instanceof LocalProcessSandbox);
});

test('production + SANDBOX_MODE=docker → DockerSandbox, no throw', () => {
  resetSandboxRunnerForTest();
  setEnv({ NODE_ENV: 'production', SANDBOX_MODE: 'docker' });
  assert.ok(getSandboxRunner() instanceof DockerSandbox);
});

test('non-production + no mode → LocalProcessSandbox (trusted seed default)', () => {
  resetSandboxRunnerForTest();
  setEnv({ NODE_ENV: 'development' });
  assert.ok(getSandboxRunner() instanceof LocalProcessSandbox);
});

test('SANDBOX_MODE=docker selects DockerSandbox regardless of NODE_ENV', () => {
  resetSandboxRunnerForTest();
  setEnv({ SANDBOX_MODE: 'docker' });
  assert.ok(getSandboxRunner() instanceof DockerSandbox);
});
