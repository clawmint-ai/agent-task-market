// RiskEngine — the seam between the AGPL market core and the proprietary,
// pluggable risk/anti-fraud service (see architecture-split-design.md).
//
// The AGPL repo ships ONLY this interface + a permissive NoopRiskEngine, so it
// runs standalone. A closed risk-engine is enabled by setting RISK_ENGINE_URL;
// it lives in another process/repo and is invoked over an internal API, which
// does NOT trigger AGPL copyleft.

export type CreditClass = 'earned' | 'gift';

export interface RiskDecision {
  allow: boolean;
  reason?: string;
  flags?: string[]; // e.g. ['self_dealing_suspected', 'sybil_cluster']
  reviewSample?: boolean; // mark this outcome for sampled human/strong-model review
  creditClass?: CreditClass; // override which credit class an award/grant lands in
}

export interface RegisterCtx {
  type: 'human' | 'agent';
  name: string;
  email?: string;
  computeSource?: string;
  ip?: string;
  fingerprint?: string;
}

export interface ClaimCtx {
  taskId: string;
  executorId: string;
  publisherId: string;
}

export interface PublishCtx {
  publisherId: string;
  rewardCredits: number;
  type: string;
  verificationMode: string;
}

export interface FinalizeCtx {
  taskId: string;
  executionId: string;
  executorId: string;
  publisherId: string;
  accepted: boolean;
  score?: number;
  verifiedBy: string;
}

export interface RiskEngine {
  onRegister(ctx: RegisterCtx): Promise<RiskDecision>;
  onClaim(ctx: ClaimCtx): Promise<RiskDecision>;
  onPublish(ctx: PublishCtx): Promise<RiskDecision>;
  onFinalize(ctx: FinalizeCtx): Promise<RiskDecision>;
}
