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
}

const OBSTACLE_RESTITUTION = 0.7;

// timing windows (seconds)
const OBSTACLE_CHANGE = [20, 32] as const;
const PORTAL_FIRST = 18;
const PORTAL_ON = [22, 30] as const;
const PORTAL_OFF = [16, 28] as const;
const TARGET_FIRST = 22;
const TARGET_EVERY = [28, 46] as const;
const TARGET_LIFE = 16;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class Playfield {
  private portal: Portal | null = null;
  private obstacle: Obstacle | null = null;
  private targets: Target[] = [];
  private enabled = false;

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
    const r = 52;
    const hp = 800;
    const el = document.createElement("div");
    el.className = "target";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty("--r", `${r * 2}px`);
    el.innerHTML =
      `<div class="target-shape"></div><div class="target-glyph">⚡</div>` +
      `<div class="target-hp"><div class="target-hp-fill"></div></div>`;
    this.parent.appendChild(el);
    const hpEl = el.querySelector(".target-hp-fill") as HTMLDivElement;
    this.targets.push({ x, y, r, hp, hpMax: hp, life: TARGET_LIFE, el, hpEl });
  }

  /** Advance object lifecycles + apply interactions. Game mode only. */
  update(dt: number): void {
    if (!this.enabled) return;
    const w = window.innerWidth;
    const h = window.innerHeight;

    // obstacle relocation/retype
    this.obstacleTimer -= dt;
    if (this.obstacleTimer <= 0) {
      this.relocateObstacle();
      this.obstacleTimer = rand(...OBSTACLE_CHANGE);
    }

    // portals cycle on/off
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

    // buff targets
    this.targetTimer -= dt;
    if (this.targetTimer <= 0) {
      this.spawnTarget();
      this.targetTimer = rand(...TARGET_EVERY);
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
      tg.hpEl.style.width = `${Math.max(0, (tg.hp / tg.hpMax) * 100)}%`;

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
