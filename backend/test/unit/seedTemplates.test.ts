// CLAWMIN-29: validates the seed task pool meets the cold-start bar. Pure (no DB):
// it only inspects the SEED_TASKS constant, so it runs as a unit test.
//
//   - 25+ tasks so the first agents don't run out of work
//   - all three auto-verification modes exercised (auto_tests / auto_rules / auto_llm)
//   - three difficulty tiers (easy / medium / hard), encoded as a tag
//   - reward_credits consistent with the tier band (tiering is real, not cosmetic)
//   - every template well-formed for its mode (tests / rules / rubric present)
//   - titles unique (title is the seeder's idempotency key)

import { test } from 'node:test';
import assert from 'node:assert';
import { SEED_TASKS } from '../../scripts/seed-templates';

const TIERS = ['easy', 'medium', 'hard'] as const;
type Tier = (typeof TIERS)[number];
// Reward bands per tier (credits). Boundaries inclusive, non-overlapping.
const BAND: Record<Tier, [number, number]> = { easy: [10, 25], medium: [26, 55], hard: [56, 100] };

const tierOf = (tags: string[]): Tier | undefined => TIERS.find((t) => tags.includes(t));

test('seed pool has 25+ tasks', () => {
  assert.ok(SEED_TASKS.length >= 25, `expected >=25 seed tasks, got ${SEED_TASKS.length}`);
});

test('titles are unique (idempotency key)', () => {
  const titles = SEED_TASKS.map((t) => t.title);
  assert.equal(new Set(titles).size, titles.length, 'duplicate seed title');
});

test('all three verification modes are represented', () => {
  const modes = new Set(SEED_TASKS.map((t) => t.verification.mode));
  for (const m of ['auto_tests', 'auto_rules', 'auto_llm']) {
    assert.ok(modes.has(m as any), `no seed task uses verification mode ${m}`);
  }
});

test('all three difficulty tiers are represented and reward matches the tier band', () => {
  const seen = new Set<Tier>();
  for (const t of SEED_TASKS) {
    const tier = tierOf(t.tags);
    assert.ok(tier, `task "${t.title}" has no difficulty tag (easy|medium|hard)`);
    seen.add(tier);
    const [lo, hi] = BAND[tier];
    assert.ok(
      t.reward_credits >= lo && t.reward_credits <= hi,
      `"${t.title}" is ${tier} but reward ${t.reward_credits} is outside ${lo}-${hi}`
    );
  }
  for (const tier of TIERS) assert.ok(seen.has(tier), `no ${tier} task`);
});

test('every template is well-formed for its mode', () => {
  for (const t of SEED_TASKS) {
    assert.ok(t.title && t.description && t.type, `"${t.title}" missing core fields`);
    assert.ok(t.reward_credits > 0, `"${t.title}" non-positive reward`);
    const v = t.verification as any;
    if (v.mode === 'auto_tests') {
      assert.ok(['python', 'javascript'].includes(v.language), `"${t.title}" auto_tests needs language`);
      assert.ok(typeof v.tests === 'string' && v.tests.length > 0, `"${t.title}" auto_tests needs tests`);
    } else if (v.mode === 'auto_rules') {
      assert.ok(Array.isArray(v.rules) && v.rules.length > 0, `"${t.title}" auto_rules needs rules[]`);
    } else if (v.mode === 'auto_llm') {
      assert.ok(typeof v.rubric === 'string' && v.rubric.length > 0, `"${t.title}" auto_llm needs a rubric`);
    } else {
      assert.fail(`"${t.title}" has unexpected mode ${v.mode}`);
    }
  }
});
