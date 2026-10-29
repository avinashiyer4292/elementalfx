# elementalfx

Natural-element effects for the web: water, air, fire and earth. Each effect is a small, dependency-free package that works with plain HTML, any framework, or a `<script>` tag.

| Package | What it does | Status |
| --- | --- | --- |
| [`@elementalfx/ripples`](packages/ripples) | WebGL water ripples on images, video and CSS backgrounds; a modern replacement for jquery.ripples | ready |
| [`@elementalfx/weather`](packages/weather) | Rain, snow, fog, lightning, leaves and embers driven by one shared wind field; snow settles on your elements | ready |
| [`@elementalfx/fluid`](packages/fluid) | Smoke and ink fluid simulation for cursor trails, living backgrounds and splashes | ready |
| [`@elementalfx/gravity`](packages/gravity) | Page elements fall, collide and get thrown around, then fly back into place | ready |
| `@elementalfx/dissolve` | Elements disintegrate, burn or melt away, or assemble in reverse | planned |
| [`@elementalfx/core`](packages/core), [`@elementalfx/gl`](packages/gl) | Shared runtime and WebGL toolkit used by the effects | ready |

## Quick start

```sh
npm install @elementalfx/ripples
```

```js
import { createRipples } from '@elementalfx/ripples';

const ripples = createRipples('.hero', { preset: 'pond' });
```

Or with no build step:

```html
<script src="https://unpkg.com/@elementalfx/ripples/dist/ripples.global.js"></script>
<fx-ripples preset="rain">
  <img src="lake.jpg" alt="A lake at dusk" />
</fx-ripples>
```

## What every effect guarantees

- **Respects `prefers-reduced-motion`.** Effects stay off (or static) for people who ask for less motion, and react if the setting changes.
- **Costs nothing when idle.** One shared animation loop for the whole page; effects stop scheduling frames when offscreen, in a hidden tab, or settled.
- **Safe for server rendering.** Importing never touches `window` or `document`.
- **Leaves no trace.** `destroy()` removes every canvas, listener and GPU resource and restores inline styles exactly.
- **Recovers from WebGL context loss**, and falls back to 8-bit simulation on GPUs that can't render to float textures.

## Repository layout

```text
packages/
  core/       frame loop, effect runtime, custom-element helper, noise, wind field
  gl/         WebGL2 helpers: programs, render targets, textures
  ripples/    @elementalfx/ripples
  weather/    @elementalfx/weather
  fluid/      @elementalfx/fluid
scripts/      build, size budget, release and rename scripts
tests/        Playwright browser tests and an SSR import test
```

## Development

Requires Node 20+ and pnpm 10.

```sh
pnpm install
pnpm build          # ESM + types + <script> bundles for every package
pnpm typecheck
pnpm test           # browser tests (run `pnpm exec playwright install chromium` once)
pnpm test:node      # headless tests: SSR-safe imports, physics engine
pnpm size           # gzipped size budgets
node scripts/serve.mjs   # static server on http://localhost:4173 for the demos
```

Commit `pnpm-lock.yaml` after the first `pnpm install`, then switch CI to `--frozen-lockfile`.

## Releasing

Versioning uses [Changesets](https://github.com/changesets/changesets): add one with `pnpm changeset` in each pull request that changes a package.

Publishing uses npm [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token lives in this repo. One-time setup:

1. Create the `elementalfx` organization on npmjs.com.
2. Publish the first versions from your machine: `npm login`, then `pnpm release`. npm needs a package to exist before it can trust a workflow for it.
3. For each package on npmjs.com, open Settings → Trusted publishing and add this repository with workflow `release.yml`.
4. In this GitHub repository, add the variable `NPM_PUBLISH` = `true` (Settings → Secrets and variables → Actions → Variables).

From then on, merging the "Version Packages" pull request publishes to npm with provenance.

If the `elementalfx` scope is taken, `node scripts/rename.mjs <new-scope> <NewGlobalName>` renames everything.

## License

[MIT](LICENSE)
