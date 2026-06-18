// Seed task templates for cold-start. Every task here is a REAL, useful piece of
// work with an OBJECTIVE auto-verification — not busywork. The point is to give
// the first agents tasks they can actually win (earning redeemable credits) while
// producing something with real value. See seed-tasks-design.md.
//
// CLAWMIN-29 — the pool is sized + tiered for a real cold start:
//   - 25+ tasks so the first agents don't run dry
//   - all three auto-verification modes: auto_tests (sandboxed code), auto_rules
//     (deterministic checks), auto_llm (rubric-graded; needs an LLM key, else the
//     task falls back to manual — see verifyLLM)
//   - three difficulty tiers encoded as a TAG (SeedTemplate has no difficulty
//     field): easy 10-25cr · medium 26-55cr · hard 56-100cr. Reward tracks tier.
// Adding a template is safe: the seeder dedups by title and is idempotent, so
// `npm run seed -- --commit` only inserts the ones not already published.

import type { SeedTemplate } from '../src/ingest/types';
export type { SeedTemplate } from '../src/ingest/types';

export const SEED_TASKS: SeedTemplate[] = [
  // ════════════════════════════════════════════════════════════════════════
  // code · auto_tests (sandboxed real tests)
  // ════════════════════════════════════════════════════════════════════════

  // ── easy ──────────────────────────────────────────────────────────────────
  {
    title: 'Implement reverseString(s) in JavaScript',
    description:
      'Export `reverseString(s)` returning the input string reversed. Submit the ' +
      'full source with `module.exports = { reverseString }`.',
    type: 'code',
    reward_credits: 15,
    tags: ['code', 'javascript', 'kata', 'easy'],
    verification: {
      mode: 'auto_tests',
      language: 'javascript',
      tests: [
        "const { reverseString } = require('./solution.js');",
        "const assert = require('assert');",
        "assert.equal(reverseString('abc'), 'cba');",
        "assert.equal(reverseString(''), '');",
        "assert.equal(reverseString('a'), 'a');",
        "console.log('ok');",
      ].join('\n'),
    },
  },
  {
    title: 'Implement sumArray(nums) in JavaScript',
    description:
      'Export `sumArray(nums)` returning the sum of an array of numbers (0 for an ' +
      'empty array). Submit full source with `module.exports = { sumArray }`.',
    type: 'code',
    reward_credits: 15,
    tags: ['code', 'javascript', 'kata', 'easy'],
    verification: {
      mode: 'auto_tests',
      language: 'javascript',
      tests: [
        "const { sumArray } = require('./solution.js');",
        "const assert = require('assert');",
        'assert.equal(sumArray([1, 2, 3]), 6);',
        'assert.equal(sumArray([]), 0);',
        'assert.equal(sumArray([-1, 1]), 0);',
        "console.log('ok');",
      ].join('\n'),
    },
  },
  {
    title: 'Implement factorial(n) in Python',
    description:
      'Define `factorial(n)` returning n! for n >= 0 (factorial(0) == 1). Submit ' +
      'the full source.',
    type: 'code',
    reward_credits: 20,
    tags: ['code', 'python', 'kata', 'easy'],
    verification: {
      mode: 'auto_tests',
      language: 'python',
      tests: [
        'from solution import factorial',
        'def test_base():',
        '    assert factorial(0) == 1',
        'def test_small():',
        '    assert factorial(5) == 120',
      ].join('\n'),
    },
  },
  {
    title: 'Implement gcd(a, b) in Python',
    description:
      'Define `gcd(a, b)` returning the greatest common divisor of two positive ' +
      'integers. Submit the full source.',
    type: 'code',
    reward_credits: 20,
    tags: ['code', 'python', 'kata', 'easy'],
    verification: {
      mode: 'auto_tests',
      language: 'python',
      tests: [
        'from solution import gcd',
        'def test_coprime():',
        '    assert gcd(7, 5) == 1',
        'def test_common():',
        '    assert gcd(12, 18) == 6',
        'def test_equal():',
        '    assert gcd(9, 9) == 9',
      ].join('\n'),
    },
  },
  {
    title: 'Implement capitalizeWords(s) in JavaScript',
    description:
      'Export `capitalizeWords(s)` that upper-cases the first letter of each ' +
      'space-separated word, leaving the rest unchanged. Submit full source with ' +
      '`module.exports = { capitalizeWords }`.',
    type: 'code',
    reward_credits: 20,
    tags: ['code', 'javascript', 'kata', 'easy'],
    verification: {
      mode: 'auto_tests',
      language: 'javascript',
      tests: [
        "const { capitalizeWords } = require('./solution.js');",
        "const assert = require('assert');",
        "assert.equal(capitalizeWords('hello world'), 'Hello World');",
        "assert.equal(capitalizeWords('a'), 'A');",
        "console.log('ok');",
      ].join('\n'),
    },
  },

  // ── medium ────────────────────────────────────────────────────────────────
  {
    title: 'Implement isPalindrome(s) in JavaScript',
    description:
      'Export a function `isPalindrome(s)` that returns true if the string is a ' +
      'palindrome (ignoring case and non-alphanumeric chars), false otherwise. ' +
      'Submit the full source defining `isPalindrome` and `module.exports = { isPalindrome }`.',
    type: 'code',
    reward_credits: 40,
    tags: ['code', 'javascript', 'kata', 'medium'],
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
    title: 'Implement flatten(arr) for arbitrarily nested arrays (Python)',
    description:
      'Define `flatten(arr)` that fully flattens an arbitrarily nested list of ' +
      'integers into a flat list, preserving order. Submit the full source.',
    type: 'code',
    reward_credits: 50,
    tags: ['code', 'python', 'kata', 'medium'],
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
    tags: ['code', 'python', 'kata', 'medium'],
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
  {
    title: 'Implement isPrime(n) in Python',
    description:
      'Define `isPrime(n)` returning True iff n is a prime number (n < 2 is not ' +
      'prime). Submit the full source.',
    type: 'code',
    reward_credits: 35,
    tags: ['code', 'python', 'kata', 'medium'],
    verification: {
      mode: 'auto_tests',
      language: 'python',
      tests: [
        'from solution import isPrime',
        'def test_small():',
        '    assert isPrime(2) is True',
        '    assert isPrime(1) is False',
        'def test_composite():',
        '    assert isPrime(9) is False',
        'def test_prime():',
        '    assert isPrime(97) is True',
      ].join('\n'),
    },
  },
  {
    title: 'Implement chunk(arr, size) in JavaScript',
    description:
      'Export `chunk(arr, size)` splitting an array into sub-arrays of length ' +
      '`size` (last chunk may be shorter). Submit full source with ' +
      '`module.exports = { chunk }`.',
    type: 'code',
    reward_credits: 40,
    tags: ['code', 'javascript', 'kata', 'medium'],
    verification: {
      mode: 'auto_tests',
      language: 'javascript',
      tests: [
        "const { chunk } = require('./solution.js');",
        "const assert = require('assert');",
        'assert.deepEqual(chunk([1,2,3,4,5], 2), [[1,2],[3,4],[5]]);',
        'assert.deepEqual(chunk([], 3), []);',
        "console.log('ok');",
      ].join('\n'),
    },
  },
  {
    title: 'Implement bubbleSort(nums) in Python',
    description:
      'Define `bubbleSort(nums)` returning a new ascending-sorted list (do not ' +
      'mutate the input). Submit the full source.',
    type: 'code',
    reward_credits: 45,
    tags: ['code', 'python', 'kata', 'medium'],
    verification: {
      mode: 'auto_tests',
      language: 'python',
      tests: [
        'from solution import bubbleSort',
        'def test_sorts():',
        '    assert bubbleSort([3, 1, 2]) == [1, 2, 3]',
        'def test_no_mutate():',
        '    src = [2, 1]',
        '    bubbleSort(src)',
        '    assert src == [2, 1]',
        'def test_empty():',
        '    assert bubbleSort([]) == []',
      ].join('\n'),
    },
  },

  // ── hard ──────────────────────────────────────────────────────────────────
  {
    title: 'Implement debounce(fn, ms) in JavaScript',
    description:
      'Export `debounce(fn, ms)` returning a debounced version of fn that delays ' +
      'invocation until `ms` after the last call. Submit full source with ' +
      '`module.exports = { debounce }`.',
    type: 'code',
    reward_credits: 60,
    tags: ['code', 'javascript', 'kata', 'hard'],
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
    title: 'Implement binarySearch(nums, target) in Python',
    description:
      'Define `binarySearch(nums, target)` returning the index of target in an ' +
      'ascending-sorted list, or -1 if absent. Must be O(log n). Submit full source.',
    type: 'code',
    reward_credits: 60,
    tags: ['code', 'python', 'kata', 'hard'],
    verification: {
      mode: 'auto_tests',
      language: 'python',
      tests: [
        'from solution import binarySearch',
        'def test_found():',
        '    assert binarySearch([1, 3, 5, 7, 9], 7) == 3',
        'def test_absent():',
        '    assert binarySearch([1, 3, 5], 4) == -1',
        'def test_empty():',
        '    assert binarySearch([], 1) == -1',
      ].join('\n'),
    },
  },
  {
    title: 'Implement mergeSort(nums) in Python',
    description:
      'Define `mergeSort(nums)` returning a new ascending-sorted list using merge ' +
      'sort. Submit the full source.',
    type: 'code',
    reward_credits: 70,
    tags: ['code', 'python', 'kata', 'hard'],
    verification: {
      mode: 'auto_tests',
      language: 'python',
      tests: [
        'from solution import mergeSort',
        'def test_sorts():',
        '    assert mergeSort([5, 2, 4, 1, 3]) == [1, 2, 3, 4, 5]',
        'def test_dups():',
        '    assert mergeSort([2, 2, 1]) == [1, 2, 2]',
        'def test_single():',
        '    assert mergeSort([9]) == [9]',
      ].join('\n'),
    },
  },
  {
    title: 'Implement an LRU cache class in JavaScript',
    description:
      'Export a class `LRUCache` constructed with a capacity, exposing get(key) ' +
      '(returns value or undefined) and put(key, value), evicting the least-' +
      'recently-used entry past capacity. get/put both count as use. Submit full ' +
      'source with `module.exports = { LRUCache }`.',
    type: 'code',
    reward_credits: 90,
    tags: ['code', 'javascript', 'kata', 'hard'],
    verification: {
      mode: 'auto_tests',
      language: 'javascript',
      tests: [
        "const { LRUCache } = require('./solution.js');",
        "const assert = require('assert');",
        'const c = new LRUCache(2);',
        'c.put(1, 1); c.put(2, 2);',
        'assert.equal(c.get(1), 1);',
        'c.put(3, 3);', // evicts key 2 (LRU)
        'assert.equal(c.get(2), undefined);',
        'assert.equal(c.get(3), 3);',
        "console.log('ok');",
      ].join('\n'),
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // data · auto_rules (deterministic checks)
  // ════════════════════════════════════════════════════════════════════════
  {
    title: 'Produce a valid SemVer regex (data)',
    description:
      'Submit a single JavaScript regular expression literal (e.g. /^.../ ) that ' +
      'matches a valid Semantic Version string like "1.2.3" or "10.0.1". Your ' +
      'submission must contain the substring "\\\\d" and start with a slash.',
    type: 'data',
    reward_credits: 25,
    tags: ['data', 'regex', 'easy'],
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
    title: 'Produce a regex that matches an email address (data)',
    description:
      'Submit a single JavaScript regex literal (starting with "/") that matches a ' +
      'basic email like "a@b.com". Must contain an "@" and a "\\\\." escape.',
    type: 'data',
    reward_credits: 20,
    tags: ['data', 'regex', 'easy'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'regex', value: '^/.*/.*$' },
        { type: 'contains', value: '@' },
        { type: 'contains', value: '\\.' },
      ],
    },
  },
  {
    title: 'Produce a regex for a 6-digit hex color (data)',
    description:
      'Submit a single JavaScript regex literal matching a hex color like ' +
      '"#1a2b3c". Must contain a "#" and the substring "a-f" (case range).',
    type: 'data',
    reward_credits: 18,
    tags: ['data', 'regex', 'easy'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'regex', value: '^/.*/.*$' },
        { type: 'contains', value: '#' },
        { type: 'contains', value: 'a-f' },
      ],
    },
  },
  {
    title: 'Write a CSV header line for a users export (data)',
    description:
      'Submit a single CSV header line for a users export containing exactly the ' +
      'columns id, email, created_at (comma-separated, in any order). The line ' +
      'must contain "id", "email", and "created_at".',
    type: 'data',
    reward_credits: 22,
    tags: ['data', 'csv', 'easy'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'contains', value: 'id' },
        { type: 'contains', value: 'email' },
        { type: 'contains', value: 'created_at' },
        { type: 'contains', value: ',' },
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
    tags: ['data', 'json', 'medium'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'contains', value: 'title' },
        { type: 'contains', value: 'tags' },
        { type: 'json_path_equals', value: 1979, path: 'year' },
      ],
    },
  },
  {
    title: 'Write a package.json scripts block (data)',
    description:
      'Submit a JSON object for a package.json "scripts" section containing at ' +
      'least "build", "test", and "start" keys. Also pass result_metadata with the ' +
      'parsed object; metadata field "test" must equal "node --test".',
    type: 'data',
    reward_credits: 35,
    tags: ['data', 'json', 'medium'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'contains', value: 'build' },
        { type: 'contains', value: 'start' },
        { type: 'json_path_equals', value: 'node --test', path: 'test' },
      ],
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // content · auto_rules (deterministic checks)
  // ════════════════════════════════════════════════════════════════════════
  {
    title: 'Write a conventional-commit message for a bugfix (content)',
    description:
      'Write a single conventional-commit subject line for fixing a null-pointer ' +
      'in the auth handler. Must start with "fix" and contain a ":" and the word ' +
      '"auth". Keep it under 72 chars.',
    type: 'content',
    reward_credits: 18,
    tags: ['content', 'git', 'easy'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'contains', value: 'fix' },
        { type: 'contains', value: ':' },
        { type: 'contains', value: 'auth' },
        { type: 'min_length', value: 15 },
      ],
    },
  },
  {
    title: 'Write a one-paragraph summary of what an API rate limiter does',
    description:
      'Write a clear, accurate one-paragraph (≥120 chars) explanation of an API ' +
      'rate limiter for a developer audience. It must contain the word "requests".',
    type: 'content',
    reward_credits: 35,
    tags: ['content', 'technical-writing', 'medium'],
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
    tags: ['content', 'testing', 'python', 'medium'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'contains', value: 'def test_' },
        { type: 'contains', value: 'assert' },
        { type: 'min_length', value: 60 },
      ],
    },
  },
  {
    title: 'Explain SQL injection and one mitigation (content)',
    description:
      'Write a ≥150-char paragraph explaining what SQL injection is and naming one ' +
      'concrete mitigation. Must contain the phrase "parameterized" and the word ' +
      '"query"; must not contain "Lorem ipsum".',
    type: 'content',
    reward_credits: 40,
    tags: ['content', 'security', 'technical-writing', 'medium'],
    verification: {
      mode: 'auto_rules',
      rules: [
        { type: 'min_length', value: 150 },
        { type: 'contains', value: 'parameterized' },
        { type: 'contains', value: 'query' },
        { type: 'not_contains', value: 'Lorem ipsum' },
      ],
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // auto_llm (rubric-graded; needs LLM_API_URL/KEY, else falls back to manual)
  // ════════════════════════════════════════════════════════════════════════
  {
    title: 'Summarize the CAP theorem in 3 sentences (content)',
    description:
      'Write a 3-sentence summary of the CAP theorem for a backend engineer: what ' +
      'C, A, and P stand for, and the core trade-off. Accurate and concise.',
    type: 'content',
    reward_credits: 45,
    tags: ['content', 'distributed-systems', 'medium', 'llm-graded'],
    verification: {
      mode: 'auto_llm',
      rubric:
        'Award up to 10 points: +4 if it correctly identifies Consistency, ' +
        'Availability, and Partition tolerance; +4 if it states the trade-off that ' +
        'under a network partition you must choose between consistency and ' +
        'availability; +2 if it is 3 sentences and free of factual errors. Score 0 ' +
        'if it is off-topic or describes something other than the CAP theorem.',
      pass_threshold: 6,
    },
  },
  {
    title: 'Explain recursion to a beginner with an example (content)',
    description:
      'Explain recursion to someone new to programming in one short paragraph, ' +
      'including one concrete example (e.g. factorial). Clear and correct.',
    type: 'content',
    reward_credits: 50,
    tags: ['content', 'teaching', 'medium', 'llm-graded'],
    verification: {
      mode: 'auto_llm',
      rubric:
        'Award up to 10 points: +4 if it correctly conveys that a function calls ' +
        'itself on a smaller subproblem; +3 if it mentions a base case (or stopping ' +
        'condition); +3 if it gives a correct concrete example. Score <=3 if the ' +
        'explanation is wrong or has no example.',
      pass_threshold: 6,
    },
  },
  {
    title: 'Write a clear PR description for an HSTS change (content)',
    description:
      'Write a pull-request description for enabling HSTS at the reverse proxy. It ' +
      'should state what changed, why (security), and call out the rollback/' +
      'irreversibility caveat. 2-4 short paragraphs or a bulleted summary.',
    type: 'content',
    reward_credits: 60,
    tags: ['content', 'technical-writing', 'security', 'hard', 'llm-graded'],
    verification: {
      mode: 'auto_llm',
      rubric:
        'Award up to 10 points: +3 states WHAT changed (enabling HSTS / Strict-' +
        'Transport-Security); +3 states WHY (forces HTTPS, prevents downgrade/MITM); ' +
        '+3 notes the risk/rollback caveat (HSTS is sticky for max-age; hard to undo); ' +
        '+1 is well-organized and concise. Score <=3 if it is generic and does not ' +
        'mention HSTS specifics.',
      pass_threshold: 6,
    },
  },
];
