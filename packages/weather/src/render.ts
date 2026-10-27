import { FULLSCREEN_VERTEX, createProgram, getWebGL2, type Program } from '@elementalfx/gl';
import { Kind, SPRITE_STRIDE, type SpriteBatch } from './particles';
import type { Surfaces } from './surfaces';

export interface FogFrame {
  density: number;
  color: [number, number, number];
  height: number;
  offsetA: [number, number];
  offsetB: [number, number];
  pointer: [number, number];
  pointerRadius: number;
}

/** Everything drawn in one frame, in CSS px. */
export interface FrameData {
  width: number;
  height: number;
  normal: SpriteBatch;
  additive: SpriteBatch;
  caps: { data: Float32Array };
  capVertices: number;
  surfaces: Surfaces;
  bolts: number[];
  fog: FogFrame | null;
  flash: number;
  flashColor: [number, number, number];
}

export interface Renderer {
  readonly kind: 'webgl2' | 'canvas2d';
  resize(width: number, height: number, pixelRatio: number): void;
  render(frame: FrameData): void;
  destroy(): void;
}

const SPRITE_VERTEX = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec2 aPos;
layout(location = 2) in vec2 aSize;
layout(location = 3) in float aAngle;
layout(location = 4) in float aAlpha;
layout(location = 5) in float aKind;
layout(location = 6) in vec3 aColor;
uniform vec2 uResolution;
out vec2 vLocal;
out float vAlpha;
out vec3 vColor;
flat out int vKind;
void main() {
  vec2 p = aCorner * aSize;
  float c = cos(aAngle);
  float s = sin(aAngle);
  vec2 world = aPos + vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec2 clip = world / uResolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vLocal = aCorner * 2.0;
  vAlpha = aAlpha;
  vColor = aColor;
  vKind = int(aKind + 0.5);
}`;

const SPRITE_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 vLocal;
in float vAlpha;
in vec3 vColor;
flat in int vKind;
out vec4 outColor;
void main() {
  vec2 p = vLocal;
  vec3 color = vColor;
  float a;
  if (vKind == ${Kind.Snow}) {
    a = smoothstep(1.0, 0.3, length(p));
  } else if (vKind == ${Kind.Rain}) {
    float across = 1.0 - smoothstep(0.15, 1.0, abs(p.x));
    float along = smoothstep(-1.0, 0.6, p.y) * (1.0 - smoothstep(0.85, 1.0, p.y));
    a = across * along;
  } else if (vKind == ${Kind.Leaf}) {
    // Leaf: the overlap of two circles, with a midrib and a short stem.
    float d = max(length(p - vec2(0.0, -0.45)), length(p - vec2(0.0, 0.45))) - 1.097;
    float stem = step(0.85, p.x) * step(p.x, 1.0) * step(abs(p.y), 0.06);
    a = max(1.0 - smoothstep(-0.05, 0.03, d), stem);
    float rib = (1.0 - smoothstep(0.0, 0.07, abs(p.y))) * step(abs(p.x), 0.85);
    color *= 1.0 - rib * 0.35 + p.y * 0.12;
  } else if (vKind == ${Kind.Ember}) {
    float d2 = dot(p, p);
    a = exp(-d2 * 9.0) + 0.3 * exp(-d2 * 2.5);
    color = mix(color, vec3(1.0, 0.96, 0.85), exp(-d2 * 24.0));
  } else if (vKind == ${Kind.Splash}) {
    a = smoothstep(1.0, 0.45, length(p));
  } else {
    float x2 = p.x * p.x;
    a = exp(-x2 * 70.0) + 0.28 * exp(-x2 * 5.0);
    color = mix(color, vec3(1.0), exp(-x2 * 140.0));
  }
  float alpha = clamp(a, 0.0, 1.0) * vAlpha;
  outColor = vec4(color * alpha, alpha);
}`;

const CAP_VERTEX = `#version 300 es
layout(location = 0) in vec3 aPoint;
uniform vec2 uResolution;
out float vAlpha;
void main() {
  vec2 clip = aPoint.xy / uResolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vAlpha = aPoint.z;
}`;

const CAP_FRAGMENT = `#version 300 es
precision mediump float;
in float vAlpha;
out vec4 outColor;
void main() {
  float a = vAlpha * 0.97;
  outColor = vec4(vec3(0.98, 0.99, 1.0) * a, a);
}`;

