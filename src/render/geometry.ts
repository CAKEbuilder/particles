// Geometry helpers. Particles are drawn as instanced billboards (a quad) and the
// upside-down-triangle shape is carved out per-pixel in the fragment shader (so it
// glows with a soft halo). A triangle-strip quad covering [-1,1] is all we need.

export const QUAD_STRIP = new Float32Array([
  -1, -1,
  1, -1,
  -1, 1,
  1, 1,
]);

// Actual ▽ outline in unit space (apex pointing down), kept for UI / future use.
export const TRIANGLE_DOWN = new Float32Array([
  -1, -0.6,
  1, -0.6,
  0, 0.95,
]);
