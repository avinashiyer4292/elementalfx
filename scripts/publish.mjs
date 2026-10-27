// Publishes every package whose version isn't on npm yet.
//
// `pnpm pack` rewrites workspace:^ ranges to real versions, then `npm publish`
// uploads the tarball. Run from GitHub Actions with `id-token: write` and npm
// 11.5.1 or later, npm uses trusted publishing (OIDC): no token is stored and
// provenance is attached automatically.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const order = ['core', 'gl', 'ripples', 'weather', 'fluid', 'gravity', 'dissolve', 'react'];
const out = mkdtempSync(join(tmpdir(), 'elementalfx-'));
const dryRun = process.argv.includes('--dry-run');

for (const name of order) {
  const dir = join(root, 'packages', name);
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.private) continue;
  const id = `${manifest.name}@${manifest.version}`;
  if (isPublished(id)) {
    console.log(`skip ${id} (already on npm)`);
    continue;
  }
  execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: dir, stdio: 'inherit' });
  const tarball = readdirSync(out).find((file) =>
    file.startsWith(`${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}`),
  );
  if (!tarball) throw new Error(`pack produced no tarball for ${id}`);
  const tag = manifest.version.includes('-') ? 'next' : 'latest';
  const args = ['publish', join(out, tarball), '--access', 'public', '--tag', tag];
  if (dryRun) args.push('--dry-run');
  console.log(`publish ${id} (${tag})`);
  execFileSync('npm', args, { stdio: 'inherit' });
}

function isPublished(id) {
  try {
    execFileSync('npm', ['view', id, 'version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}
