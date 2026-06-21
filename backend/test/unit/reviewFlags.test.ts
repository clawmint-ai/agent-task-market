import { test } from 'node:test';
import assert from 'node:assert';
import { parseArgs } from '../../scripts/review-flags-args';

test('list defaults to open when no status given', () => {
  assert.deepEqual(parseArgs(['list']), { cmd: 'list', status: 'open' });
});

test('list accepts each valid status', () => {
  for (const s of ['open', 'frozen', 'released'] as const) {
    assert.deepEqual(parseArgs(['list', s]), { cmd: 'list', status: s });
  }
});

test('list rejects an invalid status', () => {
  const r = parseArgs(['list', 'bogus']);
  assert.equal(r.cmd, 'error');
  assert.match((r as { message: string }).message, /invalid status "bogus"/);
});

test('release / confirm parse the flagId', () => {
  assert.deepEqual(parseArgs(['release', 'flag-123']), { cmd: 'release', flagId: 'flag-123' });
  assert.deepEqual(parseArgs(['confirm', 'flag-456']), { cmd: 'confirm', flagId: 'flag-456' });
});

test('release / confirm without a flagId is an error', () => {
  assert.equal(parseArgs(['release']).cmd, 'error');
  assert.match((parseArgs(['release']) as { message: string }).message, /release requires a <flagId>/);
  assert.equal(parseArgs(['confirm']).cmd, 'error');
});

test('unknown command is an error', () => {
  const r = parseArgs(['frobnicate']);
  assert.equal(r.cmd, 'error');
  assert.match((r as { message: string }).message, /unknown command "frobnicate"/);
});

test('no command is an error', () => {
  const r = parseArgs([]);
  assert.equal(r.cmd, 'error');
  assert.match((r as { message: string }).message, /no command given/);
});
