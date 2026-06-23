// Temporary, timed power-ups that multiply game stats. Earned from destroying specials,
// leveling up, and pushing enough particles through portals. (Permanent boosts are the
// buffs shop; these are short, exciting spikes.)

export type PowerUpType = "capacity" | "points" | "energyRegen" | "burst" | "rainbow";

interface Spec {
  mult: number;
  dur: number; // seconds
  label: string;
}

const SPECS: Record<PowerUpType, Spec> = {
  capacity: { mult: 2, dur: 30, label: "×2 Capacity" },
  points: { mult: 2, dur: 30, label: "×2 Points" },
  energyRegen: { mult: 2.5, dur: 25, label: "×2.5 Energy" },
  burst: { mult: 3, dur: 25, label: "×3 Burst" },
  rainbow: { mult: 2.5, dur: 18, label: "🌈 Rainbow ×2.5" }, // recolours spawns + bonus points
};

const ALL: PowerUpType[] = ["capacity", "points", "energyRegen", "burst", "rainbow"];

interface Active {
  remaining: number;
  mult: number;
  label: string;
}

export class PowerUps {
  private active = new Map<PowerUpType, Active>();
  onChange: (() => void) | null = null;

  update(dt: number): void {
    let changed = false;
    for (const [type, a] of this.active) {
      a.remaining -= dt;
      if (a.remaining <= 0) {
        this.active.delete(type);
        changed = true;
      }
    }
    if (changed) this.onChange?.();
  }

  grant(type: PowerUpType): void {
    const s = SPECS[type];
    this.active.set(type, { remaining: s.dur, mult: s.mult, label: s.label });
    this.onChange?.();
  }

  grantRandom(): PowerUpType {
    const t = ALL[(Math.random() * ALL.length) | 0];
    this.grant(t);
    return t;
  }

  clear(): void {
    this.active.clear();
    this.onChange?.();
  }

  private mult(type: PowerUpType): number {
    return this.active.get(type)?.mult ?? 1;
  }
  capacityMult(): number {
    return this.mult("capacity");
  }
  pointMult(): number {
    return this.mult("points") * this.mult("rainbow");
  }
  rainbowActive(): boolean {
    return this.active.has("rainbow");
  }
  energyRegenMult(): number {
    return this.mult("energyRegen");
  }
  burstMult(): number {
    return this.mult("burst");
  }

  list(): { label: string; remaining: number }[] {
    return [...this.active.values()].map((a) => ({ label: a.label, remaining: a.remaining }));
  }
}
