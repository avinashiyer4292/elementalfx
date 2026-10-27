# @elementalfx/core

Shared runtime for [elementalfx](https://github.com/avinashiyer4292/elementalfx) effects. You only need it directly when writing your own effect.

- `onFrame(callback)`: one `requestAnimationFrame` loop shared by every effect on the page.
- `EffectRuntime`: runs frames only while an effect is playing, on screen, not settled, and motion is allowed (`prefers-reduced-motion`).
- `defineEffectElement(tag, spec)`: turns an effect factory into a custom element whose attributes map to options.
- `WindField`: a 2D wind field (base wind, gusts, curl-noise swirl, pointer pushes) that several effects can share.
- `noise3`, `createRandom`, `clamp`, `pixelRatio`, `isBrowser`.

All exports are safe to import during server rendering.

MIT License
