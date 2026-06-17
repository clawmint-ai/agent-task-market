import type { RiskEngine } from './types';
import { NoopRiskEngine } from './noop';
import { RemoteRiskEngine } from './remote';
import { LocalRiskEngine } from './local';

export * from './types';
export { NoopRiskEngine } from './noop';
export { RemoteRiskEngine } from './remote';
export { LocalRiskEngine } from './local';

let instance: RiskEngine | null = null;

/**
 * Factory: returns the configured RiskEngine. Precedence:
 *   1. RISK_ENGINE_URL set        → RemoteRiskEngine (closed service; production).
 *   2. RISK_ENGINE_MODE=local     → LocalRiskEngine (open-core baseline heuristics).
 *   3. otherwise                  → NoopRiskEngine (permissive default).
 * So the open-source repo is fully functional standalone, and an operator can turn on
 * baseline Sybil/self-dealing controls with one env var without standing up the closed
 * service. See architecture-split-design.md and CLAWMIN-23.
 */
export function getRiskEngine(): RiskEngine {
  if (instance) return instance;
  if (process.env.RISK_ENGINE_URL) {
    instance = new RemoteRiskEngine();
  } else if ((process.env.RISK_ENGINE_MODE || '').toLowerCase() === 'local') {
    instance = new LocalRiskEngine();
  } else {
    instance = new NoopRiskEngine();
  }
  return instance;
}

/** Test seam: reset the memoized engine so a test can re-read env. */
export function resetRiskEngine(): void {
  instance = null;
}
