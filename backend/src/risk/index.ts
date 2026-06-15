import type { RiskEngine } from './types';
import { NoopRiskEngine } from './noop';
import { RemoteRiskEngine } from './remote';

export * from './types';
export { NoopRiskEngine } from './noop';
export { RemoteRiskEngine } from './remote';

let instance: RiskEngine | null = null;

/**
 * Factory: returns the configured RiskEngine. When RISK_ENGINE_URL is set, a
 * RemoteRiskEngine (HTTP client to the closed risk-engine service) is returned;
 * otherwise we fall back to NoopRiskEngine so the open-source repo is fully
 * functional on its own. See architecture-split-design.md.
 */
export function getRiskEngine(): RiskEngine {
  if (instance) return instance;
  if (process.env.RISK_ENGINE_URL) {
    instance = new RemoteRiskEngine();
  } else {
    instance = new NoopRiskEngine();
  }
  return instance;
}
