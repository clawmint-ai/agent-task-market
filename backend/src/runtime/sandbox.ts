// SandboxRunner — seam for executing untrusted submitted code. beta uses a
// local child process (current behavior); before opening to anonymous code the
// commercial target swaps in a Firecracker/gVisor/no-network Docker runner pool
// WITHOUT touching the verification logic that calls it.
//
// SECURITY: the beta LocalProcessSandbox is NOT a security boundary (no network/
// fs isolation). It is only safe for trusted/self-authored seed tasks. See
// code-audit-v1.md §2.1 and roadmap §2.0c.

import { spawn } from 'child_process';

export interface SandboxResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface SandboxRunner {
  run(cmd: string, args: string[], cwd: string, timeoutMs?: number): Promise<SandboxResult>;
}

export class LocalProcessSandbox implements SandboxRunner {
  run(cmd: string, args: string[], cwd: string, timeoutMs = 15000): Promise<SandboxResult> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd,
        timeout: timeoutMs,
        // This local runner is explicitly NOT a security boundary (see file
        // header) — it's only for trusted/self-authored seed tasks. So we inherit
        // the full parent environment rather than a stripped one: overriding HOME
        // or PATH here bought no real isolation but DID break tooling that resolves
        // packages from the user environment (e.g. `pip install --user pytest`
        // lives under the real HOME's user site-packages; a rewritten HOME makes
        // Python look in the wrong place and report "No module named pytest").
        // Real isolation for untrusted code is DockerSandbox's job, which clears env.
        env: process.env,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
      child.on('error', (err) => resolve({ code: 1, stdout, stderr: String(err) }));
    });
  }
}

/**
 * Docker-isolated sandbox: runs the command inside a throwaway container with NO
 * network, dropped capabilities, no-new-privileges, cleared env, a read-only root
 * filesystem, and CPU/memory/pids limits. The disposable work dir is mounted
 * read-write (it's a per-submission tmpdir the host deletes afterward; test
 * runners need to write caches there). The security boundary is network/cap/
 * resource isolation, not work-dir immutability. Suitable for untrusted submitted
 * code (code-audit §2.1). Requires Docker on the host.
 *
 * Image is configurable via SANDBOX_IMAGE. The work dir is mounted at /work and
 * the cmd runs with /work as cwd.
 */
export class DockerSandbox implements SandboxRunner {
  constructor(
    private image = process.env.SANDBOX_IMAGE || 'node:20-bookworm-slim',
    private memLimit = process.env.SANDBOX_MEM || '256m',
    private cpus = process.env.SANDBOX_CPUS || '1',
    private pids = process.env.SANDBOX_PIDS || '128'
  ) {}

  run(cmd: string, args: string[], cwd: string, timeoutMs = 15000): Promise<SandboxResult> {
    // Run the container as the SAME uid:gid as this backend process. Two reasons:
    //  1. Correctness: --cap-drop=ALL strips CAP_DAC_OVERRIDE, so the container's
    //     root can NO LONGER bypass file permissions. The work dir is created by
    //     fs.mkdtempSync at mode 0700 owned by this process's uid; a mismatched
    //     container user (default root=0) can't even traverse into /work →
    //     EACCES on every run → silent infra-fallback. Matching uid fixes it.
    //  2. Defense in depth: untrusted submitted code runs as a non-root,
    //     unprivileged user instead of container-root.
    // HOME=/tmp (tmpfs, writable) so tools that need a home dir don't fail when
    // the image has no passwd entry for this uid under the read-only root fs.
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    const gid = typeof process.getgid === 'function' ? process.getgid() : 0;
    const dockerArgs = [
      'run', '--rm',
      '--network=none',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--user', `${uid}:${gid}`,
      `--memory=${this.memLimit}`,
      `--cpus=${this.cpus}`,
      `--pids-limit=${this.pids}`,
      '--read-only', // root fs read-only; the work mount below stays writable
      '--tmpfs=/tmp:rw,size=64m',
      '-v', `${cwd}:/work:rw`,
      '-w', '/work',
      // Clear env: only a minimal PATH + a writable HOME inside the container.
      '--env', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      '--env', 'HOME=/tmp',
      this.image,
      cmd, ...args,
    ];
    return new Promise((resolve) => {
      // Timeout slightly larger than inner timeout; `docker run` is killed on timeout.
      const child = spawn('docker', dockerArgs, { timeout: timeoutMs + 5000 });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d.toString()));
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
      child.on('error', (err) => resolve({ code: 1, stdout, stderr: `docker error: ${String(err)}` }));
    });
  }
}

let instance: SandboxRunner | null = null;

/**
 * Factory. SANDBOX_MODE=docker selects the isolated runner (required before
 * accepting untrusted code); anything else falls back to the local process
 * runner (fine for trusted/self-authored seed tasks only).
 *
 * Production guardrail: running untrusted submissions in a local process is a
 * remote-code-execution risk. If NODE_ENV=production and docker isolation was
 * not explicitly selected, refuse to start rather than silently exposing the
 * host. Set SANDBOX_MODE=docker (or SANDBOX_ALLOW_LOCAL=1 to override knowingly).
 */
export function getSandboxRunner(): SandboxRunner {
  if (instance) return instance;
  const mode = process.env.SANDBOX_MODE;
  if (
    process.env.NODE_ENV === 'production' &&
    mode !== 'docker' &&
    process.env.SANDBOX_ALLOW_LOCAL !== '1'
  ) {
    throw new Error(
      'Refusing to start: SANDBOX_MODE must be "docker" in production (local ' +
        'process execution of untrusted submissions is an RCE risk). Set ' +
        'SANDBOX_MODE=docker, or SANDBOX_ALLOW_LOCAL=1 to override deliberately.'
    );
  }
  instance = mode === 'docker' ? new DockerSandbox() : new LocalProcessSandbox();
  return instance;
}

/**
 * Test-only: clears the memoized singleton so a test can re-evaluate the factory
 * under different env (NODE_ENV / SANDBOX_MODE / SANDBOX_ALLOW_LOCAL). Not used
 * in production paths.
 */
export function resetSandboxRunnerForTest(): void {
  instance = null;
}
