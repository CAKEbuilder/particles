// Runtime game state derived from the Save: spawn-energy pool, on-screen capacity,
// points economy, level/XP, and permanent buff purchases. Game mode only.

import { config } from "../config";
import type { Save } from "../save/Save";
import type { PowerUps } from "./PowerUps";

export class GameState {
  energy: number;
  locked = false; // depleted lockout: can't spawn until energy refills past the threshold
  onLevelUp: ((level: number) => void) | null = null;
  onLock: (() => void) | null = null; // fired when energy first runs out (for haptics/SFX)
  onSpectrumUnlock: ((spectrum: number) => void) | null = null;
  private powerups: PowerUps | null = null;

  constructor(
    private readonly save: Save,
    private readonly hardCap: number // device-allocated ceiling
  ) {
    this.energy = this.energyMax;
  }

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
  get energyMax(): number {
    const e = config.game.energy;
    return e.base + (this.level - 1) * e.perLevel + this.tier("energyMax") * this.per("energyMax");
  }
  get energyRegen(): number {
    const e = config.game.energy;
    const base = e.regenBase + (this.level - 1) * e.regenPerLevel + this.tier("energyRegen") * this.per("energyRegen");
    return base * (this.powerups?.energyRegenMult() ?? 1);
  }
  get pointMult(): number {
    return (
      (1 + this.tier("pointMult") * this.per("pointMult")) *
      (this.powerups?.pointMult() ?? 1) *
      this.ascensionMult
    );
  }
  /** Per-particle points/sec including the movement bonus (a still swarm earns the base;
   *  a fully-stirred one earns up to base*(1+movementBonus)). Drives both economy + HUD readout. */
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
  /** Prestige: reset level/points/buffs for a permanent point multiplier. Keeps
   *  discoveries + achievements. Returns the new ascension count, or -1 if not eligible. */
  ascend(): number {
    if (!this.canAscend()) return -1;
    this.save.data.ascension++;
    this.save.data.level = 1;
    this.save.data.points = 0;
    this.save.data.totalPoints = 0;
    this.save.data.buffs = {};
    this.resetEnergy();
    this.save.persist();
    return this.save.data.ascension;
  }
  get burstSize(): number {
    const g = config.game;
    const base = g.burstBase + (this.level - 1) * g.burstPerLevel + this.tier("burst") * this.per("burst");
    return Math.floor(base * (this.powerups?.burstMult() ?? 1));
  }
  get attractMult(): number {
    return 1 + this.tier("attractForce") * this.per("attractForce");
  }

  resetEnergy(): void {
    this.energy = this.energyMax;
    this.locked = false;
  }

  /** Hue band [lo,hi] the gradient maps into: a single hue at spectrum 1, full at max. */
  spectrumBand(): [number, number] {
    const t = (this.save.data.spectrum - 1) / Math.max(1, config.spectrumMax - 1);
    const center = 0.18; // single starting hue (cyan/teal end of the aurora ramp)
    return [(1 - t) * center, (1 - t) * center + t];
  }

  private lock(): void {
    if (!this.locked) {
      this.locked = true;
      this.onLock?.();
    }
  }

  /** Gate for Input: allow as many of `requested` as energy + capacity permit.
   *  Once fully depleted, spawning locks out until energy refills past a threshold,
   *  so "out of energy" actually stops you (no trickle from regen). */
  tryConsumeSpawn(requested: number, liveCount: number): number {
    const e = config.game.energy;
    if (this.locked) {
      if (this.energy >= this.energyMax * e.lockClearFraction) this.locked = false;
      else return 0;
    }
    const capRemaining = this.maxCapacity - liveCount;
    if (capRemaining <= 0) return 0;
    const byEnergy = Math.floor(this.energy / e.costPerParticle);
    const allowed = Math.min(requested, capRemaining, byEnergy);
    if (allowed <= 0) {
      if (this.energy < e.costPerParticle) this.lock();
      return 0;
    }
    this.energy -= allowed * e.costPerParticle;
    if (this.energy < e.costPerParticle) this.lock();
    return allowed;
  }

  /** Per-frame: regen energy, accrue points from live particles, handle level-ups. */
  update(dt: number, liveCount: number, avgSpeed = 0): void {
    this.energy = Math.min(this.energyMax, this.energy + this.energyRegen * dt);

    const gained = liveCount * this.pointRate(avgSpeed) * dt;
    if (gained > 0) {
      this.save.data.points += gained;
      this.save.data.totalPoints += gained;
      while (this.save.data.totalPoints >= this.cumNeed(this.level + 1)) {
        this.save.data.level++;
        if (this.onLevelUp) this.onLevelUp(this.save.data.level);
        // unlock a colour-spectrum step every N levels (widens the hue band)
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

  // ---- XP / leveling ----
  private cumNeed(level: number): number {
    // lifetime points required to *reach* `level`
    const g = config.game;
    let sum = 0;
    for (let k = 1; k < level; k++) sum += g.xpPerLevelBase * Math.pow(g.xpGrowth, k - 1);
    return sum;
  }
  /** 0..1 progress through the current level. */
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