const FOG_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uResolution;
uniform vec2 uOffsetA;
uniform vec2 uOffsetB;
uniform vec3 uColor;
uniform float uDensity;
uniform float uHeight;
uniform vec2 uPointer;
uniform float uPointerRadius;
out vec4 outColor;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * noise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    amplitude *= 0.5;
  }
  return value;
}
void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uResolution;
  float far = fbm((px + uOffsetA) / 420.0);
  float near = fbm((px + uOffsetB) / 230.0 + 3.7);
  float fog = smoothstep(0.32, 0.82, far * 0.6 + near * 0.4);
  float y = 1.0 - vUv.y;
  float band = smoothstep(1.0 - uHeight, min(1.0, 1.0 - uHeight + 0.3), y);
  if (uPointerRadius > 0.0) fog *= mix(0.2, 1.0, smoothstep(uPointerRadius * 0.3, uPointerRadius, distance(px, uPointer)));
  float a = fog * band * uDensity * 0.75;
  outColor = vec4(uColor * a, a);
}`;

const FILL_FRAGMENT = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = vec4(uColor.rgb * uColor.a, uColor.a); }`;

/** Instanced WebGL2 renderer: one draw call per blend mode. */
export class GLRenderer implements Renderer {
  readonly kind = 'webgl2' as const;
  private sprite: Program;
  private cap: Program;
  private fog: Program;
  private fill: Program;
  private spriteVao: WebGLVertexArrayObject;
  private capVao: WebGLVertexArrayObject;
  private emptyVao: WebGLVertexArrayObject;
  private instanceBuffer: WebGLBuffer;
  private capBuffer: WebGLBuffer;
  private cornerBuffer: WebGLBuffer;
  private width = 1;
  private height = 1;

  static create(canvas: HTMLCanvasElement): GLRenderer | null {
    const gl = getWebGL2(canvas, { powerPreference: 'low-power' });
    if (!gl) return null;
    try {
      return new GLRenderer(gl);
    } catch (error) {
      console.warn('[elementalfx] weather: WebGL setup failed, using Canvas 2D.', error);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return null;
    }
  }

  private constructor(private readonly gl: WebGL2RenderingContext) {
    this.sprite = createProgram(gl, SPRITE_VERTEX, SPRITE_FRAGMENT);
    this.cap = createProgram(gl, CAP_VERTEX, CAP_FRAGMENT);
    this.fog = createProgram(gl, FULLSCREEN_VERTEX, FOG_FRAGMENT);
    this.fill = createProgram(gl, FULLSCREEN_VERTEX, FILL_FRAGMENT);

    this.cornerBuffer = gl.createBuffer()!;
    this.instanceBuffer = gl.createBuffer()!;
    this.capBuffer = gl.createBuffer()!;

    this.spriteVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const stride = SPRITE_STRIDE * 4;
    const attribute = (location: number, size: number, offset: number): void => {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4);
      gl.vertexAttribDivisor(location, 1);
    };
    attribute(1, 2, 0);
    attribute(2, 2, 2);
    attribute(3, 1, 4);
    attribute(4, 1, 5);
    attribute(5, 1, 6);
    attribute(6, 3, 7);

