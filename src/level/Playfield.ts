// Dynamic playfield: portals cycle on/off; destructible buff targets spawn periodically;
// a compact thin-line maze with a buff target inside appears at higher levels.
// Particles are simulated in WebGL; these objects are DOM overlays + sim-side interaction.

import type { CpuParticleSystem } from "../sim/CpuParticleSystem";
import { makeWall, resolveShape, type Shape } from "./shapes";

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
  life: number;
  el: HTMLDivElement;
  hpEl: HTMLDivElement;
  shapeEl: HTMLDivElement;
}

const OBSTACLE_RESTITUTION = 0.7;

const PORTAL_FIRST = 60;
const PORTAL_ON = [22, 30] as const;
const PORTAL_OFF = [16, 28] as const;
const TARGET_FIRST = 90;
const TARGET_EVERY = [28, 46] as const;
const TARGET_LIFE = 16;
const MAZE_FIRST = 120;
const MAZE_ON = [30, 45] as const;
const MAZE_OFF = [20, 35] as const;

const PORTAL_MIN_LEVEL = 3;
const PORTAL_MIN_COUNT = 300;
const TARGET_MIN_LEVEL = 5;
const TARGET_MIN_COUNT = 500;
const MAZE_MIN_LEVEL = 7;
const MAZE_MIN_COUNT = 600;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class Playfield {
  private portal: Portal | null = null;
  private walls: Obstacle[] = [];
  private targets: Target[] = [];
  private enabled = false;
  private tutorial = false;
  private levelGate = false;

  private portalTimer = 0;
  private portalOn = false;
  private targetTimer = 0;
  private mazeTimer = 0;
  private mazeOn = false;

  throughput = 0;

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

  setTutorial(on: boolean): void {
    this.tutorial = on;
    if (!on) {
      this.levelGate = true;
      this.portalTimer = PORTAL_FIRST;
      this.targetTimer = TARGET_FIRST;
    }
  }

  setLevelGated(on: boolean): void {
    this.levelGate = on;
  }

  private clear(): void {
    this.portal?.el.remove();
    for (const w of this.walls) w.el.remove();
    for (const t of this.targets) t.el.remove();
    this.portal = null;
    this.walls.length = 0;
    this.targets.length = 0;
    this.portalOn = false;
    this.mazeOn = false;
  }

  private build(): void {
    this.clear();
    this.portalTimer = PORTAL_FIRST;
    this.targetTimer = TARGET_FIRST;
    this.mazeTimer = MAZE_FIRST;
  }

  relayout(): void {
    if (this.enabled) this.build();
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
      `<div class="portal-end portal-in" style="left:${ax}px;top:${ay}px">` +
        `<span class="portal-label">IN</span></div>` +
      `<div class="portal-end portal-out" style="left:${bx}px;top:${by}px">` +
        `<span class="portal-label">OUT</span></div>`;
    (el.querySelector(".portal-in") as HTMLDivElement).style.setProperty("--r", `${r * 2}px`);
    (el.querySelector(".portal-out") as HTMLDivElement).style.setProperty("--r", `${r * 2}px`);
    this.parent.appendChild(el);
    this.portal = { ax, ay, bx, by, r, el };
  }

  // ---- maze corridors ----
  /** Compact U-shape maze: two vertical arms + one horizontal base, with buff target inside. */
  private spawnMaze(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cx = rand(w * 0.28, w * 0.72);
    const cy = rand(h * 0.28, h * 0.58);
    const thick = 5;   // half-thickness of each wall (~10px visual)
    const arm = 65;    // half-height of the vertical arms
    const gap = 38;    // half-width of interior corridor

    // U opening upward: left arm, right arm, bottom connector
    const wallDefs: Array<[number, number, number, number]> = [
      [cx - gap - thick, cy, thick, arm],           // left arm
      [cx + gap + thick, cy, thick, arm],           // right arm
      [cx, cy + arm, gap + thick * 2 + thick, thick], // bottom connector
    ];

    for (const [wx, wy, hw, hh] of wallDefs) {
      const shape = makeWall(wx, wy, hw, hh);
      const el = document.createElement("div");
      el.className = "obstacle obstacle-wall";
      el.style.left = `${wx}px`;
      el.style.top = `${wy}px`;
      el.style.width = `${hw * 2}px`;
      el.style.height = `${hh * 2}px`;
      this.parent.appendChild(el);
      this.walls.push({ shape, el });
    }

    // buff target inside the U near the bottom
    this.spawnTargetAt(cx, cy + arm - 28);
  }

  private clearMaze(): void {
    for (const w of this.walls) w.el.remove();
    this.walls.length = 0;
  }

  // ---- buff targets ----
  private spawnTarget(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.spawnTargetAt(rand(w * 0.25, w * 0.75), rand(h * 0.25, h * 0.7));
  }

  private spawnTargetAt(x: number, y: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    x = Math.max(60, Math.min(w - 60, x));
    y = Math.max(60, Math.min(h - 120, y));
    const r = 26;
    const hp = 300;
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

  update(dt: number, level = 1, count = 0): void {
    if (!this.enabled) return;
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (!this.tutorial) {
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

      const targetReady = !this.levelGate || level >= TARGET_MIN_LEVEL || count >= TARGET_MIN_COUNT;
      if (targetReady) {
        this.targetTimer -= dt;
        if (this.targetTimer <= 0) {
          this.spawnTarget();
          this.targetTimer = rand(...TARGET_EVERY);
        }
      }

      const mazeReady = !this.levelGate || level >= MAZE_MIN_LEVEL || count >= MAZE_MIN_COUNT;
      if (mazeReady) {
        this.mazeTimer -= dt;
        if (this.mazeTimer <= 0) {
          if (this.mazeOn) {
            this.clearMaze();
            this.mazeOn = false;
            this.mazeTimer = rand(...MAZE_OFF);
          } else {
            this.spawnMaze();
            this.mazeOn = true;
            this.mazeTimer = rand(...MAZE_ON);
          }
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

    for (const wall of this.walls) {
      resolveShape(wall.shape, px, py, vx, vy, count, OBSTACLE_RESTITUTION);
    }
  }

  private updateTargets(dt: number): void {
    const px = this.system.px;
    const py = this.system.py;
    const count = this.system.count;
    for (let t = this.targets.length - 1; t >= 0; t--) {
      const tg = this.targets[t];
      tg.life -= dt;
      const r2 = tg.r * tg.r;
      let near = 0;
      for (let i = 0; i < count; i++) {
        const dx = px[i] - tg.x;
        const dy = py[i] - tg.y;
        if (dx * dx + dy * dy < r2) near++;
      }
      tg.hp -= near * dt;
      const fillFrac = Math.min(1, Math.max(0, 1 - tg.hp / tg.hpMax));
      tg.hpEl.style.width = `${fillFrac * 100}%`;
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
