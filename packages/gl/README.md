# @elementalfx/gl

A small WebGL2 toolkit used by [elementalfx](https://github.com/avinashiyer4292/elementalfx) effects.

- `getWebGL2(canvas)`, `isWebGL2Supported()`, `watchContextLoss(canvas, onLost, onRestored)`
- `createProgram(gl, vertex, fragment, defines)` with uniform lookup, `FULLSCREEN_VERTEX`, `createFullscreenDraw(gl)`
- `simulationFormat(gl)`: picks RGBA32F, RGBA16F or packed RGBA8, verifying each with a real framebuffer
- `RenderTarget`, `PingPong`: textures with framebuffers for simulation passes
- `PACKING_GLSL`: encode/decode signed values in two 8-bit channels for devices without float render targets
- `createTexture`, `uploadTexture`, `loadImage`, `sourceSize`, `isSourceReady`

MIT License
