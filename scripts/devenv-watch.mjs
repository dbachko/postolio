#!/usr/bin/env node
// Live one-way sync from this checkout into the dev environment for hot reload.
//
// Shared mounts from the Mac into Linux (OrbStack's /Users mount, Docker bind
// mounts) can miss file-change events or serve stale contents right after a save,
// so dev servers can't reliably watch the Mac checkout. Instead we watch on the
// Mac (FSEvents via fs.watch) and stream each changed file onto the environment's
// own filesystem, where Vite HMR and `tsx watch` see native file events.
//
// Started by `scripts/devenv.sh watch`. Expects ROOT_DIR, DEST, DEVENV_LABEL and
// DEVENV_EXEC: the command prefix that runs a command inside the environment,
// one argument per line (e.g. "orb\n-m\npostolio" or "docker\nexec\n-i\n...").

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, watch } from 'node:fs';
import path from 'node:path';

const { DEVENV_EXEC, DEVENV_LABEL, ROOT_DIR, DEST } = process.env;
if (!DEVENV_EXEC || !ROOT_DIR || !DEST) {
  console.error('devenv-watch: DEVENV_EXEC, ROOT_DIR and DEST must be set');
  process.exit(1);
}
const [EXEC_CMD, ...EXEC_ARGS] = DEVENV_EXEC.split('\n').filter(Boolean);
const LABEL = DEVENV_LABEL || 'dev environment';

const DEBOUNCE_MS = 150;
const ALWAYS_SKIP = /(^|\/)(\.git|node_modules|dist|\.turbo|\.playwright-mcp)(\/|$)/;
// Editor and sed scratch files (vim .swp/4913, sed -i ".!123!name", backups "name~").
const SCRATCH = /(^|\/)(\.![0-9]+!|4913$)|\.sw[a-p]$|~$/;

const pending = new Set();
let timer = null;
let running = false;

function run(cmd, args, input) {
  const res = spawnSync(cmd, args, { input, encoding: 'utf8', cwd: ROOT_DIR });
  if (res.status !== 0) {
    const msg = (res.stderr || res.stdout || '').trim();
    throw new Error(`${cmd} ${args[0] ?? ''} failed${msg ? `: ${msg}` : ''}`);
  }
  return res.stdout;
}

// Read the files on the Mac and stream them into the environment as a tar archive.
// Reading them through a shared mount from inside the environment is not safe
// here: right after a save the mount can still serve the old contents.
function copyIntoEnv(files) {
  const archive = spawnSync('tar', ['--no-mac-metadata', '--no-xattrs', '-cf', '-', '-T', '-'], {
    cwd: ROOT_DIR,
    input: files.join('\n') + '\n',
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (archive.status !== 0) {
    throw new Error(`tar failed: ${archive.stderr.toString().trim()}`);
  }
  const extract = spawnSync(
    EXEC_CMD,
    [...EXEC_ARGS, 'tar', '-xf', '-', '-C', DEST, '--warning=no-unknown-keyword'],
    { input: archive.stdout, maxBuffer: 16 * 1024 * 1024 }
  );
  if (extract.status !== 0) {
    throw new Error(`extract failed: ${extract.stderr.toString().trim()}`);
  }
}

// Keep only paths git would sync (tracked or untracked, not ignored).
function notIgnored(paths) {
  if (paths.length === 0) return [];
  const res = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    input: paths.join('\n') + '\n',
    encoding: 'utf8',
    cwd: ROOT_DIR,
  });
  const ignored = new Set(res.stdout.split('\n').filter(Boolean));
  return paths.filter((p) => !ignored.has(p));
}

// A directory event (e.g. a folder moved in) expands to the files inside it.
function expand(rel) {
  const abs = path.join(ROOT_DIR, rel);
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    const out = run('git', ['ls-files', '-co', '--exclude-standard', '--', rel]);
    return out.split('\n').filter(Boolean);
  }
  return [rel];
}

function flush() {
  timer = null;
  if (running) {
    timer = setTimeout(flush, DEBOUNCE_MS);
    return;
  }
  const batch = [...pending];
  pending.clear();
  if (batch.length === 0) return;
  running = true;
  try {
    const candidates = notIgnored([...new Set(batch.flatMap(expand))]);
    const present = candidates.filter((p) => existsSync(path.join(ROOT_DIR, p)));
    const gone = candidates.filter((p) => !existsSync(path.join(ROOT_DIR, p)));

    if (present.length) {
      copyIntoEnv(present);
    }
    if (gone.length) {
      // Paths are repo-relative and validated in onEvent; remove them under DEST only.
      run(
        EXEC_CMD,
        [...EXEC_ARGS, 'bash', '-c', 'cd "$1" && xargs -r -d "\\n" rm -rf --', 'rm', DEST],
        gone.join('\n') + '\n'
      );
    }
    const stamp = new Date().toLocaleTimeString();
    for (const p of present) console.log(`[${stamp}] synced  ${p}`);
    for (const p of gone) console.log(`[${stamp}] removed ${p}`);
  } catch (err) {
    console.error(`[devenv-watch] ${err.message}`);
    // Retry the batch with the next change or a short delay.
    for (const p of batch) pending.add(p);
    timer = setTimeout(flush, 2000);
  } finally {
    running = false;
  }
}

function onEvent(_type, filename) {
  if (!filename) return;
  const rel = path.normalize(filename.toString());
  if (
    rel.startsWith('..') ||
    path.isAbsolute(rel) ||
    rel === '.' ||
    ALWAYS_SKIP.test(rel) ||
    SCRATCH.test(rel)
  )
    return;
  pending.add(rel);
  if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
}

watch(ROOT_DIR, { recursive: true }, onEvent);
console.log(`Watching ${ROOT_DIR} -> ${LABEL}:${DEST} (Ctrl+C to stop)`);

// Exit cleanly when the parent shell is interrupted.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
