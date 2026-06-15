import type {
  RiskEngine,
  RiskDecision,
  RegisterCtx,
  ClaimCtx,
  PublishCtx,
  FinalizeCtx,
} from './types';

/**
 * HTTP client to the closed risk-engine service (see architecture-split-design.md).
 * Enabled by getRiskEngine() when RISK_ENGINE_URL is set; the proprietary heuristics
 * live behind this network boundary, so the AGPL core links none of them.
 *
 * Design contract: this client THROWS on any transport failure (timeout, non-2xx,
 * unparseable body). It does NOT decide fail-open vs fail-closed — that lives at the
 * call sites (services/task/lifecycle.ts, services/task/settlement.ts), which catch
 * the throw and apply the right policy: fail-open for register/publish/claim,
 * fail-closed-when-accepted for onFinalize. Keeping the policy at the call site means
 * a swapped-in engine can't silently change the system's safety posture.
 */
export class RemoteRiskEngine implements RiskEngine {
  constructor(
    private baseUrl = process.env.RISK_ENGINE_URL!,
    private apiKey = process.env.RISK_ENGINE_KEY,
    private timeoutMs = parseInt(process.env.RISK_ENGINE_TIMEOUT_MS || '2000', 10),
  ) {
    // Normalize: drop a trailing slash so `${baseUrl}/onClaim` is well-formed.
    this.baseUrl = this.baseUrl.replace(/\/+$/, '');
  }

  onRegister(ctx: RegisterCtx): Promise<RiskDecision> {
    return this.post('onRegister', ctx);
  }
  onClaim(ctx: ClaimCtx): Promise<RiskDecision> {
    return this.post('onClaim', ctx);
  }
  onPublish(ctx: PublishCtx): Promise<RiskDecision> {
    return this.post('onPublish', ctx);
  }
  onFinalize(ctx: FinalizeCtx): Promise<RiskDecision> {
    return this.post('onFinalize', ctx);
  }

  /**
   * POST the hook context to `${baseUrl}/<hook>` and parse a RiskDecision. Throws on
   * timeout, non-2xx, or a body missing the required `allow` boolean — the caller's
   * fail-open/fail-closed handler takes it from there.
   */
  private async post(hook: string, ctx: unknown): Promise<RiskDecision> {
    // Node 18+ provides a global fetch; no node-fetch dependency needed here.
    const res = await fetch(`${this.baseUrl}/${hook}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(ctx),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`risk-engine ${hook} returned HTTP ${res.status}`);
    }

    const data = (await res.json()) as Partial<RiskDecision>;
    if (typeof data?.allow !== 'boolean') {
      throw new Error(`risk-engine ${hook} response missing boolean "allow"`);
    }
    return data as RiskDecision;
  }
}
