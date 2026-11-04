import { execFileSync } from 'node:child_process';

// Check the index, including force-added ignored files. Shared project instructions
// and reusable Claude commands are allowed; personal state and permissions are not.
const privatePaths = [
  /(^|\/)\.claude\/(?!commands\/)/i,
  /(^|\/)\.(?:codex|continue|playwright-mcp|aws)(?:\/|$)/i,
  /(^|\/)(?:\.claude\.json|CLAUDE\.local\.md|\.aider[^/]*)(?:\/|$)/i,
  /(^|\/)(?:\.(?:cursor|vscode)\/mcp\.json|\.mcp(?:\.local)?\.json)$/i,
  /(^|\/)\.env(?:\.(?!example$)[^/]*)?$/i,
  /(^|\/)(?:[^/]*\.)?cookies(?:\.txt)?$/i,
  /\.(?:pem|key|p12|pfx)$/i,
];

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const blocked = tracked.filter((path) => privatePaths.some((pattern) => pattern.test(path)));

if (blocked.length > 0) {
  console.error('Private workstation/authentication artifacts must not be tracked:');
  for (const path of blocked) console.error(`  ${JSON.stringify(path)}`);
  console.error('Remove these paths from the index and keep sanitized examples separately.');
  process.exitCode = 1;
} else {
  console.log('No prohibited private artifact paths are tracked.');
}
