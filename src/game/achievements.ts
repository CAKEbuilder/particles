// Achievements: evaluated purely against persisted save data, unlocked once, with a
// toast on unlock. Viewable on the Collection screen.

import type { Save, SaveData } from "../save/Save";
import { DEFS } from "../specials/defs";

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  check: (s: SaveData) => boolean;
}

const discoveredCount = (s: SaveData): number => Object.keys(s.discovered).length;
const buffTotal = (s: SaveData): number => Object.values(s.buffs).reduce((a, b) => a + b, 0);

export const ACHIEVEMENTS: Achievement[] = [
  { id: "first_bloom", name: "First Bloom", desc: "Reach level 2", check: (s) => s.level >= 2 },
  { id: "swarm_lord", name: "Swarm Lord", desc: "Reach level 10", check: (s) => s.level >= 10 },
  { id: "collector", name: "Collector", desc: "Discover 3 specials", check: (s) => discoveredCount(s) >= 3 },
  { id: "curator", name: "Curator", desc: "Discover every special", check: (s) => discoveredCount(s) >= DEFS.length },
  { id: "apex", name: "Apex", desc: "Claim the Singularity", check: (s) => !!s.discovered["singularity"] },
  { id: "enhanced", name: "Enhanced", desc: "Buy a permanent buff", check: (s) => buffTotal(s) >= 1 },
  { id: "tycoon", name: "Tycoon", desc: "Earn 10,000 lifetime points", check: (s) => s.totalPoints >= 10000 },
  { id: "ascended", name: "Ascended", desc: "Ascend once", check: (s) => s.ascension >= 1 },
];

/** Unlock any newly-satisfied achievements; returns the newly unlocked ones. */
export function checkAchievements(save: Save): Achievement[] {
  const newly: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!save.data.achievements[a.id] && a.check(save.data)) {
      save.data.achievements[a.id] = true;
      newly.push(a);
    }
  }
  if (newly.length) save.persist();
  return newly;
}
