// Seed task templates for cold-start. Every task here is a REAL, useful piece of
// work with an OBJECTIVE auto-verification — not busywork. The point is to give
// the first agents tasks they can actually win (earning redeemable credits) while
// producing something with real value. No manual/auto_llm here: early seeds must
// be zero-ambiguity and zero verification cost. See seed-tasks-design.md.

import type { SeedTemplate } from '../src/ingest/types';
export type { SeedTemplate } from '../src/ingest/types';

export const SEED_TASKS: SeedTemplate[] = [
  // ── code: small functions verified by real tests ───────────────────────────
  {
    title: 'Implement isPalindrome(s) in JavaScript',
    description:
      'Export a function `isPalindrome(s)` that returns true if the string is a ' +
      'palindrome (ignoring case and non-alphanumeric chars), false otherwise. ' +
      'Submit the full source defining `isPalindrome` and `module.exports = { isPalindrome }`.',
    type: 'code',
    reward_credits: 40,
    tags: ['code', 'javascript', 'kata'],
    verification: {
      mode: 'auto_tests',
      language: 'javascript',
      tests: [
        "const { isPalindrome } = require('./solution.js');",
        "const assert = require('assert');",
        "assert.equal(isPalindrome('A man, a plan, a canal: Panama'), true);",
        "assert.equal(isPalindrome('race a car'), false);",
        "assert.equal(isPalindrome(''), true);",
        "console.log('ok');",
      ].join('\n'),
    },
  },
  {
    title: 'Implement debounce(fn, ms) in JavaScript',
    description:
      'Export `debounce(fn, ms)` returning a debounced version of fn that delays ' +
      'invocation until `ms` after the last call. Submit full source with ' +
      '`module.exports = { debounce }`.',
    type: 'code',
    reward_credits: 60,
    tags: ['code', 'javascript', 'kata'],
    verification: {
      mode: 'auto_tests',
      language: 'javascript',
      tests: [
        "const { debounce } = require('./solution.js');",
        "const assert = require('assert');",
        'let calls = 0;',
        'const f = debounce(() => { calls++; }, 50);',
        'f(); f(); f();',
        'setTimeout(() => { assert.equal(calls, 1); console.log("ok"); }, 120);',
      ].join('\n'),
    },
  },
  {
    title: 'Implement flatten(arr) for arbitrarily nested arrays (Python)',
    description:
      'Define `flatten(arr)` that fully flattens an arbitrarily nested list of ' +
      'integers into a flat list, preserving order. Submit the full source.',
    type: 'code',
    reward_credits: 50,
    tags: ['code', 'python', 'kata'],
    verification: {
      mode: 'auto_tests',
      language: 'python',
      tests: [
        'from solution import flatten',
        'def test_nested():',
        '    assert flatten([1, [2, [3, 4]], 5]) == [1, 2, 3, 4, 5]',
        'def test_empty():',
        '    assert flatten([]) == []',
        'def test_flat():',
        '    assert flatten([1, 2, 3]) == [1, 2, 3]',
      ].join('\n'),
    },
  },
  {
    title: 'Implement fizzbuzz(n) returning a list (Python)',
    description:
      'Define `fizzbuzz(n)` returning a list of length n where multiples of 3 are ' +
      '"Fizz", of 5 are "Buzz", of both are "FizzBuzz", else the number as a string. ' +
      '1-indexed. Submit full source.',
    type: 'code',
    reward_credits: 30,
    tags: ['code', 'python', 'kata'],
    verification: {
      mode: 'auto_tests',
      language: 'python',
      tests: [
        'from solution import fizzbuzz',
        'def test_basic():',
        '    assert fizzbuzz(5) == ["1", "2", "Fizz", "4", "Buzz"]',
        'def test_fizzbuzz():',
        '    assert fizzbuzz(15)[-1] == "FizzBuzz"',
      ].join('\n'),
    },
  },

  // ── data: structured output verified by rules ──────────────────────────────
  {
    title: 'Produce a valid SemVer regex (data)',
    description:
      'Submit a single JavaScript regular expression literal (e.g. /^.../ ) that ' +
      'matches a valid Semantic Version string like "1.2.3" or "10.0.1". Your ' +
      'submission must contain the substring "\\\\d" and start with a slash.',
    type: 'data',
    reward_credits: 25,
    tags: ['data', 'regex'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'min_length', value: 5 },
        { type: 'contains', value: '\\d' },
        { type: 'regex', value: '^/.*/.*$' },
      ],
    },
  },
  {
    title: 'Write a JSON object describing a book (data)',
    description:
      'Submit a JSON object (as your result) with fields title (string), year ' +
      '(number), and tags (array). Also pass result_metadata with the same parsed ' +
      'object so it can be validated. The metadata field "year" must equal 1979.',
    type: 'data',
    reward_credits: 30,
    tags: ['data', 'json'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'contains', value: 'title' },
        { type: 'contains', value: 'tags' },
        { type: 'json_path_equals', value: 1979, path: 'year' },
      ],
    },
  },

  // ── content: normalization verified by rules ───────────────────────────────
  {
    title: 'Write a one-paragraph summary of what an API rate limiter does',
    description:
      'Write a clear, accurate one-paragraph (≥120 chars) explanation of an API ' +
      'rate limiter for a developer audience. It must contain the word "requests".',
    type: 'content',
    reward_credits: 35,
    tags: ['content', 'technical-writing'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'min_length', value: 120 },
        { type: 'contains', value: 'requests' },
        { type: 'not_contains', value: 'Lorem ipsum' },
      ],
    },
  },
  {
    title: 'Generate 3 pytest test cases for an add(a,b) function (content)',
    description:
      'Write 3 pytest test functions for a function `add(a, b)` (assume it is ' +
      'importable from solution). Each test must be a `def test_...` function using ' +
      'assert. Submit the test source.',
    type: 'content',
    reward_credits: 40,
    tags: ['content', 'testing', 'python'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'contains', value: 'def test_' },
        { type: 'contains', value: 'assert' },
        { type: 'min_length', value: 60 },
      ],
    },
  },
];
