// Rarity ladder for special particles. Rarer tiers spawn less often, look fancier,
// and (via their defs) carry more & stronger effects.

export type Tier = "common" | "uncommon" | "rare" | "epic" | "holographic" | "apex";

export interface TierDef {
  id: Tier;
  name: string;
  color: string; // accent colour used by alerts, views, collection cards
  weight: number; // relative spawn weight (higher = more common)
  holo: boolean; // holographic rainbow treatment on the alert/view
}

export const TIERS: Record<Tier, TierDef> = {
  common: { id: "common", name: "Common", color: "#7fb0ff", weight: 180, holo: false },
  uncommon: { id: "uncommon", name: "Uncommon", color: "#46e08a", weight: 90, holo: false },
  rare: { id: "rare", name: "Rare", color: "#2ee6ff", weight: 26, holo: false },
  epic: { id: "epic", name: "Epic", color: "#b06bff", weight: 11, holo: false },
  holographic: { id: "holographic", name: "Holographic", color: "#ff5bd0", weight: 4, holo: true },
  apex: { id: "apex", name: "Apex", color: "#ffffff", weight: 0.6, holo: true },
};

export const TIER_ORDER: Tier[] = ["common", "uncommon", "rare", "epic", "holographic", "apex"];
