// Schedules special particles, shows the incoming edge alert (with a directional arrow)
// + countdown, runs each special's lifecycle (enter -> roam/bounce -> [vulnerable] ->
// leave), applies its effects to the swarm, handles blast-to-unlock, and records
// discoveries. Game mode only.

import { config } from "../config";
import type { CpuParticleSystem } from "../sim/CpuParticleSystem";
import type { ForcePoint } from "../sim/ParticleSystem";
import type { Save } from "../save/Save";
import { Alert } from "../ui/Alert";
import { DEFS, type SpecialDef } from "./defs";
import { destroyRadius, effectForce } from "./effects";
import { TIERS } from "./Rarity";

type Phase = "enter" | "roam" | "leave";

interface Active {
  def: SpecialDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: Phase;
  timeLeft: number;
  fed: number; // particles consumed so far (blast specials)
  el: HTMLDivElement;
  countEl: HTMLDivElement;
  hpEl: HTMLDivElement | null; // satiation bar fill (blast specials only)
}

const ROAM_MARGIN = 30; // px from the real screen edge where specials bounce

export interface SpecialEvents {
  onDiscover?: (def: SpecialDef, isNew: boolean) => void;
  onArrive?: (x: number, y: number) => void;
}

export class SpecialManager {
  active: Active[] = [];
  private pending: { def: SpecialDef; alert: Alert; lead: number; ex: number; ey: number } | null = null;
  private cooldown = config.specials.firstDelaySec;
  private enabled = false;
  private forces: ForcePoint[] = [];

