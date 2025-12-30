#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const componentsRoot = path.join(__dirname, '../src/components');
const uiRoot = path.join(componentsRoot, 'ui');

function isUnder(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function walkDirectories(rootDir, onDir) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    if (!dir) continue;
    if (isUnder(uiRoot, dir)) continue;
    onDir(dir);

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      stack.push(path.join(dir, entry.name));
    }
  }
}

const violations = [];

walkDirectories(componentsRoot, (dir) => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const fileNames = entries.filter((e) => e.isFile()).map((e) => e.name);
  if (!fileNames.includes('index.tsx')) return;

  const extraTsx = fileNames.filter((name) => name.endsWith('.tsx') && name !== 'index.tsx');
  if (extraTsx.length === 0) return;

  violations.push({
    dir: path.relative(componentsRoot, dir) || '.',
    extraTsx: extraTsx.sort(),
  });
});

if (violations.length) {
  console.error('Component module structure violations found:\n');
  for (const v of violations) {
    console.error(`- src/components/${v.dir}: move these to a subfolder (e.g. components/*):`);
    for (const f of v.extraTsx) console.error(`  - ${f}`);
  }
  console.error(
    '\nRule: if a directory has src/components/**/index.tsx, it must not contain any other *.tsx at the same level.'
  );
  process.exit(1);
}

console.log('Component module structure OK.');
