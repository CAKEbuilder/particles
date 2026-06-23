// Force application. Global forces (gravity/drag) are inlined in the integrate loop
// for speed; force points (pointer/level interactions) are applied here.

import type { ForcePoint } from "./ParticleSystem";

/**
 * Accumulate acceleration from all force points onto particle i.
 * Returns the x/y acceleration via the provided out-array [ax, ay].
 * Few force points are active at once, so the per-particle cost is tiny.
 */
export function accelFromForcePoints(
  points: ForcePoint[],
  x: number,
  y: number,
  out: Float32Array
): void {
  let ax = 0;
  let ay = 0;
  for (let p = 0; p < points.length; p++) {
    const fp = points[p];
    const dx = fp.x - x;
    const dy = fp.y - y;
    const d2 = dx * dx + dy * dy;
    const r = fp.radius;
    if (d2 > r * r || d2 < 1e-4) continue;
    const d = Math.sqrt(d2);
    const falloff = 1 - d / r; // linear, 1 at center -> 0 at edge

    if (fp.kind === "radial") {
      // toward (attract, strength>0) or away (repel, strength<0)
      const a = (fp.strength * falloff) / d;
      ax += dx * a;
      ay += dy * a;
    } else if (fp.kind === "vortex") {
      // tangential swirl around the center; sign of strength = spin direction
      const a = (fp.strength * falloff) / d;
      ax += -dy * a;
      ay += dx * a;
    } else {
      // directional: push along (dirX,dirY), strongest near center
      const a = fp.strength * falloff;
      ax += fp.dirX * a;
      ay += fp.dirY * a;
    }
  }
  out[0] = ax;
  out[1] = ay;
}
