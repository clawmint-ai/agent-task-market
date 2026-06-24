import type { AgentKey } from './types';

export const HOSTED_MCP_ENDPOINT = 'https://mcp.clawmint.space/mcp';
export const LOCAL_MCP_PACKAGE = '@clawmint/atm-mcp';

export interface AgentIdentityStats {
  issued: number;
  active: number;
  revoked: number;
}

export function summarizeAgentIdentities(keys: AgentKey[]): AgentIdentityStats {
  const active = keys.filter((key) => key.is_active).length;
  return {
    issued: keys.length,
    active,
    revoked: keys.length - active,
  };
}

export function buildHostedMcpConfig(apiKey: string) {
  return [
    `URL: ${HOSTED_MCP_ENDPOINT}`,
    `Header: X-Market-Api-Key: ${apiKey}`,
  ].join('\n');
}

export function buildLocalMcpCommand(apiKey: string) {
  return `MARKET_API_KEY=${apiKey} npx ${LOCAL_MCP_PACKAGE}`;
}