  constructor(
    private readonly parent: HTMLElement,
    private readonly system: CpuParticleSystem,
    private readonly save: Save,
    private readonly events: SpecialEvents = {}
  ) {}

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.reset();
  }

  isBusy(): boolean {
    return this.pending !== null || this.active.length > 0;
  }

  /** Force the next special to be scheduled immediately with a custom alert lead. */
  requestNow(lead: number): void {
    if (!this.enabled || this.isBusy()) return;
    this.schedule(lead);
  }

  reset(): void {
    for (const a of this.active) a.el.remove();
    this.active.length = 0;
    if (this.pending) {
      this.pending.alert.remove();
      this.pending = null;
    }
    this.cooldown = config.specials.firstDelaySec;
    this.forces.length = 0;
  }

  /** Update lifecycle; returns force points to merge into the sim this frame. */
  update(dt: number): ForcePoint[] {
    this.forces.length = 0;
    if (!this.enabled) return this.forces;

    this.tickSchedule(dt);
    this.tickPending(dt);
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (!this.tickActive(this.active[i], dt)) {
        this.active[i].el.remove();
        this.active.splice(i, 1);
        this.cooldown = this.randInterval();
      }
    }
    return this.forces;
  }

  // ---- scheduling ----
  private tickSchedule(dt: number): void {
    if (this.pending || this.active.length) return;
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    // don't drop a visitor into a tiny swarm (it would eat the whole field); wait for it to grow
    if (this.system.count < config.specials.minParticles) {
      this.cooldown = 2;
      return;
    }
    this.schedule();
  }

  private randInterval(): number {
    const s = config.specials;
    return s.intervalMin + Math.random() * (s.intervalMax - s.intervalMin);
  }

  private schedule(leadOverride?: number): void {
    const def = this.pickDef();
    const w = window.innerWidth;
    const h = window.innerHeight;
    // entry point on a random edge
    const edge = (Math.random() * 4) | 0;
    let ex = 0;
    let ey = 0;
    if (edge === 0) { ex = Math.random() * w; ey = -20; }
    else if (edge === 1) { ex = w + 20; ey = Math.random() * h; }
    else if (edge === 2) { ex = Math.random() * w; ey = h + 20; }
    else { ex = -20; ey = Math.random() * h; }

    const tier = TIERS[def.tier];
    const known = this.save.isDiscovered(def.id);
    // entry angle: heading inward toward the screen centre (shows how it'll fly in)
    const angle = (Math.atan2(h / 2 - ey, w / 2 - ex) * 180) / Math.PI;
    const alert = new Alert(this.parent, {
      x: ex,
      y: ey,
      color: tier.color,
      holo: tier.holo,
      glyph: def.glyph,
      known,
      angle,
    });
    this.pending = { def, alert, lead: leadOverride ?? config.specials.alertLeadSec, ex, ey };
  }

  private pickDef(): SpecialDef {
    let total = 0;
    for (const d of DEFS) total += TIERS[d.tier].weight;
    let r = Math.random() * total;
    for (const d of DEFS) {
      r -= TIERS[d.tier].weight;
      if (r <= 0) return d;
    }
    return DEFS[0];
  }

  // ---- pending (alert countdown) ----
  private tickPending(dt: number): void {
    const p = this.pending;
    if (!p) return;
    p.lead -= dt;
    p.alert.setCountdown(p.lead);
    p.alert.update(dt);
    if (p.lead <= 0) {
      p.alert.remove();
      this.pending = null;
      this.spawn(p.def, p.ex, p.ey);
    }
  }

  private spawn(def: SpecialDef, ex: number, ey: number): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const tier = TIERS[def.tier];

    const isBlast = def.behavior === "blast";
    const el = document.createElement("div");
    el.className = `special tier-${def.tier} special-${def.id}` + (tier.holo ? " holo" : "") + (isBlast ? " blast" : "");
    el.style.setProperty("--c", tier.color);
    el.innerHTML =
      `<div class="special-ring"></div><div class="special-core">${def.glyph}</div>` +
      (isBlast ? `<div class="special-hp"><div class="special-hp-fill"></div></div>` : "") +
      `<div class="special-count"></div>`;
    this.parent.appendChild(el);
    const countEl = el.querySelector(".special-count") as HTMLDivElement;
    const hpEl = el.querySelector(".special-hp-fill") as HTMLDivElement | null;

    // head inward toward the centre region; it'll start bouncing once fully on-screen
    const tx = w * (0.3 + Math.random() * 0.4);
    const ty = h * (0.3 + Math.random() * 0.4);
    const ang = Math.atan2(ty - ey, tx - ex);
    const sp = config.specials.flySpeed;

    this.active.push({
      def,
      x: ex,
      y: ey,
      vx: Math.cos(ang) * sp,
      vy: Math.sin(ang) * sp,
      phase: "enter",
      timeLeft: def.lingerSec,
      fed: 0,
      el,
      countEl,
      hpEl,
    });

    // roam specials are discovered on sight; blast specials must be destroyed to unlock
    if (def.behavior !== "blast") {
      const isNew = this.save.discover(def.id);
      this.events.onDiscover?.(def, isNew);
    }
    this.events.onArrive?.(ex, ey);
  }

  // ---- active lifecycle ---- returns false when finished
  private tickActive(a: Active, dt: number): boolean {
    const w = window.innerWidth;
    const h = window.innerHeight;

    switch (a.phase) {
      case "enter": {
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        this.applyEffects(a);
        this.renderView(a, "");
        // once fully inside the play area, start roaming/bouncing
        if (a.x > ROAM_MARGIN && a.x < w - ROAM_MARGIN && a.y > ROAM_MARGIN && a.y < h - ROAM_MARGIN) {
          a.phase = "roam";
          a.timeLeft = a.def.lingerSec;
        }
        // failsafe: never let it sail off during entry
        return a.x > -240 && a.x < w + 240 && a.y > -240 && a.y < h + 240;
      }
      case "roam": {
        this.bounce(a, w, h);
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        a.timeLeft -= dt;
        this.applyEffects(a);

        if (a.def.behavior === "blast") {
          // feed it: it consumes nearby particles (capped rate); satisfy its appetite to unlock
          const appetite = a.def.appetite ?? 1;
          const maxEat = Math.ceil(config.specials.eatPerSec * dt);
          a.fed += this.system.consumeNear(a.x, a.y, config.specials.hitRadius, maxEat);
          const frac = Math.min(1, a.fed / appetite);
          if (a.hpEl) a.hpEl.style.width = `${frac * 100}%`; // satiation fills up
          a.el.style.setProperty("--fed", String(frac));
          this.renderView(a, `${Math.ceil(Math.max(0, a.timeLeft))}`);
          if (a.fed >= appetite) {
            const isNew = this.save.discover(a.def.id); // satisfied -> unlock
            this.events.onDiscover?.(a.def, isNew);
            this.burst(a.x, a.y); // celebratory pop
            return false;
          }
          if (a.timeLeft <= 0) this.startLeaving(a, w, h); // left un-unlocked
        } else {
          this.renderView(a, `${Math.ceil(Math.max(0, a.timeLeft))}`);
          if (a.timeLeft <= 0) this.startLeaving(a, w, h);
        }
        break;
      }
      case "leave": {
        a.x += a.vx * dt;
        a.y += a.vy * dt;
        this.renderView(a, "");
        const off = 90;
        return a.x > -off && a.x < w + off && a.y > -off && a.y < h + off;
      }
    }
    return true;
  }

  /** Reflect velocity at the roam margins so the special bounces around in frame. */
  private bounce(a: Active, w: number, h: number): void {
    if (a.x < ROAM_MARGIN && a.vx < 0) a.vx = -a.vx;
    else if (a.x > w - ROAM_MARGIN && a.vx > 0) a.vx = -a.vx;
    if (a.y < ROAM_MARGIN && a.vy < 0) a.vy = -a.vy;
    else if (a.y > h - ROAM_MARGIN && a.vy > 0) a.vy = -a.vy;
  }

  private startLeaving(a: Active, w: number, h: number): void {
    a.phase = "leave";
    // aim for the nearest edge
    const left = a.x;
    const right = w - a.x;
    const top = a.y;
    const bottom = h - a.y;
    const min = Math.min(left, right, top, bottom);
    let dx = 0;
    let dy = 0;
    if (min === left) dx = -1;
    else if (min === right) dx = 1;
    else if (min === top) dy = -1;
    else dy = 1;
    const sp = config.specials.flySpeed * 1.4;
    a.vx = dx * sp;
    a.vy = dy * sp;
  }

  private applyEffects(a: Active): void {
    for (const e of a.def.effects) {
      if (e.kind === "destroy") {
        const r = destroyRadius(e);
        if (r > 0) this.system.eraseNear(a.x, a.y, r);
      } else {
        const f = effectForce(e, a.x, a.y);
        if (f) this.forces.push(f);
      }
    }
  }

  /** Celebratory outward pop of particles when a special is destroyed. */
  private burst(x: number, y: number): void {
    this.system.spawnBurst(x, y, { count: 70, speed: 260, speedJitter: 120 });
  }

  private renderView(a: Active, count: string): void {
    a.el.style.transform = `translate(${a.x}px, ${a.y}px) translate(-50%, -50%)`;
    a.countEl.textContent = count;
  }
}
