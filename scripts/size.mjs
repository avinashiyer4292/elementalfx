// Checks gzipped sizes of each package's <script> bundle against its budget
// (package.json "elementalfx.sizeLimit", in bytes). Exits 1 when over budget.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;
const rows = [];

for (const name of readdirSync(join(root, 'packages'))) {
  const dir = join(root, 'packages', name);
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const limit = manifest.elementalfx?.sizeLimit;
  const file = join(dir, 'dist', `${name}.global.js`);
  if (!limit) continue;
  if (!existsSync(file)) {
    console.error(`${manifest.name}: ${file} is missing, run the build first`);
    failed = true;
    continue;
  }
  const size = gzipSync(readFileSync(file), { level: 9 }).length;
  const ok = size <= limit;
  failed ||= !ok;
  rows.push([manifest.name, `${(size / 1024).toFixed(2)} KB`, `${(limit / 1024).toFixed(2)} KB`, ok ? 'ok' : 'OVER']);
}

const widths = [0, 1, 2, 3].map((i) => Math.max(...rows.map((r) => r[i].length), 8));
console.log(['package', 'gzip', 'budget', ''].map((h, i) => h.padEnd(widths[i])).join('  '));
for (const row of rows) console.log(row.map((cell, i) => cell.padEnd(widths[i])).join('  '));
if (failed) process.exit(1);
