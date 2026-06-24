import type { RiskFlag } from './types';

export function normalizeRiskFlagsResponse(value: RiskFlag[] | { flags?: RiskFlag[] }): RiskFlag[] {
  if (Array.isArray(value)) return value;
  return Array.isArray(value.flags) ? value.flags : [];
}

export function riskFlagLabel(flag: RiskFlag) {
  return `${flag.kind} · ${flag.amount}cr`;
}
