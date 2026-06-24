// Central tunables. Keep gameplay/visual/audio knobs here so experimentation is one edit away.

export const config = {
  // ---- simulation ----
  fixedDt: 1 / 60, // physics step (s); 1 step/frame at 60fps
  maxSubSteps: 2, // clamp hard so a slow frame can't multiply sim cost

  gravity: 1600, // px/s^2 downward when enabled
  gravityEnabled: false, // start floaty/dreamy; user toggles
  drag: 0.07, // per-second velocity damping (air resistance); lower = livelier, less settling

  restitution: 0.95, // wall bounce energy kept (high = bouncy borders, no aggregation)
  wallFriction: 0.998, // tangential damping on wall hit (~none, so they keep sliding/bouncing)
  wallKick: 60, // px/s minimum rebound speed so slow particles still bounce off, not stick

  // soft particle-to-particle separation (approximate collision at swarm scale)
  separation: {
    enabled: true,
    radius: 6, // px; also the spatial-hash cell size (smaller = cheaper, denser packing)
    correction: 0.6, // 0..1 positional push per overlap (resists crush under attract)
    damping: 0.06, // 0..1 normal-velocity damping on contact (low = elastic/bouncy field)
    maxNeighbors: 12, // hard cap per particle -> O(n*k) even in dense piles
    maxCount: 60000, // auto-skip separation above this (perf guard)
  },

  // runtime-mutated state
  runtime: {
    sepEveryN: 1, // run separation every Nth step (raised under load by the governor)
    gravDirX: 0, // gravity direction (unit-ish); straight down by default, tilt overrides
    gravDirY: 1,
  },

  // ---- spawning ----
  spawn: {
    burst: 90, // particles per tap in sandbox/title (energy gates game mode separately)
    streamPerSec: 900, // particles/s while holding the spawn tool
    speed: 70, // initial outward speed (px/s)
    speedJitter: 60,
    size: 3.4,
    sizeJitter: 1.6,
    sizeByCount: { max: 12, min: 1.5, k: 40 }, // continuous size curve: big solo, tiny in thousands
  },

  // ---- pointer forces ----
  pointer: {
    attract: 1800, // accel toward finger (px/s^2 at center)
    repel: 2400,
    wind: 9, // multiplier on finger velocity for the wind tool
    radius: 170, // influence radius (px)
    eraseRadius: 60,
  },

  // ---- look ----
  trailFade: 0.72, // 0..1 per-frame trail persistence (higher = longer/blurrier trails)
  exposure: 0.62, // tone-map exposure; <1 gives dense clusters more headroom before white
  background: [0.015, 0.02, 0.045] as [number, number, number],
  // hue is spatially coherent (a glob shares a colour instead of averaging to white):
  hueBase: 0.0, // base offset into the aurora ramp (0..1)
  hueByPos: 0.0009, // hue gradient across space (per px) -> smooth colour fields
  hueDrift: 0.03, // cycles/sec the whole field slowly drifts through the ramp
  hueBySpeed: 0.0006, // small extra shift by speed for liveliness
  // colour-spectrum unlocks widen the hue band the gradient maps into (start ~1 colour)
  spectrumMax: 6, // number of widen steps (level 1 = single hue, max = full aurora)
  spectrumUnlockEvery: 3, // a spectrum step unlocks every N player levels
  spin: 0.25, // rad/s gentle uniform spin so the ▽ shimmers
  dprCap: 2, // cap device-pixel-ratio for perf on high-density phones

  // ---- tool unlock levels (minimum level to display each tool in the HUD) ----
  toolUnlocks: {
    spawn: 1,
    attract: 1,
    repel: 2,
    wind: 4,
    erase: 6,
    gravity: 8,
    tilt: 10,
  } as Record<string, number>,

  // ---- game / progression (game mode only; sandbox ignores all of this) ----
  game: {
    baseCapacity: 3, // on-screen particle cap at level 1 (scarce start)
    capacityPerLevel: 5, // +cap per level (grows slowly so each level feels meaningful)
    pointRatePerParticle: 0.4, // base points/sec per live particle (earned even at rest)
    movementBonus: 0.9, // up to +90% points when the swarm is fully in motion (rewards stirring/interacting)
    movementRefSpeed: 340, // avg particle speed (px/s) for full bonus; above ambient bounce so active tools stand out
    energy: {
      base: 2.0, // spawn-energy pool max at level 1 (~3 particles at 0.6 cost each)
      perLevel: 5.0, // grows meaningfully each level
      regenBase: 0.4, // energy/sec at level 1 (~1.5s per particle)
      regenPerLevel: 1.2, // regen roughly doubles by level ~20
      costPerParticle: 0.6, // energy spent per spawned particle
      lockClearFraction: 0.3, // once depleted, must refill to this fraction before spawning again
    },
    burstBase: 1,      // particles per tap at level 1 in game mode
    burstPerLevel: 0,  // burst only grows via the burst buff, not automatically with level
    xpPerLevelBase: 140, // lifetime points needed for level 2
    xpGrowth: 1.5, // each level costs 50% more than the last (steep, so buffs pace out)
    ascendLevel: 15, // level required to ascend (prestige)
    ascendBonus: 0.25, // permanent point multiplier gained per ascension
    // permanent buffs ordered by when they unlock: id -> { base cost, growth, per-tier effect, max tier, label, desc, unlockLevel }
    buffs: {
      capacity:     { cost: 150, growth: 1.7, per: 1200, max: 12, label: "Capacity",       desc: "More particles on screen",           unlockLevel: 2 },
      attractForce: { cost: 160, growth: 1.7, per: 0.25, max: 8,  label: "Attract power",  desc: "Stronger pull for finer control",    unlockLevel: 4 },
      energyMax:    { cost: 120, growth: 1.7, per: 60,   max: 10, label: "Energy max",     desc: "Larger spawn energy pool",           unlockLevel: 6 },
      energyRegen:  { cost: 120, growth: 1.7, per: 10,   max: 10, label: "Energy regen",   desc: "Refills your energy faster",         unlockLevel: 8 },
      burst:        { cost: 180, growth: 1.8, per: 2,    max: 8,  label: "Burst size",     desc: "More particles per tap",             unlockLevel: 10 },
      pointMult:    { cost: 200, growth: 1.8, per: 0.15, max: 8,  label: "Score Boost",    desc: "Earn more points per particle",      unlockLevel: 12 },
    } as Record<string, { cost: number; growth: number; per: number; max: number; label: string; desc: string; unlockLevel: number }>,
  },

  // ---- specials (game mode only) ----
  specials: {
    alertLeadSec: 15, // warning time before a special arrives
    firstDelaySec: 18, // delay before the first special of a run
    intervalMin: 24, // seconds between specials
    intervalMax: 52,
    flySpeed: 95, // px/s travel speed
    eatPerSec: 500, // max particles a blast special consumes per second (feeding cap)
    hitRadius: 95, // px radius within which a special consumes particles
  },

  // ---- audio ----
  audio: {
    bpm: 84, // quantization tempo for note triggers
    baseFreq: 261.63, // C4
    octaves: 5,
    startOctave: -2, // lowest octave offset from base
    maxVoicesDefault: 2, // cap notes per voice per rhythmic slot (lower = less crackle)
    maxVoices: { wind: 1, micro: 2 } as Record<string, number>, // per-voice overrides
    toolSoundEveryMs: 180, // throttle for continuous tools (attract/repel/wind/erase)
    masterGain: 0.7, // headroom under the limiter
    voiceGain: 0.085, // per-note peak (many sum together)
    reverbSend: 0.55,
    delaySend: 0.22,
    lowpassHz: 7200,
  },
};

export type Config = typeof config;
