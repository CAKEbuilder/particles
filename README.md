# ▽ Particles

An oddly-satisfying particle sandbox for the web. Tens of thousands of glowing
upside-down triangles you can spawn, attract, repel, and blow around — with pleasant,
always-in-key sounds. Runs on desktop and phones (iOS + Android) as an installable PWA.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run dev -- --host  # also expose on your LAN to test on a real phone
```

```bash
npm run build        # static bundle in dist/  (deploy to any static host)
npm run preview      # serve the production build
npm run typecheck    # tsc --noEmit
```

No native toolchain, no app stores. `dist/` deploys to Cloudflare Pages / Netlify /
GitHub Pages as-is.

## Controls

- **Spawn** — tap for a bloom; hold/drag to paint a stream of particles.
- **Attract / Repel** — hold to pull particles toward / push them away from your finger.
- **Wind** — drag to push particles in your swipe direction.
- **Erase** — remove particles under your finger.
- **Gravity** toggle, **Pause**, **Clear**. Multi-touch works (each finger is its own force).

## How it works

A fixed-timestep loop drives three subsystems fed by pointer input:

```
main.ts ── loop ──┬── Input  (pointer → tools/forces)
                  ├── Sim    (CpuParticleSystem: forces, walls, soft separation)
                  ├── Render (WebGL2 instanced ▽, HDR trails, ACES tone-map)
                  └── Audio  (pentatonic, quantized, voice-capped)
```

- **Sim** (`src/sim`) — structure-of-arrays `Float32Array`s, semi-implicit integration,
  a counting-sort spatial hash for O(n) neighbour queries, swap-remove for erase.
- **Render** (`src/render`) — raw WebGL2. Each particle is an instanced billboard with
  an upside-down-triangle SDF + glow in the fragment shader. Frames accumulate into a
  half-float (HDR) ping-pong framebuffer that fades each frame for trails, then a
  **luminance-preserving** ACES tone-map composites it over the dark background — so
  dense clusters stay saturated/colourful instead of clipping to white. Hue is
  spatially coherent (position + slow drift), so a glob shares a colour rather than
  averaging to grey. Falls back to 8-bit where half-float isn't available.
- **Audio** (`src/audio`) — Web Audio, **two complementary voices**: warm marimba/bell
  plucks for player *touch*, airy glassy sparkles for *particle* collisions. Every note
  is snapped to a **major pentatonic** scale (so any combination is consonant); a
  drifting key root + per-note detune/octave-scatter keep it from feeling exhausted. A
  scheduler quantizes triggers to a rhythmic grid and caps voices per slot (separately
  per voice), so a flood of events becomes pleasant texture, never noise.

All gameplay/visual/audio knobs live in [`src/config.ts`](src/config.ts).
Particle budget auto-scales per device in [`src/core/device.ts`](src/core/device.ts), and
an **adaptive quality governor** ([`src/main.ts`](src/main.ts)) eases the separation pass
if fps dips so any device stays smooth. A dev-only profiler ([`src/core/Profiler.ts`](src/core/Profiler.ts))
logs per-phase timings (`window.__perf`) and `window.__game` exposes the live systems for
load tests.

## Game modes

- **Play** — the infinite run. Particles on screen earn points; level up for more capacity &
  energy; spend points on permanent buffs; ascend (prestige) for a permanent point multiplier.
  Spawning costs regenerating energy. Special particles arrive (announced ~15s ahead at the screen
  edge), apply effects, and are discovered/unlocked into your Collection — the rarest must be
  blasted with your particles to claim. Portals teleport particles; obstacles deflect them.
- **Sandbox** — unlimited particles, no economy, no danger. Pure relaxation.
- **Collection** — every special by rarity (??? until discovered) plus achievements.

First launch runs a short guided intro; afterwards you land on the title screen.

## Roadmap (built)

1. ✅ Sandbox base. 2. ✅ Audio per-tool + collision pings, apex logo. 3. ✅ Title/modes, save,
points economy, spawn energy, capacity, buffs. 4. ✅ Specials + rarity + discovery + collection.
5. ✅ Playfield (portals/obstacles), power-ups, intro. 6. ✅ Achievements + ascension.

Unwired stubs kept for reference: `src/game/ScoreMode.ts`, `src/level/Level.ts`,
`src/time/TimeMachine.ts` (rewind via deterministic replay — backlog).
