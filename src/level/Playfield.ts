// Dynamic playfield: objects appear, change, and expire over time rather than being a
// fixed layout. An obstacle relocates/retypes periodically; portals come and go; and
// destructible "buff targets" spawn that you bombard with particles to earn a power-up.
// Particles are simulated in WebGL; these objects are DOM overlays + sim-side interaction.

import type { CpuParticleSystem } from "../sim/CpuParticleSystem";
import { makeTriangle, resolveShape, type Shape } from "./shapes";

interface Portal {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  el: HTMLDivElement;
}

interface Obstacle {
  shape: Shape;
  el: HTMLDivElement;
}

interface Target {
  x: number;
  y: number;
  r: number;
  hp: number;
  hpMax: number;
  life: number; // seconds until it leaves
  el: HTMLDivElement;
  hpEl: HTMLDivElement;
  shapeEl: HTMLDivElement;
}

const OBSTACLE_RESTITUTION = 0.7;

// timing windows (seconds)
const OBSTACLE_CHANGE = [20, 32] as const;
const PORTAL_FIRST = 60;          // countdown starts only after level/count gate is met
const PORTAL_ON = [22, 30] as const;
const PORTAL_OFF = [16, 28] as const;
const TARGET_FIRST = 90;          // buff targets come later still
const TARGET_EVERY = [28, 46] as const;
const TARGET_LIFE = 16;

