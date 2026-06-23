// Translate a special's effects (+ level) into the existing force-point / erase systems.

import type { ForcePoint } from "../sim/ParticleSystem";
import type { EffectSpec } from "./defs";

const TUNE = {
  attract: { strength: 900, radius: 200, radiusPerLevel: 40 },
  repel: { strength: 1200, radius: 200, radiusPerLevel: 40 },
  vortex: { strength: 1300, radius: 240, radiusPerLevel: 40 },
};

/** A force point for attract/repel/vortex effects, or null for destroy (handled separately). */
export function effectForce(e: EffectSpec, x: number, y: number): ForcePoint | null {
  if (e.kind === "destroy") return null;
  const t = TUNE[e.kind];
  const radius = t.radius + (e.level - 1) * t.radiusPerLevel;
  const mag = t.strength * e.level;
  if (e.kind === "attract") {
    return { kind: "radial", x, y, radius, strength: mag, dirX: 0, dirY: 0 };
  }
  if (e.kind === "repel") {
    return { kind: "radial", x, y, radius, strength: -mag, dirX: 0, dirY: 0 };
  }
  // vortex
  return { kind: "vortex", x, y, radius, strength: mag, dirX: 0, dirY: 0 };
}

/** Destroy radius (px) for a destroy effect, else 0. */
export function destroyRadius(e: EffectSpec): number {
  return e.kind === "destroy" ? 48 + (e.level - 1) * 26 : 0;
}
