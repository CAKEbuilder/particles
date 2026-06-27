// CPU particle system: structure-of-arrays, fixed-dt integration, spatial-hash
// separation. Designed for tens of thousands of particles at 60fps.

import { config } from "../config";
import { perf } from "../core/Profiler";
import { accelFromForcePoints } from "./forces";
import { resolveSeparation, resolveWalls } from "./collision";
import { SpatialHash } from "./SpatialHash";
import type { ForcePoint, ParticleSystem, SimEvent, SpawnOptions } from "./ParticleSystem";

export class CpuParticleSystem implements ParticleSystem {
  readonly capacity: number;
  softCap: number;
  count = 0;

  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly size: Float32Array;
  readonly angle: Float32Array;
  readonly hue: Float32Array;
  readonly alpha: Float32Array;
  private readonly rainbowFlag: Uint8Array;
  readonly holo: Uint8Array;    // persistent holographic flag
  readonly tintT: Float32Array; // seconds of temporary rainbow-blast tint remaining

  hueLo = 0;
  hueHi = 1;
  spawnRainbow = false;

  avgSpeed = 0;
  tintedCount = 0; // particles with tintT > 0 (updated each step)
  holoCount = 0;   // particles with holo=1 (updated each step)

  private w = 1;
  private h = 1;
  private forcePoints: ForcePoint[] = [];
  private grid: SpatialHash;
  private events: SimEvent[] = [];
  private readonly accel = new Float32Array(2);
  private stepCounter = 0;
  private time = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.softCap = capacity;
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.angle = new Float32Array(capacity);
    this.hue = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.rainbowFlag = new Uint8Array(capacity);
    this.holo = new Uint8Array(capacity);
    this.tintT = new Float32Array(capacity);
    this.grid = new SpatialHash(config.separation.radius);
  }

  setBounds(w: number, h: number): void {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
  }

  setForcePoints(points: ForcePoint[]): void {
    this.forcePoints = points;
  }

  spawnBurst(x: number, y: number, opts: SpawnOptions): void {
    const speed = opts.speed ?? config.spawn.speed;
    const jitter = opts.speedJitter ?? config.spawn.speedJitter;
    const cap = Math.min(this.capacity, this.softCap);
    for (let n = 0; n < opts.count; n++) {
      if (this.count >= cap) return;
      const i = this.count++;
      const a = Math.random() * Math.PI * 2;
      const sp = speed + (Math.random() - 0.5) * jitter;
      this.px[i] = x;
      this.py[i] = y;
      this.vx[i] = Math.cos(a) * sp;
      this.vy[i] = Math.sin(a) * sp;
      this.size[i] = config.spawn.size + Math.random() * config.spawn.sizeJitter;
      this.angle[i] = Math.random() * Math.PI * 2;
      this.hue[i] = 0;
      this.alpha[i] = 1;
      this.rainbowFlag[i] = this.spawnRainbow ? 1 : 0;
      this.holo[i] = 0;
      this.tintT[i] = 0;
    }
  }

  eraseNear(x: number, y: number, radius: number): void {
    const r2 = radius * radius;
    for (let i = this.count - 1; i >= 0; i--) {
      const dx = this.px[i] - x;
      const dy = this.py[i] - y;
      if (dx * dx + dy * dy <= r2) this.swapRemove(i);
    }
  }

  consumeNear(x: number, y: number, radius: number, maxCount: number): number {
    const r2 = radius * radius;
    let removed = 0;
    for (let i = this.count - 1; i >= 0 && removed < maxCount; i--) {
      const dx = this.px[i] - x;
      const dy = this.py[i] - y;
      if (dx * dx + dy * dy <= r2) {
        this.swapRemove(i);
        removed++;
      }
    }
    return removed;
  }

  /** Softly tint non-rainbow particles near (x, y). tintT is 0..1 intensity; quadratic
   *  falloff so there is no hard edge. Rainbow-buffed particles are left untouched. */
  tintNear(x: number, y: number, radius: number): void {
    const r2 = radius * radius;
    const maxStrength = 0.35; // cap so the tint is a subtle shimmer, not a full colour takeover
    for (let i = 0; i < this.count; i++) {
      if (this.rainbowFlag[i]) continue; // never override permanent rainbow buff
      const dx = this.px[i] - x;
      const dy = this.py[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const t = d2 / r2;                              // 0 = centre, 1 = edge
        const strength = (1 - t) * (1 - t) * maxStrength; // quadratic falloff, capped
        if (this.tintT[i] < strength) this.tintT[i] = strength;
      }
    }
  }

  /** Make a single random particle holographic. */
  makeHoloRandom(): void {
    if (this.count === 0) return;
    this.holo[Math.floor(Math.random() * this.count)] = 1;
  }

  /** Make all particles within radius holographic. */
  makeHoloNear(x: number, y: number, radius: number): void {
    const r2 = radius * radius;
    for (let i = 0; i < this.count; i++) {
      const dx = this.px[i] - x;
      const dy = this.py[i] - y;
      if (dx * dx + dy * dy <= r2) this.holo[i] = 1;
    }
  }

  /** Spread holographic flag to nearby non-holo particles; `maxInfect` caps new infections. */
  infectHolo(infectRadius: number, maxInfect: number): void {
    const r2 = infectRadius * infectRadius;
    let infected = 0;
    const n = this.count;
    for (let i = 0; i < n && infected < maxInfect; i++) {
      if (this.holo[i]) continue;
      for (let j = 0; j < n; j++) {
        if (!this.holo[j]) continue;
        const dx = this.px[i] - this.px[j];
        const dy = this.py[i] - this.py[j];
        if (dx * dx + dy * dy < r2) {
          this.holo[i] = 1;
          infected++;
          break;
        }
      }
    }
  }

  private swapRemove(i: number): void {
    const last = --this.count;
    if (i !== last) {
      this.px[i] = this.px[last];
      this.py[i] = this.py[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.size[i] = this.size[last];
      this.angle[i] = this.angle[last];
      this.hue[i] = this.hue[last];
      this.alpha[i] = this.alpha[last];
      this.rainbowFlag[i] = this.rainbowFlag[last];
      this.holo[i] = this.holo[last];
      this.tintT[i] = this.tintT[last];
    }
  }

  clear(): void {
    this.count = 0;
    this.tintedCount = 0;
    this.holoCount = 0;
  }

  step(dt: number): void {
    const n = this.count;
    if (n === 0) return;

    const { gravityEnabled, gravity, drag, hueBase, hueByPos, hueDrift, hueBySpeed, hueGradSpeed, spin } = config;
    const g = gravityEnabled ? gravity : 0;
    const gxv = g * config.runtime.gravDirX;
    const gyv = g * config.runtime.gravDirY;
    const damp = Math.max(0, 1 - drag * dt);
    this.time += dt;
    const hueOffset = hueBase + this.time * hueDrift;
    const hueLo = this.hueLo;
    const hueSpan = this.hueHi - this.hueLo;
    const rainbow = this.rainbowFlag;
    const holo = this.holo;
    const tintT = this.tintT;
    const rainbowPhase = this.time * 0.25;
    const holoPhase = this.time * 0.55;
    // slowly rotating gradient direction — eliminates the fixed diagonal colour seam
    const gradAngle = this.time * hueGradSpeed;
    const gradX = Math.cos(gradAngle);
    const gradY = Math.sin(gradAngle);
    const tintDecay = config.visitors.tintDecayPerSec * dt;
    const points = this.forcePoints;
    const hasPoints = points.length > 0;
    const accel = this.accel;
    const dSpin = spin * dt;

    const px = this.px;
    const py = this.py;
    const vx = this.vx;
    const vy = this.vy;
    const angle = this.angle;
    const hue = this.hue;
    const alpha = this.alpha;

    perf.begin("integrate");
    let sumSpeed = 0;
    let tinted = 0;
    let holos = 0;
    for (let i = 0; i < n; i++) {
      let ax = gxv;
      let ay = gyv;

      if (hasPoints) {
        accelFromForcePoints(points, px[i], py[i], accel);
        ax += accel[0];
        ay += accel[1];
      }

      let nvx = (vx[i] + ax * dt) * damp;
      let nvy = (vy[i] + ay * dt) * damp;
      vx[i] = nvx;
      vy[i] = nvy;
      px[i] += nvx * dt;
      py[i] += nvy * dt;

      const speed = Math.sqrt(nvx * nvx + nvy * nvy);
      sumSpeed += speed;

      const gp = gradX * px[i] + gradY * py[i]; // rotating spatial gradient value
      if (holo[i]) {
        // holographic: distinct shimmer (faster phase, tighter spatial freq), max brightness
        holos++;
        let hr = holoPhase + gp * 0.0042;
        hr -= Math.floor(hr);
        hue[i] = hr;
        alpha[i] = 0.92 + Math.min(0.08, speed * 0.0005);
      } else if (rainbow[i]) {
        // permanent rainbow buff — always full rainbow, never overridden by tint
        if (tintT[i] > 0) tintT[i] = 0; // clear any stale tint on rainbow particles
        let hr = rainbowPhase + gp * 0.0026;
        hr -= Math.floor(hr);
        hue[i] = hr;
        alpha[i] = 0.55 + Math.min(0.55, speed * 0.0016);
      } else if (tintT[i] > 0) {
        // temporary shimmer from rainbow blast (non-rainbow, non-holo only)
        tintT[i] = Math.max(0, tintT[i] - tintDecay);
        const blend = tintT[i]; // 0..1, fades smoothly back to normal
        tinted++;
        let hr = rainbowPhase + gp * 0.0026;
        hr -= Math.floor(hr);
        // blend rainbow hue toward normal as tint fades
        let hv = hueOffset + gp * hueByPos + speed * hueBySpeed;
        hv -= Math.floor(hv);
        const hn = hueLo + hv * hueSpan;
        hue[i] = hn + blend * (hr - hn);
        alpha[i] = 0.55 + Math.min(0.55, speed * 0.0016) + blend * 0.08;
      } else {
        let hv = hueOffset + gp * hueByPos + speed * hueBySpeed;
        hv -= Math.floor(hv);
        hue[i] = hueLo + hv * hueSpan;
        alpha[i] = 0.55 + Math.min(0.55, speed * 0.0016);
      }

      let a = angle[i] + dSpin;
      if (a > Math.PI * 2) a -= Math.PI * 2;
      angle[i] = a;
    }
    this.avgSpeed = sumSpeed / n;
    this.tintedCount = tinted;
    this.holoCount = holos;
    perf.end("integrate");

    perf.begin("walls");
    resolveWalls(
      px, py, vx, vy, n,
      this.w, this.h,
      config.restitution, config.wallFriction, config.wallKick,
      this.events, 8
    );
    perf.end("walls");

    const sep = config.separation;
    this.stepCounter++;
    const runSep = sep.enabled && n <= sep.maxCount && this.stepCounter % config.runtime.sepEveryN === 0;
    if (runSep) {
      perf.begin("grid");
      this.grid.build(px, py, n, this.w, this.h);
      perf.end("grid");
      perf.begin("separation");
      resolveSeparation(
        this.grid, px, py, vx, vy, n,
        sep.radius, sep.correction, sep.damping, sep.maxNeighbors,
        this.events, 14,
        this.stepCounter & 511
      );
      perf.end("separation");
    }
  }

  drainEvents(): SimEvent[] {
    if (this.events.length === 0) return this.events;
    const out = this.events;
    this.events = [];
    return out;
  }
}
