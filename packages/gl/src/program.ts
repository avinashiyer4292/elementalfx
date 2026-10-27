/** A linked shader program with its active uniform locations looked up by name. */
export interface Program {
  readonly program: WebGLProgram;
  readonly uniforms: Record<string, WebGLUniformLocation>;
  use(): void;
  delete(): void;
}

/** A vertex shader that covers the viewport with one triangle and passes `vUv` in [0, 1]. */
export const FULLSCREEN_VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = corner;
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('[elementalfx] Could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`[elementalfx] Shader failed to compile: ${log ?? 'unknown error'}`);
  }
  return shader;
}

/** Compiles and links a program. Prepends `defines` as `#define` lines after the version line. */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  defines: Record<string, string | number | boolean> = {},
): Program {
  const header = Object.entries(defines)
    .filter(([, value]) => value !== false)
    .map(([name, value]) => `#define ${name} ${value === true ? '' : value}`)
    .join('\n');
  const withDefines = (source: string): string =>
    header ? source.replace(/^(#version[^\n]*\n)/, `$1${header}\n`) : source;

  const vertex = compile(gl, gl.VERTEX_SHADER, withDefines(vertexSource));
  const fragment = compile(gl, gl.FRAGMENT_SHADER, withDefines(fragmentSource));
  const program = gl.createProgram();
  if (!program) throw new Error('[elementalfx] Could not create program');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`[elementalfx] Program failed to link: ${log ?? 'unknown error'}`);
  }

  const uniforms: Record<string, WebGLUniformLocation> = {};
  const count = (gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number) ?? 0;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    const location = gl.getUniformLocation(program, info.name);
    if (location) uniforms[name] = location;
  }

  return {
    program,
    uniforms,
    use: () => gl.useProgram(program),
    delete: () => gl.deleteProgram(program),
  };
}

/**
 * Draws one fullscreen triangle. WebGL2 can draw without vertex buffers;
 * an empty vertex array object keeps every driver happy.
 */
export function createFullscreenDraw(gl: WebGL2RenderingContext): {
  draw(): void;
  delete(): void;
} {
  const vao = gl.createVertexArray();
  return {
    draw() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    delete() {
      gl.deleteVertexArray(vao);
    },
  };
}
