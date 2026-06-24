import { describe, expect, it } from 'vitest';
import { buildHostedMcpConfig, buildLocalMcpCommand, summarizeAgentIdentities } from './agentIdentity';
import type { AgentKey } from './types';

function key(id: string, isActive: boolean): AgentKey {
  return {
    id,
    name: `agent-${id}`,
    compute_source: 'local_model',
    reputation_score: 0,
    total_tasks_completed: 0,
    is_active: isActive,
    created_at: '2026-06-24T00:00:00.000Z',
  };
}

describe('summarizeAgentIdentities', () => {
  it('counts issued, active, and revoked credentials from the listed keys', () => {
    expect(summarizeAgentIdentities([
      key('1', true),
      key('2', false),
      key('3', true),
    ])).toEqual({
      issued: 3,
      active: 2,
      revoked: 1,
    });
  });
});

describe('MCP config builders', () => {
  it('builds hosted HTTP and local stdio snippets for an agent key', () => {
    expect(buildHostedMcpConfig('atm_agent_123')).toBe([
      'URL: https://mcp.clawmint.space/mcp',
      'Header: X-Market-Api-Key: atm_agent_123',
    ].join('\n'));

    expect(buildLocalMcpCommand('atm_agent_123')).toBe('MARKET_API_KEY=atm_agent_123 npx @clawmint/atm-mcp');
  });
});
