import { execFileSync } from 'node:child_process';

// Inspect staged paths and contents, including force-added ignored files.
const privatePaths = [
  /(^|\/)\.claude\//i,
  /(^|\/)(?:AGENTS|CLAUDE|GEMINI|CODEX)\.md$/i,
  /(^|\/)\.(?:codex|continue|playwright-mcp|aws)(?:\/|$)/i,
  /(^|\/)(?:\.claude\.json|CLAUDE\.local\.md|\.aider[^/]*)(?:\/|$)/i,
  /(^|\/)(?:\.(?:cursor|vscode)\/mcp\.json|\.mcp(?:\.local)?\.json)$/i,
  /(^|\/)\.env(?:\.(?!example$)[^/]*)?$/i,
  /(^|\/)(?:[^/]*\.)?cookies(?:\.txt)?$/i,
  /\.(?:pem|key|p12|pfx)$/i,
];

const entries = execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .map((row) => {
    const tab = row.indexOf('\t');
    const [mode, object] = row.slice(0, tab).split(' ');
    return { mode, object, path: row.slice(tab + 1) };
  });
const tracked = entries.map((entry) => entry.path);
const blocked = tracked.filter((path) => privatePaths.some((pattern) => pattern.test(path)));

const blobs = entries.filter((entry) => entry.mode === '100644' || entry.mode === '100755');
const contents = execFileSync('git', ['cat-file', '--batch'], {
  input: blobs.map((entry) => entry.object).join('\n') + '\n',
  maxBuffer: 256 * 1024 * 1024,
});
let offset = 0;
const credentialPaths = [];
for (const entry of blobs) {
  const end = contents.indexOf(10, offset);
  const size = Number(contents.subarray(offset, end).toString().split(' ')[2]);
  const data = contents.subarray(end + 1, end + 1 + size);
  offset = end + 1 + size + 1;
  if (data.subarray(0, 8192).includes(0)) continue;
  const text = data.toString();
  const urls = text.matchAll(
    /(?:postgres(?:ql)?|rediss?|mysql|mongodb(?:\+srv)?|https?):\/\/([^/\s"'<>@]{1,512})@([^/\s"'<>]{1,512})/gi
  );
  for (const [, userinfo, authority] of urls) {
    if (!userinfo.includes(':') || userinfo.includes('${')) continue;
    const host = authority.replace(/:\d+$/, '').toLowerCase();
    const example =
      !host.includes('.') ||
      host === '127.0.0.1' ||
      host.includes('xxxxx') ||
      /(?:^|\.)example\.(?:com|org|net)$/.test(host) ||
      /\.(?:example|test|invalid|localhost)$/.test(host);
    if (!example) {
      credentialPaths.push(entry.path);
      break;
    }
  }
}

if (blocked.length > 0 || credentialPaths.length > 0) {
  console.error('Private workstation/authentication artifacts must not be tracked:');
  for (const path of blocked) console.error(`  ${JSON.stringify(path)}`);
  for (const path of credentialPaths) {
    console.error(`  ${JSON.stringify(path)} contains a hardcoded remote URL credential`);
  }
  console.error('Remove these paths from the index and keep sanitized examples separately.');
  process.exitCode = 1;
} else {
  console.log('No prohibited private artifact paths are tracked.');
}
