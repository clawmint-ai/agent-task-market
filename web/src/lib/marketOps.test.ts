import { describe, expect, it } from 'vitest';
import { normalizeRiskFlagsResponse, riskFlagLabel } from './marketOps';
import type { RiskFlag } from './types';

const flag: RiskFlag = {
  id: 'flag-1',
  account_id: 'acct-1',
  kind: 'self_dealing',
  amount: 50,
  detail: { execution_id: 'exec-1' },
};

describe('normalizeRiskFlagsResponse', () => {
  it('accepts both the current backend envelope and legacy arrays', () => {
    expect(normalizeRiskFlagsResponse({ flags: [flag] })).toEqual([flag]);
    expect(normalizeRiskFlagsResponse([flag])).toEqual([flag]);
  });

  it('falls back to an empty list when the response has no flags array', () => {
    expect(normalizeRiskFlagsResponse({})).toEqual([]);
  });
});

describe('riskFlagLabel', () => {
  it('summarizes the kind and frozen amount', () => {
    expect(riskFlagLabel(flag)).toBe('self_dealing · 50cr');
  });
});
