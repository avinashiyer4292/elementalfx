/**
 * Stable-fluids passes (Stam 1999; GPU Gems ch. 38). Velocity is stored in
 * simulation cells per second; walls reflect velocity at the edges.
 */

const HEADER = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uTexel;
`;

/** Neighbour lookups shared by passes that need them. */
const NEIGHBOURS = `
vec2 uvL() { return vUv - vec2(uTexel.x, 0.0); }
vec2 uvR() { return vUv + vec2(uTexel.x, 0.0); }
vec2 uvB() { return vUv - vec2(0.0, uTexel.y); }
vec2 uvT() { return vUv + vec2(0.0, uTexel.y); }
`;

/** Moves a quantity along the velocity field (semi-Lagrangian) and fades it. */
export const ADVECT = `${HEADER}
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform float uDt;
uniform float uDissipation;
void main() {
  vec2 back = vUv - uDt * texture(uVelocity, vUv).xy * uTexel;
  outColor = texture(uSource, back) / (1.0 + uDissipation * uDt);
}`;

export const DIVERGENCE = `${HEADER}${NEIGHBOURS}
uniform sampler2D uVelocity;
void main() {
  vec2 c = texture(uVelocity, vUv).xy;
  float l = texture(uVelocity, uvL()).x;
  float r = texture(uVelocity, uvR()).x;
  float b = texture(uVelocity, uvB()).y;
  float t = texture(uVelocity, uvT()).y;
  // Solid walls: mirror the normal component at the boundary.
  if (uvL().x < 0.0) l = -c.x;
  if (uvR().x > 1.0) r = -c.x;
  if (uvB().y < 0.0) b = -c.y;
  if (uvT().y > 1.0) t = -c.y;
  outColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
}`;

export const CURL = `${HEADER}${NEIGHBOURS}
uniform sampler2D uVelocity;
void main() {
  float l = texture(uVelocity, uvL()).y;
  float r = texture(uVelocity, uvR()).y;
  float b = texture(uVelocity, uvB()).x;
  float t = texture(uVelocity, uvT()).x;
  outColor = vec4(0.5 * (r - l - t + b), 0.0, 0.0, 1.0);
}`;

/** Vorticity confinement: re-injects the small swirls that numerical diffusion smooths away. */
export const VORTICITY = `${HEADER}${NEIGHBOURS}
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float uCurlStrength;
uniform float uDt;
void main() {
  float l = texture(uCurl, uvL()).x;
  float r = texture(uCurl, uvR()).x;
  float b = texture(uCurl, uvB()).x;
  float t = texture(uCurl, uvT()).x;
  float c = texture(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(t) - abs(b), abs(r) - abs(l));
  force /= length(force) + 1e-4;
  force *= uCurlStrength * c;
  force.y = -force.y;
  vec2 velocity = texture(uVelocity, vUv).xy + force * uDt;
  outColor = vec4(clamp(velocity, -1000.0, 1000.0), 0.0, 1.0);
}`;

/** Fades last frame's pressure; it's a good starting guess for this frame's solve. */
export const SCALE = `${HEADER}
uniform sampler2D uSource;
uniform float uValue;
void main() {
  outColor = texture(uSource, vUv) * uValue;
}`;

/** One Jacobi iteration of the pressure Poisson equation. */
export const PRESSURE = `${HEADER}${NEIGHBOURS}
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float l = texture(uPressure, uvL()).x;
  float r = texture(uPressure, uvR()).x;
  float b = texture(uPressure, uvB()).x;
  float t = texture(uPressure, uvT()).x;
  float divergence = texture(uDivergence, vUv).x;
  outColor = vec4((l + r + b + t - divergence) * 0.25, 0.0, 0.0, 1.0);
}`;

/** Removes the pressure gradient, leaving a divergence-free (incompressible) velocity. */
export const GRADIENT_SUBTRACT = `${HEADER}${NEIGHBOURS}
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main() {
  float l = texture(uPressure, uvL()).x;
  float r = texture(uPressure, uvR()).x;
  float b = texture(uPressure, uvB()).x;
  float t = texture(uPressure, uvT()).x;
  vec2 velocity = texture(uVelocity, vUv).xy - 0.5 * vec2(r - l, t - b);
  outColor = vec4(velocity, 0.0, 1.0);
}`;

/** Adds a Gaussian blob of velocity or dye. */
export const SPLAT = `${HEADER}
uniform sampler2D uTarget;
uniform float uAspect;
uniform vec3 uValue;
uniform vec2 uPoint;
uniform float uRadius;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  vec3 base = texture(uTarget, vUv).xyz;
  outColor = vec4(base + exp(-dot(p, p) / uRadius) * uValue, 1.0);
}`;

/**
 * Draws the dye with transparency where there's none, so the page shows
 * through. Optional shading reads dye density as a height for a soft 3D look.
 */
export const DISPLAY = `${HEADER}${NEIGHBOURS}
uniform sampler2D uDye;
uniform float uOpacity;
uniform float uShading;
void main() {
  vec3 color = texture(uDye, vUv).rgb;
  if (uShading > 0.0) {
    float dx = length(texture(uDye, uvR()).rgb) - length(texture(uDye, uvL()).rgb);
    float dy = length(texture(uDye, uvT()).rgb) - length(texture(uDye, uvB()).rgb);
    vec3 n = normalize(vec3(dx, dy, length(uTexel)));
    float diffuse = clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);
    color *= mix(1.0, diffuse, uShading);
  }
  float alpha = clamp(max(color.r, max(color.g, color.b)), 0.0, 1.0) * uOpacity;
  // Premultiplied output: dye adds light where it's dense and fades to clear.
  outColor = vec4(min(color, vec3(1.0)) * uOpacity, alpha);
}`;
