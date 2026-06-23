// Versioned localStorage persistence: progression, economy, discoveries, settings.

export interface SaveData {
  version: number;
  firstPlayDone: boolean;
  points: number; // spendable currency
  totalPoints: number; // lifetime (drives level/XP)
  level: number;
  buffs: Record<string, number>; // buffId -> purchased tier
  discovered: Record<string, number>; // specialId -> times seen/unlocked
  achievements: Record<string, boolean>; // achievementId -> unlocked
  ascension: number; // prestige count (permanent point multiplier)
  spectrum: number; // colour-spectrum unlock level (widens the aurora hue band)
  settings: { muted: boolean; haptics: boolean };
}

const KEY = "particles.save.v1";
const CURRENT_VERSION = 1;

function fresh(): SaveData {
  return {
    version: CURRENT_VERSION,
    firstPlayDone: false,
    points: 0,
    totalPoints: 0,
    level: 1,
    buffs: {},
    discovered: {},
    achievements: {},
    ascension: 0,
    spectrum: 1,
    settings: { muted: false, haptics: true },
  };
}

export class Save {
  data: SaveData;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      // shallow-merge onto defaults so new fields are always present (forward-safe)
      return { ...fresh(), ...parsed, settings: { ...fresh().settings, ...parsed.settings } };
    } catch {
      return fresh();
    }
  }

  persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage may be unavailable (private mode); run in-memory */
    }
  }

  /** Record that a special has been discovered (or seen). Returns true if it was new. */
  discover(id: string): boolean {
    const isNew = !this.data.discovered[id];
    this.data.discovered[id] = (this.data.discovered[id] ?? 0) + 1;
    this.persist();
    return isNew;
  }

  isDiscovered(id: string): boolean {
    return !!this.data.discovered[id];
  }

  reset(): void {
    this.data = fresh();
    this.persist();
  }
}
