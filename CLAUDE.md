# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Particles" — an oddly-satisfying particle-game for the web (TypeScript + Vite, **raw WebGL2**,
Web Audio, installable PWA). No runtime dependencies; only Vite + TypeScript as dev deps. Targets
desktop **and** phones (one codebase, deploy to static hosting).

## Commands

```bash
npm install
npm run dev              # Vite dev server on :5173 (HMR)
npm run dev -- --host    # also expose on the LAN to test on a real phone
npm run typecheck        # tsc --noEmit  — RUN THIS to catch type errors
npm run build            # vite build -> dist/  (does NOT type-check!)
npm run preview          # serve the production build
```

- **`npm run build` skips type-checking** (esbuild strips types). Always run `npm run typecheck`
  separately — `tsconfig.json` is strict with `noUnusedLocals`/`noUnusedParameters`, so unused
  vars/params fail it.
- **No test framework.** Verification is by running the app and observing behavior (browser /
  preview), plus the dev-only debug handles below.

## Verifying changes (important quirks)

- In **dev** builds, `window.__game` exposes the live `Game` (`.system`, `.renderer`, `.loop`,
  `.state`, `.specials`, `.save`, `.config`) and `window.__perf` is the phase profiler. Use these
  to drive load tests and read per-phase timings from the console.
- A **backgrounded/headless preview tab pauses `requestAnimationFrame`**: fps reads 0 and
  `window.innerWidth/Height` may be 0, so the loop won't advance. To measure in that state, call
  `window.__game.system.step(1/60)` / `renderer.draw(...)` directly and time them. Restart the
  preview server to get a *visible* tab when you need a real screenshot.
- Progress persists in `localStorage` under `particles.save.v1`; clear it for a fresh first-run.

## Architecture (big picture)

`src/main.ts` → **`src/app/Game.ts`** is the orchestrator. There is **one persistent particle
world** (system + renderer + audio + input + loop); the game switches **modes**
(`title | intro | game | sandbox | collection | progress`) by configuring that world and toggling
DOM overlays — there are no separate "scene" objects. A fixed-timestep loop (`src/core/loop.ts`)
calls `Game.update(dt)` then `Game.render()`. First launch runs `intro`; `game` is the scored run;
`sandbox` is unlimited/no-economy; pausing keeps the field intact.

**Simulation** (`src/sim/`) — structure-of-arrays `Float32Array`s in `CpuParticleSystem`, behind
the `ParticleSystem` interface so a GPU backend could drop in. `SpatialHash` gives O(n) neighbor
queries; `forces.ts` applies `ForcePoint`s (`radial | directional | vortex`); `collision.ts` does
walls + soft separation. Two caps: `capacity` = hard allocated array size (per device, see
`src/core/device.ts`); `softCap` = runtime on-screen limit (game mode). The separation pass is the
main cost and is **neighbor-capped** (`config.separation.maxNeighbors`) so it stays O(n·k) even
when particles pile up.

**Force-merge pattern** — `Input.update()` builds force points but does **not** apply them;
`Game.update()` merges `input.getForces()` with `SpecialManager.update()`'s forces and calls
`system.setForcePoints(...)` **once**. Add new force sources the same way.

**Rendering** (`src/render/`) — raw WebGL2. Particles are instanced billboards; an upside-down-
triangle SDF + glow is computed in the fragment shader (`shaders.ts`). Frames accumulate into an
**HDR half-float ping-pong** framebuffer that fades each frame (trails), then a
**luminance-preserving ACES tone-map** composites over the dark bg (keeps dense clusters colorful,
not white). Falls back to 8-bit if half-float is unavailable. **Particles are WebGL; specials,
alerts, HUD and screens are DOM/CSS overlays positioned over the canvas** (cheaper, and lets CSS do
the holographic animations).

**Audio** (`src/audio/`) — Web Audio. `AudioEngine` has one voice per tool/event; every note is
snapped to a **major-pentatonic** scale (`scale.ts`) so any combination is consonant. `Scheduler`
quantizes triggers to a rhythmic grid, caps voices per slot, and slowly drifts the key root.
Audio initializes on the first user gesture.

