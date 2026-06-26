// Peaceful visitors: rainbow blasts and shooting stars. Both run in toy and Journey.
// No economy logic here — Game.ts adds the Journey point bonus from system.tintedCount.

import { config } from "../config";
import type { CpuParticleSystem } from "../sim/CpuParticleSystem";

type VisitorKind = "rainbow" | "star";

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
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class Visitors {
  private active: ActiveVisitor[] = [];
  private rainbowTimer: number;
  private starTimer: number;
  private infectTimer = 0;

  constructor(
    private readonly parent: HTMLElement,
    private readonly system: CpuParticleSystem
  ) {
    // stagger so they don't both fire immediately on first entry
    this.rainbowTimer = rand(12, 25);
    this.starTimer = rand(20, 45);
  }

  update(dt: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const v = config.visitors;

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
        this.system.tintNear(vis.x, vis.y, v.tintRadius, v.tintDuration);
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
    });
  }

  destroy(): void {
    for (const v of this.active) v.el.remove();
    this.active.length = 0;
  }
}
