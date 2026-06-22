#!/usr/bin/env node
// Copy the canonical agent-worker skill into the Claude Code plugin.
// Source of truth: skills/agent-worker/SKILL.md
import { mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(repoRoot, 'skills', 'agent-worker', 'SKILL.md');
const destDir = join(repoRoot, 'plugin', 'skills', 'agent-worker');
const dest = join(destDir, 'SKILL.md');

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);

// Verify byte-identical
const a = readFileSync(src);
const b = readFileSync(dest);
if (!a.equals(b)) {
  console.error('sync-skill: copy mismatch');
  process.exit(1);
}
console.log(`sync-skill: ${src} -> ${dest} (${a.length} bytes)`);
