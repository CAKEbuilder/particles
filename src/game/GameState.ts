// Runtime game state derived from the Save: heat throttle, on-screen capacity,
// points economy, level/XP, and permanent buff purchases. Game mode only.

import { config } from "../config";
import type { Save } from "../save/Save";
import type { PowerUps } from "./PowerUps";

export class GameState {
  heat = 0;   // 0..coolantCap; rises when spawning, falls when idle
  cooling = false; // locked out: too hot to spawn, waiting to cool
  onLevelUp: ((level: number) => void) | null = null;
  onLock: (() => void) | null = null; // fires when cooling starts (for haptics)
  onSpectrumUnlock: ((spectrum: number) => void) | null = null;
  private powerups: PowerUps | null = null;

  constructor(
    private readonly save: Save,
    private readonly hardCap: number
  ) {}

  setPowerUps(p: PowerUps): void {
    this.powerups = p;
  }

  // ---- derived stats ----
  get level(): number {
    return this.save.data.level;
  }
  get points(): number {
    return this.save.data.points;
  }
  private tier(id: string): number {
    return this.save.data.buffs[id] ?? 0;
  }
  private per(id: string): number {
    return config.game.buffs[id].per;
  }

  get maxCapacity(): number {
    const g = config.game;
    const base = g.baseCapacity + (this.level - 1) * g.capacityPerLevel + this.tier("capacity") * this.per("capacity");
    const v = base * (this.powerups?.capacityMult() ?? 1);
    return Math.min(this.hardCap, Math.floor(v));
  }

  /** Overheat threshold: base 1.0, raised by Coolant buff (each tier adds 0.25). */
  get coolantCap(): number {
    return 1 + this.tier("coolant") * this.per("coolant");
  }

  get pointMult(): number {
    return (
      (1 + this.tier("pointMult") * this.per("pointMult")) *
      (this.powerups?.pointMult() ?? 1) *
      this.ascensionMult
    );
  }

  /** Per-particle points/sec including the movement bonus. */
  pointRate(avgSpeed: number): number {
    const g = config.game;
    const motion = Math.min(1, avgSpeed / g.movementRefSpeed);
    return g.pointRatePerParticle * (1 + g.movementBonus * motion) * this.pointMult;
  }

  get ascensionMult(): number {
    return 1 + this.save.data.ascension * config.game.ascendBonus;
  }
  get ascension(): number {
    return this.save.data.ascension;
  }
  canAscend(): boolean {
    return this.save.data.level >= config.game.ascendLevel;
  }

  ascend(): number {
    if (!this.canAscend()) return -1;
    this.save.data.ascension++;
    this.save.data.level = 1;
    this.save.data.points = 0;
    this.save.data.totalPoints = 0;
    this.save.data.buffs = {};
    this.heat = 0;
    this.cooling = false;
    this.save.persist();
    return this.save.data.ascension;
  }

  get burstSize(): number {
    const g = config.game;
    const base = g.burstBase + (this.level - 1) * g.burstPerLevel + this.tier("burst") * this.per("burst");
    return Math.floor(base * (this.powerups?.burstMult() ?? 1));
  }

  get attractMult(): number {
    return 1;
  }

  /** Hue band [lo,hi] the gradient maps into. */
  spectrumBand(): [number, number] {
    const t = (this.save.data.spectrum - 1) / Math.max(1, config.spectrumMax - 1);
    const center = 0.18;
    return [(1 - t) * center, (1 - t) * center + t];
  }

  /** Gate for Input: allow as many of `requested` as heat + capacity permit.
   *  While cooling, spawning is blocked until heat drops back to resetThreshold. */
  tryConsumeSpawn(requested: number, liveCount: number): number {
    const h = config.game.heat;
    if (this.cooling) {
      if (this.heat <= h.resetThreshold) this.cooling = false;
      else return 0;
    }
    const capRemaining = this.maxCapacity - liveCount;
    if (capRemaining <= 0) return 0;
    const allowed = Math.min(requested, capRemaining);
    this.heat = Math.min(this.coolantCap, this.heat + allowed * h.heatPerParticle);
    if (this.heat >= this.coolantCap) {
      this.cooling = true;
      this.onLock?.();
    }
    return allowed;
  }

  /** Per-frame: cool heat, accrue points from live particles, handle level-ups. */
  update(dt: number, liveCount: number, avgSpeed = 0): void {
    this.heat = Math.max(0, this.heat - config.game.heat.coolPerSec * dt);

    const gained = liveCount * this.pointRate(avgSpeed) * dt;
    if (gained > 0) {
      this.save.data.points += gained;
      this.save.data.totalPoints += gained;
      while (this.save.data.totalPoints >= this.cumNeed(this.level + 1)) {
        this.save.data.level++;
        if (this.onLevelUp) this.onLevelUp(this.save.data.level);
        if (
          this.save.data.level % config.spectrumUnlockEvery === 0 &&
          this.save.data.spectrum < config.spectrumMax
        ) {
          this.save.data.spectrum++;
          this.onSpectrumUnlock?.(this.save.data.spectrum);
        }
      }
    }
  }

  private cumNeed(level: number): number {
    const g = config.game;
    let sum = 0;
    for (let k = 1; k < level; k++) sum += g.xpPerLevelBase * Math.pow(g.xpGrowth, k - 1);
    return sum;
  }

  get levelProgress(): number {
    const lo = this.cumNeed(this.level);
    const hi = this.cumNeed(this.level + 1);
    return Math.max(0, Math.min(1, (this.save.data.totalPoints - lo) / (hi - lo)));
  }

  // ---- buffs shop ----
  buffCost(id: string): number {
    const b = config.game.buffs[id];
    return Math.floor(b.cost * Math.pow(b.growth, this.tier(id)));
  }
  buffMaxed(id: string): boolean {
    return this.tier(id) >= config.game.buffs[id].max;
  }
  buffTier(id: string): number {
    return this.tier(id);
  }
  buyBuff(id: string): boolean {
    if (this.buffMaxed(id)) return false;
    const cost = this.buffCost(id);
    if (this.save.data.points < cost) return false;
    this.save.data.points -= cost;
    this.save.data.buffs[id] = this.tier(id) + 1;
    this.save.persist();
    return true;
  }

  save_(): void {
    this.save.persist();
  }
}