    this.capVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.capVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.capBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);

    this.emptyVao = gl.createVertexArray()!;
    gl.bindVertexArray(null);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.width = width;
    this.height = height;
    const canvas = this.gl.canvas as HTMLCanvasElement;
    canvas.width = Math.max(1, Math.round(width * pixelRatio));
    canvas.height = Math.max(1, Math.round(height * pixelRatio));
  }

  render(frame: FrameData): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    if (frame.fog && frame.fog.density > 0) {
      const f = frame.fog;
      const u = this.fog.uniforms;
      this.fog.use();
      gl.uniform2f(u.uResolution!, this.width, this.height);
      gl.uniform2f(u.uOffsetA!, f.offsetA[0], f.offsetA[1]);
      gl.uniform2f(u.uOffsetB!, f.offsetB[0], f.offsetB[1]);
      gl.uniform3f(u.uColor!, f.color[0], f.color[1], f.color[2]);
      gl.uniform1f(u.uDensity!, f.density);
      gl.uniform1f(u.uHeight!, f.height);
      gl.uniform2f(u.uPointer!, f.pointer[0], f.pointer[1]);
      gl.uniform1f(u.uPointerRadius!, f.pointerRadius);
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    if (frame.capVertices > 0) {
      this.cap.use();
      gl.uniform2f(this.cap.uniforms.uResolution!, this.width, this.height);
      gl.bindVertexArray(this.capVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.capBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, frame.caps.data.subarray(0, frame.capVertices * 3), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, frame.capVertices);
    }

    this.drawSprites(frame.normal);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.drawSprites(frame.additive);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    if (frame.flash > 0.002) {
      this.fill.use();
      const [r, g, b] = frame.flashColor;
      gl.uniform4f(this.fill.uniforms.uColor!, r, g, b, Math.min(1, frame.flash));
      gl.bindVertexArray(this.emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
  }

  private drawSprites(batch: SpriteBatch): void {
    if (batch.count === 0) return;
    const gl = this.gl;
    this.sprite.use();
    gl.uniform2f(this.sprite.uniforms.uResolution!, this.width, this.height);
    gl.bindVertexArray(this.spriteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.count * SPRITE_STRIDE), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, batch.count);
  }

  destroy(): void {
    const gl = this.gl;
    if (!gl.isContextLost()) {
      this.sprite.delete();
      this.cap.delete();
      this.fog.delete();
      this.fill.delete();
      gl.deleteBuffer(this.cornerBuffer);
      gl.deleteBuffer(this.instanceBuffer);
      gl.deleteBuffer(this.capBuffer);
      gl.deleteVertexArray(this.spriteVao);
      gl.deleteVertexArray(this.capVao);
      gl.deleteVertexArray(this.emptyVao);
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Canvas 2D fallback for browsers without WebGL2. Draws everything except fog. */
export class CanvasRenderer implements Renderer {
  readonly kind = 'canvas2d' as const;
  private ctx: CanvasRenderingContext2D;
  private ratio = 1;

  static create(canvas: HTMLCanvasElement): CanvasRenderer | null {
    const ctx = canvas.getContext('2d');
    return ctx ? new CanvasRenderer(ctx) : null;
  }

  private constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.ratio = pixelRatio;
    this.ctx.canvas.width = Math.max(1, Math.round(width * pixelRatio));
    this.ctx.canvas.height = Math.max(1, Math.round(height * pixelRatio));
  }

  render(frame: FrameData): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    frame.surfaces.draw2D(ctx);
    ctx.globalCompositeOperation = 'source-over';
    this.drawBatch(frame.normal);
    ctx.globalCompositeOperation = 'lighter';
    this.drawBatch(frame.additive);
    const b = frame.bolts;
    ctx.lineCap = 'round';
    for (let i = 0; i < b.length; i += 6) {
      ctx.strokeStyle = `rgba(233,240,255,${b[i + 5]!})`;
      ctx.lineWidth = b[i + 4]!;
      ctx.beginPath();
      ctx.moveTo(b[i]!, b[i + 1]!);
      ctx.lineTo(b[i + 2]!, b[i + 3]!);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (frame.flash > 0.002) {
      const [r, g, bl] = frame.flashColor.map((c) => Math.round(c * 255));
      ctx.fillStyle = `rgba(${r},${g},${bl},${Math.min(1, frame.flash)})`;
      ctx.fillRect(0, 0, frame.width, frame.height);
    }
  }

  private drawBatch(batch: SpriteBatch): void {
    const ctx = this.ctx;
    const d = batch.data;
    for (let i = 0; i < batch.count; i++) {
      const o = i * SPRITE_STRIDE;
      const kind = d[o + 6];
      if (kind === Kind.Bolt) continue;
      const x = d[o]!;
      const y = d[o + 1]!;
      const w = d[o + 2]!;
      const h = d[o + 3]!;
      const angle = d[o + 4]!;
      const alpha = d[o + 5]!;
      const color = `rgba(${Math.round(d[o + 7]! * 255)},${Math.round(d[o + 8]! * 255)},${Math.round(d[o + 9]! * 255)},${alpha})`;
      if (kind === Kind.Rain) {
        ctx.strokeStyle = color;
        ctx.lineWidth = w;
        const dx = -Math.sin(angle) * h * 0.5;
        const dy = Math.cos(angle) * h * 0.5;
        ctx.beginPath();
        ctx.moveTo(x - dx, y - dy);
        ctx.lineTo(x + dx, y + dy);
        ctx.stroke();
      } else if (kind === Kind.Leaf) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(0, 0, w / 2, Math.max(0.5, h / 4), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, (kind === Kind.Ember ? w / 4 : w / 2.6)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  destroy(): void {
    this.ctx.canvas.width = 0;
  }
}
