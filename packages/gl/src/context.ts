import { isBrowser } from '@elementalfx/core';

export interface ContextOptions {
  /** Default 'default'. Decorative effects can pass 'low-power' to favour battery life. */
  powerPreference?: WebGLPowerPreference;
}

/** Creates a WebGL2 context tuned for 2D effects, or returns null if unavailable. */
export function getWebGL2(
  canvas: HTMLCanvasElement,
  options: ContextOptions = {},
): WebGL2RenderingContext | null {
  try {
    return canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: options.powerPreference ?? 'default',
    });
  } catch {
    return null;
  }
}

let supported: boolean | undefined;

/** Whether this browser can create a WebGL2 context. Cached after the first call. */
export function isWebGL2Supported(): boolean {
  if (supported !== undefined) return supported;
  if (!isBrowser) return false;
  const canvas = document.createElement('canvas');
  const gl = getWebGL2(canvas);
  supported = gl !== null;
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return supported;
}

/**
 * Watches for context loss and restoration. On loss the default is prevented so
 * the browser may restore the context later; effects then rebuild GPU resources.
 */
export function watchContextLoss(
  canvas: HTMLCanvasElement,
  onLost: () => void,
  onRestored: () => void,
): () => void {
  const lost = (event: Event): void => {
    event.preventDefault();
    onLost();
  };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  return () => {
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
  };
}
