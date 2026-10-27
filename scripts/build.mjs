// Builds every package in dependency order:
//   dist/*.js         ESM, one file per export, workspace deps left external
//   dist/*.d.ts       type declarations from tsc
//   dist/<n>.global.js  minified IIFE for <script> tags, everything bundled
//
// Usage: node scripts/build.mjs [package ...]
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const order = ['core', 'gl', 'ripples', 'weather', 'fluid', 'gravity', 'dissolve', 'react'];
const only = process.argv.slice(2);
const tsc = require.resolve('typescript/bin/tsc');

for (const name of order) {
  if (only.length && !only.includes(name)) continue;
  const dir = join(root, 'packages', name);
  const manifestPath = join(dir, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const started = performance.now();
  rmSync(join(dir, 'dist'), { recursive: true, force: true });

  const entryPoints = esmEntries(dir, manifest);
  const external = [
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    'react/jsx-runtime',
  ];

  await build({
    entryPoints,
    outdir: join(dir, 'dist'),
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    sourcemap: true,
    external,
    jsx: 'automatic',
    chunkNames: 'chunks/[name]-[hash]',
    logLevel: 'warning',
  });

  const global = manifest.elementalfx?.global;
  if (global) {
    await build({
      entryPoints: [join(dir, manifest.elementalfx.globalEntry ?? 'src/index.ts')],
      outfile: join(dir, 'dist', `${name}.global.js`),
      bundle: true,
      minify: true,
      format: 'iife',
      globalName: `ElementalFX.${global}`,
      platform: 'browser',
      target: 'es2020',
      legalComments: 'none',
      banner: { js: `/*! ${manifest.name} v${manifest.version} | MIT */` },
      logLevel: 'warning',
    });
  }

  execFileSync(process.execPath, [tsc, '-p', join(dir, 'tsconfig.json')], { stdio: 'inherit', cwd: root });
  console.log(`built ${manifest.name} in ${Math.round(performance.now() - started)} ms`);
}

/** Maps each `exports` entry (./dist/x.js) back to its source file (src/x.ts or .tsx). */
function esmEntries(dir, manifest) {
  const entries = new Set();
  for (const value of Object.values(manifest.exports ?? {})) {
    const target = typeof value === 'string' ? value : value.import;
    if (!target || !target.startsWith('./dist/') || target.endsWith('.global.js')) continue;
    const base = target.slice('./dist/'.length).replace(/\.js$/, '');
    const candidates = [`src/${base}.ts`, `src/${base}.tsx`].map((file) => join(dir, file));
    const found = candidates.find((file) => existsSync(file));
    if (!found) throw new Error(`${manifest.name}: no source for export ${target}`);
    entries.add(found);
  }
  return [...entries];
}
