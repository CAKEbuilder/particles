// Particle-art formations: shapes drawn out of live particles. Each particle owns a fixed
// orbit slot and is dragged along its slot as the formation rotates, so the whole thing
// visibly orbits / tumbles in pseudo-3D. Shared by the sandbox editor (placed objects) and
// the toy-mode shape visitors.

import { config } from "../config";
import type { CpuParticleSystem } from "../sim/CpuParticleSystem";

export type FormationPattern = "atom" | "ring" | "triangle";

// One orbit target: screen position plus a depth-driven size scale and alpha so the
// formation reads as three-dimensional (nearer particles bigger & brighter).
export interface FormationSlot { x: number; y: number; scale: number; alpha: number; }

export const FORMATION_FOLLOW = 0.2;            // 0..1 velocity low-pass toward the slot's arrival velocity
export const FORMATION_SPIN = 1.0;              // rad/s base spin
export const FORMATION_BASE_SIZE = config.spawn.size; // resting particle size (depth-scaled at runtime)

// Map a depth value (z, where +z is toward the viewer) in [-zMax, zMax] to a 0..1 brightness.
function depthAlpha(z: number, zMax: number): number {
  const t = zMax > 0 ? (z / zMax + 1) * 0.5 : 0.5; // 0 = far, 1 = near
  return 0.45 + t * 0.55;
}

// Rotate a 3D point about the X axis by ax, then the Y axis by ay. Returns [x, y, z]
// with +z toward the viewer.
function rot3(x: number, y: number, z: number, ax: number, ay: number): [number, number, number] {
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const y1 = y * cx - z * sx;
  const z1 = y * sx + z * cx;
  const cy = Math.cos(ay), sy = Math.sin(ay);
  return [x * cy + z1 * sy, y1, -x * sy + z1 * cy];
}

// Compute orbit target slots for a formation centred at (cx, cy) with radius r at spin angle a.
export function computeFormationSlots(
  cx: number, cy: number, r: number, a: number, pattern: FormationPattern,
): FormationSlot[] {
  const slots: FormationSlot[] = [];

  if (pattern === "atom") {
    // Atom: a tight nucleus orbited by 3 electron shells. Each shell is a true 3D circle
    // tilted into its own plane (evenly spread around the sphere) and spun in perspective,
    // so electrons sweep in front of and behind the core — a proper 3D orbital look.
    const focal = r * 2.8;
    const nucleusR = r * 0.16;
    // Nucleus: a small counter-tumbling cluster so the core shimmers.
    for (let k = 0; k < 6; k++) {
      const na = -a * 1.5 + (k / 6) * Math.PI * 2;
      const [nx, ny, nz] = rot3(Math.cos(na) * nucleusR, Math.sin(na) * nucleusR, 0, 0.9, a * 0.8);
      const persp = focal / (focal - nz);
      slots.push({ x: cx + nx * persp, y: cy + ny * persp, scale: persp * 1.25, alpha: depthAlpha(nz, nucleusR) });
    }
    // Electron shells.
    const perShell = 7;
    for (let shell = 0; shell < 3; shell++) {
      const tiltX = 1.0;                                 // lean each orbital plane
      const tiltY = shell * ((Math.PI * 2) / 3);         // spread the 3 planes 120° apart
      const dir = shell % 2 === 0 ? 1 : -1;              // alternate orbit direction
      const spd = 1 + shell * 0.25;
      for (let j = 0; j < perShell; j++) {
        const th = dir * a * spd + (j / perShell) * Math.PI * 2;
        const [ex, ey, ez] = rot3(Math.cos(th) * r, Math.sin(th) * r, 0, tiltX, tiltY);
        const persp = focal / (focal - ez);
        slots.push({ x: cx + ex * persp, y: cy + ey * persp, scale: persp, alpha: depthAlpha(ez, r) });
      }
    }
    // Total: 6 + 21 = 27

  } else if (pattern === "ring") {
    // Halo: a tilted disc spun about its axis and drawn in perspective, so particles
    // sweep front-to-back around the rim. Two counter-rotating rings.
    const focal = r * 2.8;
    const tilt = 1.15;                              // ~66° lean about the X axis
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    const addRing = (R: number, n: number, dir: number, phase: number): void => {
      const zMax = R * sinT;
      for (let j = 0; j < n; j++) {
        const th = dir * a + (j / n) * Math.PI * 2 + phase;
        const lx = Math.cos(th) * R;
        const ly0 = Math.sin(th) * R;
        const y = ly0 * cosT;                        // tilt about X (local z = 0)
        const z = ly0 * sinT;
        const persp = focal / (focal - z);
        slots.push({ x: cx + lx * persp, y: cy + y * persp, scale: persp, alpha: depthAlpha(z, zMax) });
      }
    };
    addRing(r, 16, 1, 0);
    addRing(r * 0.55, 10, -1, 0.3);
    // Total: 26

  } else {
    // Tri 3D: a tetrahedron — a triangular base with three points in space plus an apex —
    // tumbling about two axes so it reads as a genuine solid, not a flat sheet.
    const focal = r * 3.2;
    const zMax = r;
    const ax = a * 0.7;   // tumble about X
    const ay = a;         // spin about Y
    // 4 vertices of a regular tetrahedron centred on the origin.
    const s = r / Math.SQRT2;
    const baseVerts: [number, number, number][] = [
      [ s,  s,  s],
      [-s, -s,  s],
      [-s,  s, -s],
      [ s, -s, -s],
    ];
    const verts = baseVerts.map(([x, y, z]) => rot3(x, y, z, ax, ay));
    const project = (x: number, y: number, z: number, scaleMul: number): void => {
      const persp = focal / (focal - z);
      slots.push({ x: cx + x * persp, y: cy + y * persp, scale: persp * scaleMul, alpha: depthAlpha(z, zMax) });
    };
    // Emphasise the 4 corner nodes.
    for (const [x, y, z] of verts) project(x, y, z, 1.35);
    // Particles strung along all 6 edges.
    const perEdge = 4;
    const edges = [[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
    for (const [a0, b0] of edges) {
      const A = verts[a0], B = verts[b0];
      for (let k = 1; k <= perEdge; k++) {
        const t = k / (perEdge + 1);
        project(A[0] + (B[0]-A[0])*t, A[1] + (B[1]-A[1])*t, A[2] + (B[2]-A[2])*t, 1);
      }
    }
    // Total: 4 + 24 = 28
  }

  return slots;
}

// Drag every particle tagged `id` toward its slot (indexed by artSlot), leaving a slight
// trail so the motion reads as orbiting. Also applies the slot's depth size/alpha.
export function driveFormation(
  system: CpuParticleSystem, id: number, slots: FormationSlot[], follow: number, dt: number,
): void {
  const { artId, artSlot, px, py, vx, vy, size, alpha, count } = system;
  const invDt = dt > 0 ? 1 / dt : 0;
  for (let i = 0; i < count; i++) {
    if (artId[i] !== id) continue;
    const s = slots[artSlot[i]];
    if (!s) continue;
    const needVx = (s.x - px[i]) * invDt;
    const needVy = (s.y - py[i]) * invDt;
    vx[i] += (needVx - vx[i]) * follow;
    vy[i] += (needVy - vy[i]) * follow;
    size[i] = FORMATION_BASE_SIZE * s.scale;
    alpha[i] = s.alpha;
  }
}
