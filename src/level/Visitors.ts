// Peaceful visitors: rainbow blasts and shooting stars (toy + Journey), plus shape
// visitors — roaming atom/halo/tetrahedron particle formations that drift across the
// toy field and break apart on-screen (toy only).
// No economy logic here — Game.ts adds the Journey point bonus from system.tintedCount.

import { config } from "../config";
import type { CpuParticleSystem } from "../sim/CpuParticleSystem";
import {
  computeFormationSlots, driveFormation,
  FORMATION_BASE_SIZE, FORMATION_FOLLOW, FORMATION_SPIN,
  type FormationPattern,
} from "./formations";

type VisitorKind = "rainbow" | "star";

// A roaming particle-art formation that drifts across the toy field, then breaks apart
// on-screen so the player can watch the shape disperse into loose particles.
interface ShapeVisitor {
  pattern: FormationPattern;
  id: number;       // artId tag for this formation's particles
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  angle: number;
  breakX: number;   // x position at which the formation breaks apart
}

// artId base for shape visitors, kept well clear of the sandbox editor's ids.
const SHAPE_ID_BASE = 1_000_000;
const SHAPE_PATTERNS: FormationPattern[] = ["atom", "ring", "triangle"];

interface ActiveVisitor {
  kind: VisitorKind;
  x: number;
  y: number;
  dx: number;
  dy: number;
  speed: number;
  el: HTMLDivElement;
  life: number;
  elapsed: number;
  arrived: boolean;
  destX: number;
  destY: number;
  rippleTimer: number; // for rainbow: countdown to next CSS ripple ring (s)
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class Visitors {
  private active: ActiveVisitor[] = [];
  private shapes: ShapeVisitor[] = [];
  private rainbowTimer: number;
  private starTimer: number;
  private shapeTimer: number;
  private infectTimer = 0;
  private nextShapeId = SHAPE_ID_BASE;

  constructor(
    private readonly parent: HTMLElement,
    private readonly system: CpuParticleSystem
  ) {
    // First appearances are deliberately late — these are rare delights, not tutorials.
    // Minimum ~90s for rainbow, ~140s for star, so new players are settled before they appear.
    this.rainbowTimer = rand(90, 160);
    this.starTimer = rand(140, 220);
    this.shapeTimer = rand(25, 50);
  }

  update(dt: number, allowShapes = false): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const v = config.visitors;

    if (allowShapes) {
      this.shapeTimer -= dt;
      if (this.shapeTimer <= 0) {
        this.spawnShape(w, h);
        this.shapeTimer = rand(v.shapeEvery[0], v.shapeEvery[1]);
      }
    }
    this.updateShapes(dt);

    this.rainbowTimer -= dt;
    if (this.rainbowTimer <= 0 && this.system.count > 15) {
      this.spawnRainbow(w, h);
      this.rainbowTimer = rand(v.rainbowBlastEvery[0], v.rainbowBlastEvery[1]);
    }

    this.starTimer -= dt;
    if (this.starTimer <= 0 && this.system.count > 8) {
      this.spawnStar(w, h);
      this.starTimer = rand(v.shootingStarEvery[0], v.shootingStarEvery[1]);
    }

    // holographic spread: slow wave from each holo particle outward
    if (this.system.holoCount > 0) {
      this.infectTimer -= dt;
      if (this.infectTimer <= 0) {
        this.system.infectHolo(v.infectRadius, v.infectPerFrame);
        this.infectTimer = v.infectEvery;
      }
    }

    for (let k = this.active.length - 1; k >= 0; k--) {
      const vis = this.active[k];
      vis.elapsed += dt;

      if (vis.kind === "rainbow") {
        vis.x += vis.dx * dt;
        vis.y += vis.dy * dt;
        vis.el.style.left = `${vis.x}px`;
        vis.el.style.top = `${vis.y}px`;
        this.system.tintNear(vis.x, vis.y, v.tintRadius);

        // spawn an expanding CSS ripple ring along the trail
        vis.rippleTimer -= dt;
        if (vis.rippleTimer <= 0) {
          this.spawnRipple(vis.x, vis.y);
          vis.rippleTimer = v.tintRippleEvery;
        }

        if (vis.elapsed >= vis.life) {
          vis.el.remove();
          this.active.splice(k, 1);
        }
      } else {
        // star: fly to dest, land, then exit upward
        if (!vis.arrived) {
          const ddx = vis.destX - vis.x;
          const ddy = vis.destY - vis.y;
          const dist = Math.hypot(ddx, ddy);
          if (dist < 18) {
            // arrived — birth holographic particles at landing
            this.system.makeHoloNear(vis.destX, vis.destY, 42);
            vis.arrived = true;
            vis.el.classList.add("visitor-star--land");
            // exit heading: mostly upward with a small drift
            const ex = (Math.random() - 0.5) * 0.5;
            const ey = -1;
            const em = Math.hypot(ex, ey);
            vis.dx = (ex / em) * v.shootingStarSpeed * 1.3;
            vis.dy = (ey / em) * v.shootingStarSpeed * 1.3;
          } else {
            vis.x += (ddx / dist) * vis.speed * dt;
            vis.y += (ddy / dist) * vis.speed * dt;
          }
          vis.el.style.left = `${vis.x}px`;
          vis.el.style.top = `${vis.y}px`;
        } else {
          vis.x += vis.dx * dt;
          vis.y += vis.dy * dt;
          vis.el.style.left = `${vis.x}px`;
          vis.el.style.top = `${vis.y}px`;
        }
        if (vis.elapsed >= vis.life) {
          vis.el.remove();
          this.active.splice(k, 1);
        }
      }
    }
  }

