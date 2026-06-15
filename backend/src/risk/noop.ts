import type { RiskEngine } from './types';

/**
 * Open-source default: allow everything, no flags. Lets the AGPL repo run as a
 * complete, working marketplace with zero risk logic. Replaced at runtime by a
 * RemoteRiskEngine when RISK_ENGINE_URL is set.
 */
export class NoopRiskEngine implements RiskEngine {
  async onRegister() {
    return { allow: true, creditClass: 'gift' as const };
  }
  async onClaim() {
    return { allow: true };
  }
  async onPublish() {
    return { allow: true };
  }
  async onFinalize() {
    return { allow: true, reviewSample: false };
  }
}
