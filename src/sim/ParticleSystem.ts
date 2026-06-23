// Shared types + the interface the rest of the game talks to.
// A future GpuParticleSystem can implement this without touching render/audio/input.

export type ForceKind = "radial" | "directional" | "vortex";

export interface ForcePoint {
  kind: ForceKind;
  x: number;
  y: number;
  radius: number;
  /** radial: >0 attract, <0 repel (px/s^2 at center). directional: magnitude along dir. */
  strength: number;
  dirX: number; // used by directional
  dirY: number;
}

/** A lightweight "ping" emitted by the sim for the audio layer. */
export interface SimEvent {
  kind: "wall" | "micro"; // wall bounce vs tiny particle-particle collision
  x: number;
  y: number;
  intensity: number; // 0..1
}

export interface SpawnOptions {
  count: number;
  speed?: number;
  speedJitter?: number;
}

export interface ParticleSystem {
  readonly capacity: number;
  readonly count: number;

  // structure-of-arrays buffers the renderer reads directly (indices 0..count-1 are live)
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly size: Float32Array;
  readonly angle: Float32Array;
  readonly hue: Float32Array;
  readonly alpha: Float32Array;

  setBounds(w: number, h: number): void;
  setForcePoints(points: ForcePoint[]): void;

  spawnBurst(x: number, y: number, opts: SpawnOptions): void;
  eraseNear(x: number, y: number, radius: number): void;
  clear(): void;

  step(dt: number): void;
  /** Drain sim events accumulated during the last step(s). */
  drainEvents(): SimEvent[];
}
