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
    burst: 90, // particles per tap in sandbox/title
    streamPerSec: 900, // particles/s while holding the spawn tool
    speed: 70, // initial outward speed (px/s)
    speedJitter: 60,
    size: 3.4,
    sizeJitter: 1.6,
    sizeByCount: { max: 12, min: 1.5, k: 40 }, // continuous size curve: big solo, tiny in thousands
    ramp: { min: 0.04, k: 120 }, // toy/sandbox count-ramp: 4% burst at 0 particles, 100% at k
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
    baseCapacity: 8, // on-screen particle cap at level 1
    capacityPerLevel: 10, // +cap per level
    pointRatePerParticle: 0.18, // base points/sec per live particle at rest (intentionally low — movement is the real earner)
    movementBonus: 3.0, // up to +300% points when fully stirred (~4× idle); active play clearly wins
    movementRefSpeed: 220, // avg particle speed (px/s) for full bonus; reachable with wind/attract so stirring registers
    heat: {
      heatPerParticle: 0.005,  // heat added per spawned particle (0..1 scale)
      coolPerSec: 0.5,          // heat dissipates at this rate per second
      resetThreshold: 0.25,     // cooling clears once heat drops to this (gives ~1.5s cool window)
    },
    burstBase: 1,      // particles per tap at level 1 in game mode
    burstPerLevel: 0,  // burst only grows via the burst buff, not automatically with level
    xpPerLevelBase: 140, // lifetime points needed for level 2
    xpGrowth: 1.5, // each level costs 50% more than the last (steep, so buffs pace out)
    ascendLevel: 15, // level required to ascend (prestige)
    ascendBonus: 0.25, // permanent point multiplier gained per ascension
    // permanent buffs — four clear upgrades unlocked progressively
    buffs: {
      burst:    { cost: 120, growth: 1.7, per: 2,    max: 10, label: "Burst",       desc: "More particles per tap + hold",   unlockLevel: 2 },
      capacity: { cost: 150, growth: 1.6, per: 25,   max: 20, label: "Capacity",    desc: "More particles on screen",        unlockLevel: 3 },
      pointMult:{ cost: 200, growth: 1.8, per: 0.15, max: 8,  label: "Score Boost", desc: "Earn more points per particle",   unlockLevel: 4 },
      coolant:  { cost: 140, growth: 1.6, per: 0.25, max: 8,  label: "Coolant",     desc: "Spawn more before overheating",   unlockLevel: 5 },
    } as Record<string, { cost: number; growth: number; per: number; max: number; label: string; desc: string; unlockLevel: number }>,
  },

  // ---- specials (game mode only) ----
  specials: {
    alertLeadSec: 15, // warning time before a special arrives
    firstDelaySec: 60, // delay before the first visitor — give new players time to find their footing
    minParticles: 45, // don't send a visitor until the swarm is at least this big (they consume particles)
    intervalMin: 40, // seconds between specials
    intervalMax: 75,
    flySpeed: 95, // px/s travel speed
    eatPerSec: 500, // max particles a blast special consumes per second (feeding cap)
    hitRadius: 95, // px radius within which a special consumes particles
    minAppetite: 30, // floor so early tiny swarms still have a beatable target
  },

  // ---- peaceful visitors (toy + Journey) ----
  visitors: {
    rainbowBlastEvery: [50, 90] as [number, number],  // seconds between rainbow blasts
    shootingStarEvery: [70, 130] as [number, number], // seconds between shooting stars
    rainbowBlastSpeed: 200,  // px/s — slower so the trail is continuous and smooth
    shootingStarSpeed: 380,
    tintRadius: 175,         // soft-falloff radius; tintNear uses quadratic falloff so no hard edge
    tintDecayPerSec: 0.16,   // 0..1 per second; full-intensity particle fades over ~6s
    tintRippleEvery: 0.45,   // seconds between expanding CSS ripple rings along the trail
    infectRadius: 48,        // radius of holographic spread per pulse
    infectPerFrame: 2,       // max new holo particles per infection pulse
    infectEvery: 0.55,       // seconds between infection pulses (wave spread)
    journeyRainbowMult: 2.0, // points multiplier for tinted particles in Journey
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
