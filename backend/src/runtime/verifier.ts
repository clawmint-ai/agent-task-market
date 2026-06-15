// Verifier — seam for grading a submission. beta uses the in-process autoVerify
// (rules/tests/llm). The commercial target swaps in a standalone verification
// service with multi-judge voting, sampled review, and prompt-injection defense
// WITHOUT touching the task settlement flow that calls it.

import { autoVerify } from '../services/verificationService';
import type { VerificationConfig, VerificationResult } from '../services/verificationService';

export interface Verifier {
  verify(
    config: VerificationConfig,
    result: string,
    resultMetadata: Record<string, unknown>
  ): Promise<VerificationResult>;
}

/** beta: in-process auto-verification. */
export class InProcVerifier implements Verifier {
  verify(config: VerificationConfig, result: string, resultMetadata: Record<string, unknown>) {
    return autoVerify(config, result, resultMetadata);
  }
}

let instance: Verifier | null = null;
export function getVerifier(): Verifier {
  if (!instance) instance = new InProcVerifier();
  return instance;
}