// minimum thresholds before portals / buff targets can appear
const PORTAL_MIN_LEVEL = 3;
const PORTAL_MIN_COUNT = 300;
const TARGET_MIN_LEVEL = 5;
const TARGET_MIN_COUNT = 500;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class Playfield {
  private portal: Portal | null = null;
  private obstacle: Obstacle | null = null;
  private targets: Target[] = [];
  private enabled = false;
  private tutorial = false; // tutorial mode: one static obstacle only — no portals, targets, or reshaping
  private levelGate = false; // when true, portal/target timers only count down once level/count thresholds are met

  private obstacleTimer = 0;
  private portalTimer = 0;
  private portalOn = false;
  private targetTimer = 0;

  throughput = 0; // particles teleported since last read

  constructor(
    private readonly parent: HTMLElement,
    private readonly system: CpuParticleSystem,
    private readonly onTargetCleared: () => void = () => {}
  ) {}

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) this.build();
    else this.clear();
  }

  /** Tutorial mode shows only a single static obstacle; portals/targets/reshaping are held back.
   *  Turning it off re-seeds the portal/target timers so they don't all fire at once. */
  setTutorial(on: boolean): void {
    this.tutorial = on;
    if (!on) {
      this.levelGate = true; // gate portals/targets by level for the rest of this session
      this.portalTimer = PORTAL_FIRST;
      this.targetTimer = TARGET_FIRST;
      this.obstacleTimer = rand(...OBSTACLE_CHANGE);
    }
  }

  private clear(): void {
    this.portal?.el.remove();
    this.obstacle?.el.remove();
    for (const t of this.targets) t.el.remove();
    this.portal = null;
    this.obstacle = null;
    this.targets.length = 0;
    this.portalOn = false;
  }

  /** Start state: one obstacle, no portal yet, target/portal scheduled for later. */
  private build(): void {
    this.clear();
    this.relocateObstacle();
    this.obstacleTimer = rand(...OBSTACLE_CHANGE);
    this.portalTimer = PORTAL_FIRST;
    this.targetTimer = TARGET_FIRST;
  }

  relayout(): void {
    if (this.enabled) this.build();
  }

  // ---- obstacle ----
  private relocateObstacle(): void {
    this.obstacle?.el.remove();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = rand(w * 0.2, w * 0.8);
    const y = rand(h * 0.25, h * 0.7);
    const r = rand(44, 64);
    const circle = Math.random() < 0.5;
    const el = document.createElement("div");
    el.className = circle ? "obstacle obstacle-circle" : "obstacle obstacle-triangle";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty("--r", `${r * 2}px`);
    this.parent.appendChild(el);
    const shape: Shape = circle ? { kind: "circle", x, y, r } : makeTriangle(x, y, r);
    this.obstacle = { shape, el };
  }

  // ---- portals ----
  private spawnPortal(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const r = 46;
    const ax = rand(w * 0.12, w * 0.4);
    const ay = rand(h * 0.25, h * 0.75);
    const bx = rand(w * 0.6, w * 0.88);
    const by = rand(h * 0.25, h * 0.75);
    const el = document.createElement("div");
    el.className = "portal portal-spawn";
    el.innerHTML =
      `<div class="portal-end portal-in" style="left:${ax}px;top:${ay}px"></div>` +
      `<div class="portal-end portal-out" style="left:${bx}px;top:${by}px"></div>`;
    (el.querySelector(".portal-in") as HTMLDivElement).style.setProperty("--r", `${r * 2}px`);
    (el.querySelector(".portal-out") as HTMLDivElement).style.setProperty("--r", `${r * 2}px`);
    this.parent.appendChild(el);
    this.portal = { ax, ay, bx, by, r, el };
  }

  // ---- buff targets ----
  private spawnTarget(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = rand(w * 0.25, w * 0.75);
    const y = rand(h * 0.25, h * 0.7);
    const r = 38;
    const hp = 480;
    const el = document.createElement("div");
    el.className = "target";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty("--r", `${r * 2}px`);
    el.innerHTML =
      `<div class="target-shape"></div><div class="target-glyph">◎</div>` +
      `<div class="target-hp"><div class="target-hp-fill"></div></div>`;
    this.parent.appendChild(el);
    const hpEl = el.querySelector(".target-hp-fill") as HTMLDivElement;
    const shapeEl = el.querySelector(".target-shape") as HTMLDivElement;
    shapeEl.style.setProperty("--fill", "0");
    this.targets.push({ x, y, r, hp, hpMax: hp, life: TARGET_LIFE, el, hpEl, shapeEl });
  }

  /** Advance object lifecycles + apply interactions. Game mode only. */
  update(dt: number, level = 1, count = 0): void {
    if (!this.enabled) return;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // tutorial: just the single obstacle (no reshaping, portals, or targets)
    if (!this.tutorial) {
      // obstacle relocation/retype
      this.obstacleTimer -= dt;
      if (this.obstacleTimer <= 0) {
        this.relocateObstacle();
        this.obstacleTimer = rand(...OBSTACLE_CHANGE);
      }

      // portals cycle on/off — only count down once the player has a real swarm
      const portalReady = !this.levelGate || level >= PORTAL_MIN_LEVEL || count >= PORTAL_MIN_COUNT;
      if (portalReady) {
        this.portalTimer -= dt;
        if (this.portalTimer <= 0) {
          if (this.portalOn) {
            this.portal?.el.remove();
            this.portal = null;
            this.portalOn = false;
            this.portalTimer = rand(...PORTAL_OFF);
          } else {
            this.spawnPortal();
            this.portalOn = true;
            this.portalTimer = rand(...PORTAL_ON);
          }
        }
      }

      // buff targets — gated even later
      const targetReady = !this.levelGate || level >= TARGET_MIN_LEVEL || count >= TARGET_MIN_COUNT;
      if (targetReady) {
        this.targetTimer -= dt;
        if (this.targetTimer <= 0) {
          this.spawnTarget();
          this.targetTimer = rand(...TARGET_EVERY);
        }
      }
    }

    this.applyInteractions(w, h);
    this.updateTargets(dt);
  }

  private applyInteractions(_w: number, _h: number): void {
    const { px, py, vx, vy, count } = this.system;

    if (this.portal) {
      const p = this.portal;
      const r2 = p.r * p.r;
      let teleported = 0;
      for (let i = 0; i < count; i++) {
        const dx = px[i] - p.ax;
        const dy = py[i] - p.ay;
        if (dx * dx + dy * dy < r2) {
          // emerge from the exit and whoosh outward so the transport reads clearly
          const a = Math.random() * Math.PI * 2;
          const rr = Math.random() * p.r * 0.5;
          px[i] = p.bx + Math.cos(a) * rr;
          py[i] = p.by + Math.sin(a) * rr;
          vx[i] = Math.cos(a) * 190;
          vy[i] = Math.sin(a) * 190;
          this.throughput++;
          teleported++;
        }
      }
      p.el.classList.toggle("emitting", teleported > 0);
    }

    if (this.obstacle) {
      resolveShape(this.obstacle.shape, px, py, vx, vy, count, OBSTACLE_RESTITUTION);
    }
  }

  private updateTargets(dt: number): void {
    const px = this.system.px;
    const py = this.system.py;
    const count = this.system.count;
    for (let t = this.targets.length - 1; t >= 0; t--) {
      const tg = this.targets[t];
      tg.life -= dt;
      // count particles inside -> damage
      const r2 = tg.r * tg.r;
      let near = 0;
      for (let i = 0; i < count; i++) {
        const dx = px[i] - tg.x;
        const dy = py[i] - tg.y;
        if (dx * dx + dy * dy < r2) near++;
      }
      tg.hp -= near * dt;
      const fillFrac = Math.min(1, Math.max(0, 1 - tg.hp / tg.hpMax)); // 0 = untouched, 1 = done
      tg.hpEl.style.width = `${fillFrac * 100}%`; // bar fills left→right as target is fed
      tg.shapeEl.style.setProperty("--fill", fillFrac.toFixed(3));

      if (tg.hp <= 0) {
        tg.el.classList.add("target-cleared");
        this.system.spawnBurst(tg.x, tg.y, { count: 70, speed: 240, speedJitter: 120 });
        this.removeTarget(t);
        this.onTargetCleared();
      } else if (tg.life <= 0) {
        this.removeTarget(t);
      }
    }
  }

  private removeTarget(i: number): void {
    this.targets[i].el.remove();
    this.targets.splice(i, 1);
  }

  takeThroughput(): number {
    const t = this.throughput;
    this.throughput = 0;
    return t;
  }
}
