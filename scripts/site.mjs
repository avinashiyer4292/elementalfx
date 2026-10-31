// Builds the demo site into _site/: the files in site/ plus each effect's
// <script> bundle in _site/lib/. Run `pnpm build` first.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
const effects = ['ripples', 'weather', 'fluid', 'gravity', 'dissolve'];

rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'site'), out, { recursive: true });
mkdirSync(join(out, 'lib'), { recursive: true });
for (const name of effects) {
  const bundle = join(root, 'packages', name, 'dist', `${name}.global.js`);
  if (!existsSync(bundle)) throw new Error(`Missing ${bundle}. Run pnpm build first.`);
  cpSync(bundle, join(out, 'lib', `${name}.global.js`));
}
console.log(`site built in ${out}`);
