// Boundary walls + soft particle-to-particle separation.

import type { SimEvent } from "./ParticleSystem";
import type { SpatialHash } from "./SpatialHash";

/**
 * Keep particles inside [0,w]x[0,h]; bounce with restitution and tangential friction.
 * Emits a (sampled) SimEvent on energetic bounces for the audio layer.
 */
export function resolveWalls(
  px: Float32Array,
  py: Float32Array,
  vx: Float32Array,
  vy: Float32Array,
  count: number,
  w: number,
  h: number,
  restitution: number,
  friction: number,
  kick: number,
  events: SimEvent[],
  maxEvents: number
): void {
  const eventSpeed2 = 220 * 220; // only loud-ish hits ping
  for (let i = 0; i < count; i++) {
    let bounced = false;

    if (px[i] < 0) {
      px[i] = 0;
      if (vx[i] < 0) {
        vx[i] = -vx[i] * restitution;
        if (vx[i] < kick) vx[i] = kick; // never stick: rebound at least `kick`
        vy[i] *= friction;
        bounced = true;
      }
    } else if (px[i] > w) {
      px[i] = w;
      if (vx[i] > 0) {
        vx[i] = -vx[i] * restitution;
        if (vx[i] > -kick) vx[i] = -kick;
        vy[i] *= friction;
        bounced = true;
      }
    }

    if (py[i] < 0) {
      py[i] = 0;
      if (vy[i] < 0) {
        vy[i] = -vy[i] * restitution;
        if (vy[i] < kick) vy[i] = kick;
        vx[i] *= friction;
        bounced = true;
      }
    } else if (py[i] > h) {
      py[i] = h;
      if (vy[i] > 0) {
        vy[i] = -vy[i] * restitution;
        if (vy[i] > -kick) vy[i] = -kick;
        vx[i] *= friction;
        bounced = true;
      }
    }

    if (bounced && events.length < maxEvents) {
      const s2 = vx[i] * vx[i] + vy[i] * vy[i];
      // sample: louder hits more likely to ping, keeps the texture sparse
      if (s2 > eventSpeed2 && Math.random() < 0.04) {
        const intensity = Math.min(1, Math.sqrt(s2) / 900);
        events.push({ kind: "wall", x: px[i], y: py[i], intensity });
      }
    }
  }
}

/**
 * Soft separation: nudge overlapping particles apart and damp their approach.
 * Each unordered pair is visited once (j > i) using the spatial hash neighbourhood.
 */
export function resolveSeparation(
  grid: SpatialHash,
  px: Float32Array,
  py: Float32Array,
  vx: Float32Array,
  vy: Float32Array,
  count: number,
  radius: number,
  correction: number,
  damping: number,
  maxNeighbors: number,
  micro: SimEvent[],
  microCap: number,
  sampleOffset: number
): void {
  const r2 = radius * radius;
  const cols = grid.cols;
  const rows = grid.rows;
  const cellStart = grid.cellStart;
  const order = grid.order;
  const microMask = 511; // cheap 1-in-512 sampling for tiny collision pings

  for (let i = 0; i < count; i++) {
    const xi = px[i];
    const yi = py[i];
    const cx = grid.clampCol(xi);
    const cy = grid.clampRow(yi);

    const gx0 = cx > 0 ? cx - 1 : 0;
    const gx1 = cx < cols - 1 ? cx + 1 : cols - 1;
    const gy0 = cy > 0 ? cy - 1 : 0;
    const gy1 = cy < rows - 1 ? cy + 1 : rows - 1;

    // hard cap on interactions per particle keeps cost O(n*k) even in dense piles
    let budget = maxNeighbors;

    for (let gy = gy0; gy <= gy1 && budget > 0; gy++) {
      const rowBase = gy * cols;
      for (let gx = gx0; gx <= gx1 && budget > 0; gx++) {
        const cell = rowBase + gx;
        const start = cellStart[cell];
        const end = cellStart[cell + 1];
        for (let k = start; k < end; k++) {
          const j = order[k];
          if (j <= i) continue;

          const dx = px[j] - xi;
          const dy = py[j] - yi;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r2 || d2 < 1e-6) continue;

          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const overlap = radius - d;

          // positional correction (split between the pair)
          const push = overlap * correction * 0.5;
          px[i] -= nx * push;
          py[i] -= ny * push;
          px[j] += nx * push;
          py[j] += ny * push;

          // damp the approaching normal velocity for a soft, stable contact
          const rvx = vx[j] - vx[i];
          const rvy = vy[j] - vy[i];
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const imp = vn * damping * 0.5;
            vx[i] += nx * imp;
            vy[i] += ny * imp;
            vx[j] -= nx * imp;
            vy[j] -= ny * imp;

            // tiny collision ping: cheap 1-in-512 sampling on energetic contacts
            if (
              micro.length < microCap &&
              vn < -130 &&
              (k & microMask) === sampleOffset
            ) {
              micro.push({
                kind: "micro",
                x: (xi + px[j]) * 0.5,
                y: (yi + py[j]) * 0.5,
                intensity: Math.min(1, -vn / 700),
              });
            }
          }

          if (--budget <= 0) break;
        }
      }
    }
  }
}