**Progression** (`src/game/`, `src/save/`) — game-mode only (sandbox ignores all of it). `Save` is
versioned localStorage; `GameState` derives energy (regenerating spawn pool), on-screen capacity,
the points-from-particles economy, level/XP, and permanent buffs from it.

**Playfield** (`src/level/`) — `Playfield.ts` is a time-driven director: it relocates/
retypes an obstacle, cycles portals on/off, and spawns destructible **buff targets**
(bombard with particles → `onTargetCleared` grants a power-up). Obstacle collision lives
in `shapes.ts` as batched per-shape resolvers (`circle`, `triangle` via precomputed
edges) — add a shape by extending the union + a branch in `resolveShape`. Particles are
mutated directly (no per-particle closures).

**Specials** (`src/specials/`) — data-driven `defs.ts` + rarity tiers in `Rarity.ts`.
Behaviors: `roam` (common/uncommon — enter, bounce off the real edges for `lingerSec`,
discovered on sight) and `blast` (rare+ — has `appetite`; it **consumes** nearby particles
via `system.consumeNear` at a capped rate, filling a satiation meter; feed it enough before
its escape countdown to unlock it). `SpecialManager` schedules them, shows the edge `Alert`
(`src/ui/Alert.ts`) — preview glyph if discovered, tier-styled `???` if not — with the arrow
pointing back toward the origin and sweeping along the trajectory, applies effects via force
points + `system.eraseNear`/`consumeNear` (`effects.ts`), and records discoveries to `Save`.
Game mode only.

**Hue / colour pipeline** (`src/sim/CpuParticleSystem.ts`) — per-particle hue is computed in
`step()`: rainbow-flagged particles span the full spectrum; others map the spatial gradient
into the unlocked band `[hueLo,hueHi]` (set from `save.spectrum` via `GameState.spectrumBand`;
widens as you level). `spawnRainbow` (driven by the rainbow power-up) tags new spawns rainbow.

**Gravity is a 2D vector** — `step()` reads `config.runtime.gravDir{X,Y}` × `config.gravity`.
The Gravity toggle = straight down; `src/core/Tilt.ts` drives the direction from
`DeviceOrientation` (iOS permission) for the Tilt toggle. App is portrait-locked.

**Meta UI** — `ProgressOverlay` (stats + settings + `Save.reset()`), reachable from Title and
Pause. Intentional haptics via `src/core/haptics.ts` (toggle in settings). The renderer
survives WebGL context loss (`initGL()` rebuild); mobile DPR/capacity are capped in
`device.ts` to avoid memory-pressure reloads.

## Git workflow

This project uses git. **Commit after every meaningful change** — small, frequent commits are preferred over large batches. This gives a reference point and fallback for every iteration. Use descriptive commit messages; no need for elaborate structure, just say what changed and why.

```bash
git init           # already done
git add <files>
git commit -m "short description"
```

## GitHub / deployment

The remote is `https://github.com/CAKEbuilder/particles` (public repo). Pushing to `main` triggers a GitHub Actions deploy to `https://cakebuilder.github.io/particles/`.

**Never `git push` unless Connor explicitly asks.** Local commits are always fine; pushing is a separate deliberate step.

Before pushing, always verify:
- No secrets, API keys, tokens, or credentials in staged files
- No `.env` files or local config with private values
- No personal data beyond what was already public

```bash
git push origin main   # only run when explicitly instructed
```

## Conventions

- **All tunables live in `src/config.ts`** (sim, spawn, forces, look, game economy, specials,
  audio). Prefer adding a config knob over hard-coding. `Game.governQuality()` auto-tunes the
  separation pass at runtime to hold ~60fps on any device.
- No allocations in hot loops: reuse the preallocated SoA arrays / scratch buffers.
- **Unused leftover stubs** (safe to ignore/delete): `src/level/Level.ts` (superseded by
  `Playfield.ts`), `src/game/ScoreMode.ts`, `src/time/TimeMachine.ts` (rewind, never implemented).
  Everything else — playfield, power-ups, intro, achievements, ascension, color/rainbow/tilt — is
  built and wired.
- Don't name a local symbol `Partial` — it shadows the TS built-in utility type.
