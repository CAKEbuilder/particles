// GLSL (WebGL2 / GLSL ES 3.00) shader sources.

// ---- particle: instanced glowing upside-down triangle ----
export const PARTICLE_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aCorner;   // quad corner in [-1,1]
layout(location = 1) in vec2 aPos;       // instance: world position (css px)
layout(location = 2) in float aSize;     // instance: half-size of the ▽ (css px)
layout(location = 3) in float aAngle;    // instance: rotation (rad)
layout(location = 4) in float aHue;      // instance: 0..1 along aurora ramp
layout(location = 5) in float aAlpha;    // instance: brightness 0..~1.1

uniform vec2 uResolution;                // css px

out vec2 vCorner;
out float vHue;
out float vAlpha;

const float GLOW_EXTENT = 1.7; // quad is bigger than the triangle to fit the halo

void main() {
  vCorner = aCorner;
  vHue = aHue;
  vAlpha = aAlpha;

  float s = sin(aAngle);
  float c = cos(aAngle);
  vec2 local = aCorner * (aSize * GLOW_EXTENT);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 world = aPos + rotated;

  vec2 clip = (world / uResolution) * 2.0 - 1.0;
  clip.y = -clip.y; // world y grows downward
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

export const PARTICLE_FS = /* glsl */ `#version 300 es
precision highp float;

in vec2 vCorner;
in float vHue;
in float vAlpha;

out vec4 fragColor;

// Cohesive "aurora" ramp: blue -> cyan -> teal -> violet -> magenta. No muddy greens.
vec3 aurora(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.10, 0.32, 0.98);
  vec3 c1 = vec3(0.13, 0.85, 0.97);
  vec3 c2 = vec3(0.22, 0.96, 0.72);
  vec3 c3 = vec3(0.62, 0.36, 0.99);
  vec3 c4 = vec3(0.99, 0.32, 0.72);
  float x = t * 4.0;
  vec3 col = mix(c0, c1, clamp(x, 0.0, 1.0));
  col = mix(col, c2, clamp(x - 1.0, 0.0, 1.0));
  col = mix(col, c3, clamp(x - 2.0, 0.0, 1.0));
  col = mix(col, c4, clamp(x - 3.0, 0.0, 1.0));
  return col;
}

// Signed distance to an equilateral triangle (Inigo Quilez). Negative inside.
// In our corner space +y points downward on screen, so the apex points DOWN (▽).
float sdTriangle(vec2 p, float r) {
  const float k = 1.7320508; // sqrt(3)
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) * 0.5;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

void main() {
  // per-particle brightness; tuned low so additive density reveals colour (via the
  // HDR + tone-map present) and individual triangles stay distinct in a glob.
  const float BRIGHT = 0.5;

  float d = sdTriangle(vCorner, 0.7);
  float aa = fwidth(d) + 0.004;
  float fill = smoothstep(aa, -aa, d);          // crisp anti-aliased body
  float glow = exp(-max(d, 0.0) * 11.0);         // tight halo so glows don't merge
  float intensity = clamp(fill + glow * 0.22, 0.0, 1.15);
  if (intensity < 0.003) discard;

  vec3 col = aurora(vHue);
  // a hint of white in the hot core for a luminous look (kept subtle to keep colour)
  col = mix(col, vec3(1.0), fill * 0.1);
  float out_a = intensity * vAlpha * BRIGHT;
  fragColor = vec4(col * out_a, out_a);
}
`;

// ---- fullscreen blit (used for trail-fade and final present) ----
export const BLIT_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const BLIT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uScale;
uniform vec3 uBg;
uniform int uTonemap;
out vec4 fragColor;

// ACES filmic curve applied to LUMINANCE only, then the colour is rescaled to that
// luminance. This rolls bright HDR values into [0,1] while PRESERVING hue, so dense
// additive clusters stay saturated/colourful instead of desaturating to white.
float acesL(float x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec4 t = texture(uTex, vUv) * uScale;
  if (uTonemap == 1) {
    vec3 c = t.rgb + uBg;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float ln = acesL(l);
    c *= ln / max(l, 1e-5);
    fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  } else {
    fragColor = t;
  }
}
`;
