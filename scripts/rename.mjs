// Renames the project if the npm scope isn't available:
//   node scripts/rename.mjs <new-scope> [new-global-name]
// e.g. `node scripts/rename.mjs wavekit WaveKit` turns @elementalfx/ripples into
// @wavekit/ripples and window.ElementalFX into window.WaveKit.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [scope, globalName] = process.argv.slice(2);
if (!scope || !/^[a-z0-9][a-z0-9-._]*$/.test(scope)) {
  console.error('usage: node scripts/rename.mjs <new-scope> [NewGlobalName]');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', 'dist', '.git', '.site', 'test-results']);
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.html', '.yml', '.yaml']);
let changed = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (extensions.has(extname(path))) rewrite(path);
  }
}

function rewrite(path) {
  const before = readFileSync(path, 'utf8');
  let after = before.replaceAll('@elementalfx/', `@${scope}/`).replaceAll('elementalfx', scope);
  if (globalName) after = after.replaceAll('ElementalFX', globalName);
  if (after !== before) {
    writeFileSync(path, after);
    changed++;
  }
}

walk(root);
console.log(`updated ${changed} files. Rename the GitHub repo too, then update the git remote.`);
