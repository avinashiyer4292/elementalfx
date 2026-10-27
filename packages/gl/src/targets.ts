/** Storage format for a simulation texture. */
export interface TargetFormat {
  internalFormat: number;
  format: number;
  type: number;
  /** Linear filtering is supported. */
  filterable: boolean;
  /**
   * True when values must be packed into 8-bit channels because the device
   * cannot render to floating-point textures. Shaders must encode and decode.
   */
  packed: boolean;
}

export interface FormatRequest {
  /**
   * 'float' prefers 32-bit floats (best for slowly-decaying waves), falling back
   * to half floats. 'half' starts at half floats (enough for fluids, less memory).
   */
  precision?: 'float' | 'half';
  /** Skip float formats entirely. Used by tests to exercise the 8-bit path. */
  forcePacked?: boolean;
}

/**
 * Picks the best renderable format for simulation data, verifying each candidate
 * with a real framebuffer because some drivers advertise formats they can't render:
 * RGBA32F, then RGBA16F, then RGBA8 with values packed by the shader.
 */
export function simulationFormat(
  gl: WebGL2RenderingContext,
  request: FormatRequest = {},
): TargetFormat {
  const packed: TargetFormat = {
    internalFormat: gl.RGBA8,
    format: gl.RGBA,
    type: gl.UNSIGNED_BYTE,
    filterable: false,
    packed: true,
  };
  if (request.forcePacked) return packed;

  const colorBufferFloat = gl.getExtension('EXT_color_buffer_float') !== null;
  const colorBufferHalf = colorBufferFloat || gl.getExtension('EXT_color_buffer_half_float') !== null;

  if ((request.precision ?? 'float') === 'float' && colorBufferFloat) {
    const full: TargetFormat = {
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      filterable: gl.getExtension('OES_texture_float_linear') !== null,
      packed: false,
    };
    if (canRenderTo(gl, full)) return full;
  }
  if (colorBufferHalf) {
    const half: TargetFormat = {
      internalFormat: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.HALF_FLOAT,
      filterable: true,
      packed: false,
    };
    if (canRenderTo(gl, half)) return half;
  }
  return packed;
}

function canRenderTo(gl: WebGL2RenderingContext, format: TargetFormat): boolean {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, format.internalFormat, 4, 4, 0, format.format, format.type, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.deleteFramebuffer(framebuffer);
  gl.deleteTexture(texture);
  return complete;
}

/** A texture with a framebuffer attached, for rendering simulation steps into. */
export class RenderTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly width: number,
    readonly height: number,
    readonly format: TargetFormat,
    filter: number = format.filterable ? gl.LINEAR : gl.NEAREST,
  ) {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('[elementalfx] Could not allocate render target');
    this.texture = texture;
    this.framebuffer = framebuffer;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      format.internalFormat,
      width,
      height,
      0,
      format.format,
      format.type,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    this.clear();
  }

  /** Binds this target for drawing and sets the viewport to its size. */
  bind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
    this.gl.viewport(0, 0, this.width, this.height);
  }

  /** Clears to zero (or to the packed encoding of zero). */
  clear(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    // Packed values store 0 as 32767 (hi 127, lo 255) in each channel pair.
    if (this.format.packed) gl.clearColor(127 / 255, 1, 127 / 255, 1);
    else gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  delete(): void {
    this.gl.deleteFramebuffer(this.framebuffer);
    this.gl.deleteTexture(this.texture);
  }
}

/** Two render targets that swap roles each step: read from one, write to the other. */
export class PingPong {
  read: RenderTarget;
  write: RenderTarget;

  constructor(gl: WebGL2RenderingContext, width: number, height: number, format: TargetFormat) {
    this.read = new RenderTarget(gl, width, height, format);
    this.write = new RenderTarget(gl, width, height, format);
  }

  get width(): number {
    return this.read.width;
  }

  get height(): number {
    return this.read.height;
  }

  swap(): void {
    const read = this.read;
    this.read = this.write;
    this.write = read;
  }

  clear(): void {
    this.read.clear();
    this.write.clear();
  }

  delete(): void {
    this.read.delete();
    this.write.delete();
  }
}

/**
 * GLSL helpers for packing a signed value in [-1, 1] into two 8-bit channels
 * (16-bit precision) when float render targets are unavailable. Zero maps to
 * exactly 32767 so a cleared texture decodes to exactly 0.
 * `PACK_QUANTUM` is the smallest representable step.
 */
export const PACKING_GLSL = `
const float PACK_QUANTUM = 2.0 / 65534.0;
vec2 packSigned(float value) {
  float v = floor(clamp(value * 0.5 + 0.5, 0.0, 1.0) * 65534.0 + 0.5);
  float hi = floor(v / 256.0);
  float lo = v - hi * 256.0;
  return vec2(hi, lo) / 255.0;
}
float unpackSigned(vec2 bytes) {
  vec2 b = floor(bytes * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65534.0 * 2.0 - 1.0;
}
`;
