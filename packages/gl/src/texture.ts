/** Anything WebGL can upload as a texture that effects accept as a source. */
export type ImageSource =
  | HTMLImageElement
  | HTMLCanvasElement
  | HTMLVideoElement
  | ImageBitmap
  | OffscreenCanvas;

/** Natural pixel size of a source, or 0×0 if it isn't ready yet. */
export function sourceSize(source: ImageSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  if (source instanceof HTMLVideoElement) {
    return { width: source.videoWidth, height: source.videoHeight };
  }
  return { width: source.width, height: source.height };
}

/** Whether the source has pixels that can be uploaded right now. */
export function isSourceReady(source: ImageSource): boolean {
  if (source instanceof HTMLImageElement) return source.complete && source.naturalWidth > 0;
  if (source instanceof HTMLVideoElement) return source.readyState >= 2 && source.videoWidth > 0;
  const { width, height } = sourceSize(source);
  return width > 0 && height > 0;
}

/** Creates a texture with linear filtering and clamped edges. */
export function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('[elementalfx] Could not allocate texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/**
 * Uploads a source with premultiplied alpha, top row first (so v = 0 is the
 * top of the image). Builds mipmaps when `mipmaps` is set, which keeps large
 * photos from shimmering when drawn small. Throws a SecurityError for
 * cross-origin pixels without CORS approval.
 */
export function uploadTexture(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  source: ImageSource,
  mipmaps = false,
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  if (mipmaps) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
}

/**
 * Loads an image URL for use as a texture. Requests CORS by default so
 * cross-origin images work when the server allows it.
 */
export function loadImage(url: string, crossOrigin: string | null = 'anonymous'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin !== null && !url.startsWith('data:') && !url.startsWith('blob:')) {
      image.crossOrigin = crossOrigin;
    }
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`[elementalfx] Could not load image: ${url}`));
    image.src = url;
  });
}
