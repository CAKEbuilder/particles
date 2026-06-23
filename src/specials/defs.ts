// Data-driven special-particle definitions. Low tiers carry 1 weak effect; high tiers
// carry several stronger ones. Behavior controls how they enter/leave the field.

import type { Tier } from "./Rarity";

export type EffectKind = "attract" | "repel" | "vortex" | "destroy";
// roam: enters and bounces around the field for `lingerSec`, then leaves.
// blast: like roam, then a vulnerable window where you must destroy it to unlock.
export type Behavior = "roam" | "blast";

export interface EffectSpec {
  kind: EffectKind;
  level: number; // scales strength + radius
}

export interface SpecialDef {
  id: string;
  name: string;
  tier: Tier;
  glyph: string; // shown in alerts (when known) + collection
  behavior: Behavior;
  effects: EffectSpec[];
  lingerSec: number; // seconds on field before it leaves
  appetite?: number; // blast: particles it must consume (be fed) to be satisfied -> unlock
  desc: string[];
}

export const DEFS: SpecialDef[] = [
  {
    id: "drifter",
    name: "Drifter",
    tier: "common",
    glyph: "▽",
    behavior: "roam",
    effects: [{ kind: "attract", level: 1 }],
    lingerSec: 9,
    desc: ["Gently draws particles toward it as it drifts around."],
  },
  {
    id: "gust",
    name: "Gust",
    tier: "uncommon",
    glyph: "≈",
    behavior: "roam",
    effects: [{ kind: "repel", level: 1 }],
    lingerSec: 9,
    desc: ["Pushes particles aside in its wake."],
  },
  {
    id: "vortex",
    name: "Vortex",
    tier: "rare",
    glyph: "◎",
    behavior: "blast",
    effects: [{ kind: "vortex", level: 2 }],
    lingerSec: 12,
    appetite: 350,
    desc: ["Spins the swarm into a hypnotic whirl.", "Feed it particles to unlock."],
  },
  {
    id: "prism",
    name: "Prism",
    tier: "epic",
    glyph: "◈",
    behavior: "blast",
    effects: [
      { kind: "attract", level: 2 },
      { kind: "vortex", level: 2 },
    ],
    lingerSec: 13,
    appetite: 700,
    desc: ["Gathers and swirls — a living kaleidoscope.", "Feed it particles to unlock."],
  },
  {
    id: "devourer",
    name: "Devourer",
    tier: "holographic",
    glyph: "✶",
    behavior: "blast",
    effects: [
      { kind: "attract", level: 3 },
      { kind: "destroy", level: 2 },
    ],
    lingerSec: 15,
    appetite: 1500,
    desc: ["Pulls particles in and devours them.", "Let it consume enough to unlock."],
  },
  {
    id: "blackhole",
    name: "Black Hole",
    tier: "rare",
    glyph: "⬤",
    behavior: "blast",
    effects: [{ kind: "attract", level: 4 }],
    lingerSec: 20,
    appetite: 400,
    desc: [
      "A gravitational hazard that devours nearby particles.",
      "Feed it enough to send it on its way early.",
    ],
  },
  {
    id: "singularity",
    name: "Singularity",
    tier: "apex",
    glyph: "▼",
    behavior: "blast",
    effects: [
      { kind: "vortex", level: 4 },
      { kind: "repel", level: 3 },
      { kind: "destroy", level: 1 },
    ],
    lingerSec: 18,
    appetite: 3200,
    desc: [
      "An anti-gravity black hole.",
      "Boundless power held in zen balance.",
      "Feed it enough to claim the apex.",
    ],
  },
];

export function defById(id: string): SpecialDef | undefined {
  return DEFS.find((d) => d.id === id);
}