  // ---- shape visitors ----

  private spawnShape(w: number, h: number): void {
    const v = config.visitors;
    const pattern = SHAPE_PATTERNS[Math.floor(Math.random() * SHAPE_PATTERNS.length)];
    const r = rand(v.shapeRadius[0], v.shapeRadius[1]);
    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? -r : w + r;
    const y = rand(h * 0.3, h * 0.7);
    const vx = (fromLeft ? 1 : -1) * v.shapeSpeed;
    const vy = rand(-12, 12);
    const breakX = rand(w * 0.4, w * 0.6);
    const id = this.nextShapeId++;

    // Spawn exactly one particle per orbit slot and tag each with this formation's id + slot.
    const slotCount = computeFormationSlots(x, y, r, 0, pattern).length;
    const oldCount = this.system.count;
    this.system.spawnBurst(x, y, { count: slotCount, speed: 10, speedJitter: 20 });
    for (let i = oldCount; i < this.system.count; i++) {
      this.system.artId[i] = id;
      this.system.artSlot[i] = i - oldCount;
    }

    this.shapes.push({ pattern, id, x, y, vx, vy, r, angle: 0, breakX });
  }

  private updateShapes(dt: number): void {
    for (let k = this.shapes.length - 1; k >= 0; k--) {
      const s = this.shapes[k];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.angle += FORMATION_SPIN * dt;

      const slots = computeFormationSlots(s.x, s.y, s.r, s.angle, s.pattern);
      driveFormation(this.system, s.id, slots, FORMATION_FOLLOW, dt);

      // Break apart once it has drifted into the field — before reaching the far edge.
      const reached = s.vx > 0 ? s.x >= s.breakX : s.x <= s.breakX;
      if (reached) {
        this.breakdownShape(s);
        this.shapes.splice(k, 1);
      }
    }
  }

  /** Pop the formation's particles outward and untag them, so the shape disperses. */
  private breakdownShape(s: ShapeVisitor): void {
    const { artId, artSlot, px, py, vx, vy, size, alpha, count } = this.system;
    const burst = config.visitors.shapeBurstSpeed;
    for (let i = 0; i < count; i++) {
      if (artId[i] !== s.id) continue;
      let dx = px[i] - s.x, dy = py[i] - s.y;
      let d = Math.hypot(dx, dy);
      if (d < 1) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
      const pop = burst * (0.6 + Math.random() * 0.8);
      vx[i] = (dx / d) * pop + s.vx * 0.4 + rand(-40, 40);
      vy[i] = (dy / d) * pop + s.vy * 0.4 + rand(-40, 40);
      artId[i] = -1;
      artSlot[i] = -1;
      size[i] = FORMATION_BASE_SIZE;
      alpha[i] = 1;
    }
  }

  /** Dissolve every in-flight shape (e.g. on a mode change). */
  releaseShapes(): void {
    for (const s of this.shapes) this.breakdownShape(s);
    this.shapes.length = 0;
  }

  /** Spawn a short-lived expanding ring at (x, y) along the rainbow trail. */
  private spawnRipple(x: number, y: number): void {
    const ring = document.createElement("div");
    ring.className = "ripple-ring";
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    this.parent.appendChild(ring);
    // auto-remove after the animation completes
    ring.addEventListener("animationend", () => ring.remove(), { once: true });
  }

  private spawnRainbow(w: number, h: number): void {
    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? -18 : w + 18;
    const y = rand(h * 0.2, h * 0.8);
    const el = document.createElement("div");
    el.className = "visitor visitor-rainbow";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (!fromLeft) el.style.transform = "scaleX(-1)";
    this.parent.appendChild(el);
    const speed = config.visitors.rainbowBlastSpeed;
    const life = (w + 40) / speed;
    this.active.push({
      kind: "rainbow", x, y,
      dx: fromLeft ? speed : -speed, dy: 0,
      speed, el, life, elapsed: 0,
      arrived: false, destX: x, destY: y,
      rippleTimer: config.visitors.tintRippleEvery * 0.5, // first ring comes quickly
    });
  }

  private spawnStar(w: number, h: number): void {
    const x = rand(w * 0.2, w * 0.8);
    const y = -28;
    const destX = rand(w * 0.25, w * 0.75);
    const destY = rand(h * 0.25, h * 0.65);
    const el = document.createElement("div");
    el.className = "visitor visitor-star";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.parent.appendChild(el);
    const speed = config.visitors.shootingStarSpeed;
    const distToDest = Math.hypot(destX - x, destY - y);
    const life = distToDest / speed + 2.5 + (h / speed); // travel + linger + exit
    this.active.push({
      kind: "star", x, y,
      dx: 0, dy: speed, // overridden on arrival
      speed, el, life, elapsed: 0,
      arrived: false, destX, destY,
      rippleTimer: 0,
    });
  }

  destroy(): void {
    for (const v of this.active) v.el.remove();
    this.active.length = 0;
    this.releaseShapes();
  }
}
