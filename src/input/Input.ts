// Unified pointer input (touch / mouse / pen, multi-touch). Each active pointer drives
// a tool: spawn, attract, repel, wind, or erase.

import { config } from "../config";
import type { AudioEngine, VoiceName } from "../audio/AudioEngine";
import type { Scheduler } from "../audio/Scheduler";
import type { ForcePoint, ParticleSystem } from "../sim/ParticleSystem";

export type Tool = "spawn" | "attract" | "repel" | "wind" | "erase";

interface Pointer {
  x: number;
  y: number;
  px: number; // previous (for velocity)
  py: number;
  spawnAcc: number;
}

export class Input {
  tool: Tool = "spawn";
  burstSize = config.spawn.burst; // overridden by game progression
  streamRate = config.spawn.streamPerSec;
  attractMult = 1; // overridden per-frame by GameState in game mode
  /** Optional gate: given a requested spawn count, returns how many are allowed
   *  (after capacity + energy), consuming resources. null = unlimited (sandbox). */
  gate: ((requested: number) => number) | null = null;

  private pointers = new Map<number, Pointer>();
  private forcePoints: ForcePoint[] = [];
  private toolSoundTimer = 0; // ms throttle for continuous-tool sounds

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly system: ParticleSystem,
    private readonly engine: AudioEngine,
    private readonly scheduler: Scheduler,
    private readonly getSize: () => [number, number],
    private readonly onFirstInteract: () => void
  ) {
    canvas.addEventListener("pointerdown", this.onDown, { passive: false });
    canvas.addEventListener("pointermove", this.onMove, { passive: false });
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private toLocal(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private onDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.engine.init();
    this.engine.resume();
    this.onFirstInteract();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic/edge-case pointers may not be capturable */
    }

    const [x, y] = this.toLocal(e);
    this.pointers.set(e.pointerId, { x, y, px: x, py: y, spawnAcc: 0 });

    if (this.tool === "spawn") {
      const n = this.gate ? this.gate(this.burstSize) : this.burstSize;
      if (n > 0) {
        this.system.spawnBurst(x, y, { count: n });
        this.sound("spawn", x, y, 0.8);
      }
    } else {
      this.toolSoundTimer = 0; // sound immediately on press for non-spawn tools
    }
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    const [x, y] = this.toLocal(e);
    p.x = x;
    p.y = y;
  };

  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
  };

  /** Called once per fixed step: translate active pointers into forces / spawns. */
  update(dt: number): void {
    const fp = this.forcePoints;
    fp.length = 0;
    this.toolSoundTimer -= dt * 1000;

    for (const p of this.pointers.values()) {
      switch (this.tool) {
        case "spawn": {
          p.spawnAcc += this.streamRate * dt;
          const req = p.spawnAcc | 0;
          if (req > 0) {
            p.spawnAcc -= req;
            const n = this.gate ? this.gate(req) : req;
            if (n > 0) {
              this.system.spawnBurst(p.x, p.y, { count: n, speed: 40, speedJitter: 50 });
              if (Math.random() < 0.22) this.sound("spawn", p.x, p.y, 0.55);
            }
          }
          break;
        }
        case "attract":
          fp.push(this.radial(p.x, p.y, config.pointer.attract * this.attractMult));
          this.maybeToolSound("attract", p.x, p.y, 0.5);
          break;
        case "repel":
          fp.push(this.radial(p.x, p.y, -config.pointer.repel));
          this.maybeToolSound("repel", p.x, p.y, 0.5);
          break;
        case "wind": {
          const vx = (p.x - p.px) / dt;
          const vy = (p.y - p.py) / dt;
          const sp = Math.hypot(vx, vy);
          if (sp > 1) {
            fp.push({
              kind: "directional",
              x: p.x,
              y: p.y,
              radius: config.pointer.radius,
              strength: Math.min(6000, sp * config.pointer.wind),
              dirX: vx / sp,
              dirY: vy / sp,
            });
            this.maybeToolSound("wind", p.x, p.y, Math.min(1, sp / 600));
          }
          break;
        }
        case "erase":
          this.system.eraseNear(p.x, p.y, config.pointer.eraseRadius);
          this.maybeToolSound("erase", p.x, p.y, 0.4);
          break;
      }
      p.px = p.x;
      p.py = p.y;
    }
  }

  /** Force points from active pointers this frame (merged with specials by Game). */
  getForces(): ForcePoint[] {
    return this.forcePoints;
  }

  private radial(x: number, y: number, strength: number): ForcePoint {
    return { kind: "radial", x, y, radius: config.pointer.radius, strength, dirX: 0, dirY: 0 };
  }

  /** Throttled sound for continuous tools (one per throttle window across all pointers). */
  private maybeToolSound(voice: VoiceName, x: number, y: number, intensity: number): void {
    if (this.toolSoundTimer > 0) return;
    this.toolSoundTimer = config.audio.toolSoundEveryMs;
    this.sound(voice, x, y, intensity);
  }

  private sound(voice: VoiceName, x: number, y: number, intensity: number): void {
    const [w, h] = this.getSize();
    this.scheduler.request(voice, {
      pan: (x / w) * 2 - 1,
      register: 1 - y / h,
      intensity,
    });
  }
}
