import { PACKING_GLSL } from '@elementalfx/gl';

export const MAX_DROPS = 16;

/**
 * State access shared by every pass. Height lives in the first value and
 * vertical velocity in the second; packed mode stores each as two 8-bit
 * channels for devices that can't render to float textures.
 */
const STATE_IO = `
${PACKING_GLSL}
uniform sampler2D uState;
uniform vec2 uSimSize;
vec2 fetchState(ivec2 p) {
  p = clamp(p, ivec2(0), ivec2(uSimSize) - 1);
  vec4 t = texelFetch(uState, p, 0);
#ifdef PACKED
  return vec2(unpackSigned(t.rg), unpackSigned(t.ba));
#else
  return t.rg;
#endif
}
vec4 encodeState(vec2 s) {
#ifdef PACKED
  return vec4(packSigned(s.x), packSigned(s.y));
#else
  return vec4(s, 0.0, 1.0);
#endif
}
`;

/** Adds smooth cosine-shaped bumps to the height field. */
export const DROP_FRAGMENT = `#version 300 es
precision highp float;
${STATE_IO}
uniform vec4 uDrops[${MAX_DROPS}];
uniform int uDropCount;
uniform float uAspect;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec2 s = fetchState(ivec2(gl_FragCoord.xy));
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= uDropCount) break;
    vec4 drop = uDrops[i];
    vec2 d = (vUv - drop.xy) * vec2(1.0, 1.0 / uAspect);
    float t = max(0.0, 1.0 - length(d) / drop.z);
    s.x += (0.5 - cos(t * 3.14159265) * 0.5) * drop.w;
  }
  outColor = encodeState(s);
}`;

/**
 * One step of the discrete wave equation: velocity moves toward the
 * neighbourhood average, is damped, then moves the height.
 */
export const UPDATE_FRAGMENT = `#version 300 es
precision highp float;
${STATE_IO}
uniform float uDamping;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 s = fetchState(p);
  float average = (
    fetchState(p + ivec2(-1, 0)).x +
    fetchState(p + ivec2(1, 0)).x +
    fetchState(p + ivec2(0, -1)).x +
    fetchState(p + ivec2(0, 1)).x
  ) * 0.25;
  s.y += (average - s.x) * 2.0;
#ifdef PACKED
  // Multiplying a quantised value can round back to itself, so small waves
  // would never die out. Always remove at least one quantum per step.
  float decay = max(abs(s.y) * (1.0 - uDamping), PACK_QUANTUM);
  s.y -= sign(s.y) * min(abs(s.y), decay);
#else
  s.y *= uDamping;
#endif
  s.x += s.y;
  outColor = encodeState(s);
}`;

/**
 * Draws the source image refracted by the height field's slope, plus a
 * soft highlight on slopes facing the light.
 */
export const RENDER_FRAGMENT = `#version 300 es
precision highp float;
${STATE_IO}
uniform sampler2D uImage;
uniform vec4 uImageTransform; // imageUv = screenUv * xy + zw
uniform vec2 uRepeat;         // 1.0 where the image tiles on that axis
uniform float uPerturbance;
uniform float uHighlight;
uniform float uAspect;
in vec2 vUv;
out vec4 outColor;

float heightAt(vec2 uv) {
#ifdef MANUAL_FILTER
  vec2 p = uv * uSimSize - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 f = p - floor(p);
  float a = fetchState(i).x;
  float b = fetchState(i + ivec2(1, 0)).x;
  float c = fetchState(i + ivec2(0, 1)).x;
  float d = fetchState(i + ivec2(1, 1)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
#else
  return texture(uState, uv).x;
#endif
}

void main() {
  vec2 texel = 1.0 / uSimSize;
  float hL = heightAt(vUv - vec2(texel.x, 0.0));
  float hR = heightAt(vUv + vec2(texel.x, 0.0));
  float hD = heightAt(vUv - vec2(0.0, texel.y));
  float hU = heightAt(vUv + vec2(0.0, texel.y));
  // Slope per unit of element width; simulation cells are square on screen.
  float spacing = 2.0 / uSimSize.x;
  vec3 normal = normalize(vec3(-(hR - hL) / spacing, 1.0, -(hU - hD) / spacing));
  vec2 offset = -normal.xz * uPerturbance;

  vec2 screenUv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 shifted = screenUv + vec2(offset.x, -offset.y * uAspect);
  vec2 imageUv = shifted * uImageTransform.xy + uImageTransform.zw;
  imageUv = mix(imageUv, fract(imageUv), uRepeat);
  vec4 color = texture(uImage, imageUv);
  if (any(lessThan(imageUv, vec2(0.0))) || any(greaterThan(imageUv, vec2(1.0)))) {
    color = vec4(0.0);
  }
  // -normal.xz points uphill; slopes facing the light (up and to the left) catch a highlight.
  float specular = pow(max(0.0, dot(-normal.xz, normalize(vec2(-0.6, 1.0)))), 4.0);
  outColor = vec4(color.rgb + specular * uHighlight * color.a, color.a);
}`;
