// Central orchestrator: one persistent particle world + audio + renderer, switched
// between modes (title / sandbox / game / collection) with matching UI overlays.

import { config } from "../config";
import { detectDevice } from "../core/device";
import { Loop } from "../core/loop";
import { perf } from "../core/Profiler";
import { CpuParticleSystem } from "../sim/CpuParticleSystem";
import { Renderer } from "../render/Renderer";
import { AudioEngine } from "../audio/AudioEngine";
import { Scheduler } from "../audio/Scheduler";
import { Input } from "../input/Input";
import { Save } from "../save/Save";
import { GameState } from "../game/GameState";
import { Hud } from "../ui/Hud";
import { GameHud } from "../ui/GameHud";
import { TitleOverlay } from "../ui/TitleOverlay";
import { CollectionOverlay, type CollectionEntry } from "../ui/CollectionOverlay";
import { SpecialManager } from "../specials/SpecialManager";
import { DEFS } from "../specials/defs";
import { TIERS } from "../specials/Rarity";
import { PowerUps } from "../game/PowerUps";
import { Playfield } from "../level/Playfield";
import { Coach } from "../ui/Coach";
import { ToyHint } from "../ui/ToyHint";
import { PauseOverlay } from "../ui/PauseOverlay";
import { Toast } from "../ui/Toast";
import { ProgressOverlay } from "../ui/ProgressOverlay";
import { ACHIEVEMENTS, checkAchievements } from "../game/achievements";
import { Haptics, setHapticsEnabled } from "../core/haptics";
import { Tilt } from "../core/Tilt";
import { Visitors } from "../level/Visitors";
import { SandboxEditor } from "../editor/SandboxEditor";

export type Mode = "title" | "toy" | "sandbox" | "game" | "collection" | "intro" | "progress";

// Tool labels for unlock toasts (excludes spawn/attract which are always available)
const UNLOCK_TOASTS: { key: string; label: string }[] = [
  { key: "repel",   label: "Repel" },
  { key: "wind",    label: "Wind" },
  { key: "erase",   label: "Erase" },
  { key: "gravity", label: "Gravity" },
  { key: "tilt",    label: "Tilt" },
];

export class Game {
  readonly system: CpuParticleSystem;
  readonly renderer: Renderer;
  readonly engine = new AudioEngine();
  readonly scheduler: Scheduler;
  readonly input: Input;
  readonly save = new Save();
  readonly state: GameState;
  readonly loop: Loop;

  private device = detectDevice();
  private title: TitleOverlay;
  private hud: Hud;
  private gameHud: GameHud;
  private collection: CollectionOverlay;
  private progress: ProgressOverlay;
  private specials: SpecialManager;
  private powerups = new PowerUps();
  private playfield: Playfield;
  private coach: Coach;
  private toyHint: ToyHint;
  private toast: Toast;
  private pauseOverlay: PauseOverlay;
  private paused = false;
  private tilt = new Tilt();
  private mode: Mode = "title";
  private visitors: Visitors | null = null;
  private editor: SandboxEditor;
  private lastGovern = performance.now();
  private lastSave = performance.now();
  private portalAccum = 0; // particles teleported toward the next power-up

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.system = new CpuParticleSystem(this.device.capacity);
    this.renderer = new Renderer(canvas, this.device.capacity);
    this.scheduler = new Scheduler(this.engine);
    this.state = new GameState(this.save, this.device.capacity);

    const getSize = (): [number, number] => [window.innerWidth, window.innerHeight];
    this.input = new Input(canvas, this.system, this.engine, this.scheduler, getSize, () => {});

    this.loop = new Loop(
      config.fixedDt,
      config.maxSubSteps,
      (dt) => this.update(dt),
      () => this.render()
    );

    setHapticsEnabled(this.save.data.settings.haptics);

    // overlays
    this.title = new TitleOverlay(uiRoot, {
      onPlay: () => this.setMode("toy"),
      onJourney: () => this.setMode("game"),
      onSandbox: () => this.setMode("sandbox"),
      onCollection: () => this.setMode("collection"),
      onProgress: () => this.setMode("progress"),
    });
    this.editor = new SandboxEditor(uiRoot, canvas, this.system, this.input);
    this.hud = new Hud(uiRoot, this.input, this.system, this.loop, {
      onMenu: () => this.onMenuPressed(),
      onTilt: async () => {
        if (this.tilt.isEnabled) {
          this.tilt.disable();
          return false;
        }
        const ok = await this.tilt.enable();
        if (!ok) this.toast.show("Tilt unavailable", "Motion access denied", "ach");
        return ok;
      },
      onSelectTool: () => this.editor.onPlayToolSelected(),
    });
    this.gameHud = new GameHud(uiRoot, this.state, this.powerups, () => this.ascend());
    this.collection = new CollectionOverlay(uiRoot, {
      onBack: () => this.setMode("title"),
      getEntries: () => this.collectionEntries(),
      getAchievements: () => this.achievementEntries(),
    });
    this.playfield = new Playfield(uiRoot, this.system, () => {
      this.powerups.grantRandom();
      this.notify("Buff secured", "Target cleared", "level");
      this.gameHud.update();
      Haptics.unlock();
    });
    this.coach = new Coach(uiRoot);
    this.toyHint = new ToyHint(uiRoot);
    this.toast = new Toast(uiRoot);
    this.pauseOverlay = new PauseOverlay(uiRoot, {
      onResume: () => this.resume(),
      onMainMenu: () => this.setMode("title"),
      onProgress: () => this.setMode("progress"),
    });
    this.progress = new ProgressOverlay(uiRoot, {
      onBack: () => this.setMode("title"),
      onReset: () => {
        this.save.reset();
        setHapticsEnabled(this.save.data.settings.haptics);
        this.engine.setMuted(this.save.data.settings.muted);
        this.setMode("toy"); // start fresh in the calm toy after a reset
      },
      onToggleHaptics: (on) => {
        this.save.data.settings.haptics = on;
        setHapticsEnabled(on);
        this.save.persist();
      },
      onToggleSound: (on) => {
        this.save.data.settings.muted = !on;
        this.engine.setMuted(!on);
        this.save.persist();
      },
      getData: () => this.progressData(),
    });

    this.state.setPowerUps(this.powerups);
    this.powerups.onChange = () => this.gameHud.update();

    this.specials = new SpecialManager(
      uiRoot,
      this.system,
      this.save,
      {
        onArrive: (x) => {
          const w = window.innerWidth;
          this.scheduler.request("particle", { pan: (x / w) * 2 - 1, register: 0.85, intensity: 1 });
        },
        onDiscover: (def, isNew) => {
          if (isNew) {
            this.save.data.points += 250; // discovery bonus
            this.save.persist();
            this.notify("Discovered", def.name, "ach");
            Haptics.unlock();
          }
          // every special you experience rewards a temporary power-up
          if (this.mode === "game") this.powerups.grantRandom();
          this.gameHud.update();
          this.checkAch();
        },
      },
      () => this.state.maxCapacity
    );

    this.state.onLevelUp = (level) => {
      if (this.save.data.firstPlayDone) {
        this.powerups.grantRandom();
        this.gameHud.update();
      }
      this.notify(`Level ${level}`, "Capacity up", "level");
      Haptics.level();
      this.checkAch();
      // announce newly unlocked tools
      for (const t of UNLOCK_TOASTS) {
        if (config.toolUnlocks[t.key] === level) {
          setTimeout(() => this.notify("New tool!", t.label, "ach"), 600);
        }
      }
      this.hud.updateUnlocks(level);
    };
    this.state.onLock = () => Haptics.lock();
    this.state.onSpectrumUnlock = (s) => {
      const [lo, hi] = this.state.spectrumBand();
      this.system.hueLo = lo;
      this.system.hueHi = hi;
      this.notify("New colour unlocked", `Spectrum ${s}/${config.spectrumMax}`, "ach");
      Haptics.unlock();
    };

    this.visitors = new Visitors(uiRoot, this.system);

    this.resize();
    window.addEventListener("resize", () => this.resize());
    // persist progress when leaving / backgrounding
    window.addEventListener("pagehide", () => this.save.persist());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.save.persist();
    });
  }

  start(): void {
    this.loop.start();
    this.lockPortrait();
    // All players start in the calm toy — no forced progression on first launch.
    // Returning players still see title (firstPlayDone gets set on first toy entry).
    this.setMode(this.save.data.firstPlayDone ? "title" : "toy");
  }

  private lockPortrait(): void {
    const o = (screen as unknown as { orientation?: { lock?: (s: string) => Promise<void> } }).orientation;
    if (o?.lock) {
      try {
        o.lock("portrait").catch(() => {}); // only works installed/fullscreen; ignore rejection
      } catch {
        /* unsupported */
      }
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.device.dprCap);
    this.renderer.resize(w, h, dpr);
    this.system.setBounds(w, h);
    this.playfield.relayout();
  }

  private onMenuPressed(): void {
    if (this.mode === "game") this.pause();
    else this.setMode("title");
  }

  private pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.pauseOverlay.setVisible(true);
  }

  private resume(): void {
    this.paused = false;
    this.pauseOverlay.setVisible(false);
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.paused = false;
    this.pauseOverlay.setVisible(false);
    this.engine.init();
    this.engine.resume();
    this.engine.setMuted(this.save.data.settings.muted);

    // reset the field & overlays
    this.system.clear();
    this.renderer.clear();
    // colour band: full spectrum everywhere except the game run, where it's gated by unlocks
    this.system.hueLo = 0;
    this.system.hueHi = 1;
    this.system.spawnRainbow = false;
    this.specials.setEnabled(mode === "game" || mode === "intro");
    this.playfield.setEnabled(mode === "game" || mode === "intro");
    this.editor.setActive(mode === "sandbox");
    this.hud.setSandboxMode(mode === "sandbox");
    // toy is pure sensory: no economy, no obstacles, no specials (both already false above)
    if (mode !== "game" && mode !== "intro") this.powerups.clear();
    this.title.setVisible(false);
    this.hud.setVisible(false);
    this.gameHud.setVisible(false);
    this.collection.setVisible(false);
    this.progress.setVisible(false);
    this.coach.setVisible(false);
    this.toyHint.hide();

    const [w, h] = [window.innerWidth, window.innerHeight];

    switch (mode) {
      case "title":
        config.gravityEnabled = false;
        this.input.gate = null;
        this.system.softCap = this.device.capacity;
        this.input.burstSize = config.spawn.burst;
        this.input.streamRate = config.spawn.streamPerSec;
        this.ambientBloom(w, h);
        this.title.setVisible(true);
        break;

      case "toy":
        // Calm, economy-free particle toy. No gate, no specials, no obstacles.
        config.gravityEnabled = false;
        this.input.gate = null;
        this.system.softCap = this.device.capacity;
        this.input.burstSize = config.spawn.burst;
        this.input.streamRate = config.spawn.streamPerSec;
        this.hud.setVisible(true);
        this.hud.showAllTools();
        this.hud.resetToSpawn();
        this.hud.setStatsVisible(false);
        this.showTagline("No point. No goal. Just enjoy.");
        // Mark firstPlayDone so Journey mode doesn't run the old text tutorial
        if (!this.save.data.firstPlayDone) {
          this.save.data.firstPlayDone = true;
          this.save.persist();
        }
        // Wordless first-touch invitation — pulses until the player's first tap
        this.toyHint.show();
        break;

      case "sandbox":
        this.input.gate = null;
        this.system.softCap = this.device.capacity;
        this.input.burstSize = config.spawn.burst;
        this.input.streamRate = config.spawn.streamPerSec;
        this.ambientBloom(w, h);
        this.hud.setVisible(true);
        this.hud.showAllTools();
        this.hud.resetToSpawn();
        this.showTagline("Experiment freely.");
        break;

      case "game": {
        config.gravityEnabled = false;
        this.powerups.clear();
        this.portalAccum = 0;
        this.state.heat = 0;
        this.state.cooling = false;
        const [lo, hi] = this.state.spectrumBand();
        this.system.hueLo = lo;
        this.system.hueHi = hi;
        this.input.gate = (req) => this.state.tryConsumeSpawn(req, this.system.count);
        this.hud.setVisible(true);
        this.hud.resetToSpawn();
        this.gameHud.setVisible(true);
        this.gameHud.update();

        this.playfield.setLevelGated(true);
        this.gameHud.setReveal(3);
        this.hud.updateUnlocks(this.save.data.level);
        this.showTagline("Grow your swarm. Find your rhythm.");
        break;
      }

      case "intro":
        // generous teaching playground kept for sandbox/demo use; not shown to new players
        config.gravityEnabled = false;
        this.input.gate = null;
        this.system.softCap = Math.min(this.device.capacity, 9000);
        this.input.burstSize = config.spawn.burst;
        this.input.streamRate = config.spawn.streamPerSec;
        this.hud.setVisible(true);
        this.coach.show("Tap & hold anywhere to spawn particles ✦");
        break;

      case "collection":
        this.collection.setVisible(true);
        break;

      case "progress":
        this.progress.setVisible(true);
        break;
    }
  }

  private taglineEl: HTMLDivElement | null = null;

  /** Brief centered tagline that fades in then out on mode entry. */
  private showTagline(text: string): void {
    this.taglineEl?.remove();
    const el = document.createElement("div");
    el.className = "mode-tagline";
    el.textContent = text;
    document.getElementById("ui")?.appendChild(el);
    this.taglineEl = el;
    window.setTimeout(() => {
      el.classList.add("mode-tagline--out");
      window.setTimeout(() => { el.remove(); if (this.taglineEl === el) this.taglineEl = null; }, 800);
    }, 3200);
  }

  private ambientBloom(w: number, h: number): void {
    this.system.spawnBurst(w / 2, h / 2, {
      count: Math.min(800, Math.floor(this.device.capacity * 0.05)),
      speed: 34,
      speedJitter: 26,
    });
  }

  private update(dt: number): void {
    if (this.paused) return; // frozen: keep the field intact, resume exactly where we left off

    // Continuous particle size: big solo, shrinks smoothly as count grows, tiny in thousands.
    if (this.mode === "game" || this.mode === "toy" || this.mode === "sandbox" || this.mode === "intro") {
      const n = this.system.count;
      const sc = config.spawn.sizeByCount;
      const sz = sc.min + (sc.max - sc.min) / (1 + n / sc.k);
      config.spawn.size = sz;
      // skip particles flagged as "big" by the condenser (size > 16 = above max normal)
      for (let i = 0; i < n; i++) if (this.system.size[i] < 16) this.system.size[i] = sz;
    }

    if (this.mode === "game") {
      // Must be set before input.update so tap handlers on this frame see the right values
      this.system.softCap = this.state.maxCapacity;
      this.input.burstSize = this.state.burstSize;
      this.input.streamRate = config.spawn.streamPerSec; // full stream; heat limits sustained spam
      this.input.attractMult = this.state.attractMult;
    }

    // Toy/sandbox/intro: gentle count-based ramp so large particles are appreciable at low counts
    if (this.mode === "toy" || this.mode === "sandbox" || this.mode === "intro") {
      const n = this.system.count;
      const r = config.spawn.ramp;
      const scale = r.min + (1 - r.min) * Math.min(1, n / r.k);
      this.input.burstSize = Math.max(1, Math.round(config.spawn.burst * scale));
      this.input.streamRate = config.spawn.streamPerSec * scale;
    }

    this.input.update(dt);

    if (this.mode === "game") {
      this.state.update(dt, this.system.count, this.system.avgSpeed);
      // Rainbow-blast tinted particles earn a brief point bonus in Journey
      if (this.system.tintedCount > 0) {
        const bonus = this.system.tintedCount *
          this.state.pointRate(this.system.avgSpeed) *
          (config.visitors.journeyRainbowMult - 1) * dt;
        this.save.data.points += bonus;
        this.save.data.totalPoints += bonus;
      }
    }
    // Peaceful visitors run in toy and Journey (not sandbox/intro — less clutter)
    if (this.mode === "toy" || this.mode === "game") {
      this.visitors?.update(dt);
    }
    if (this.mode === "game" || this.mode === "intro") {
      this.powerups.update(dt);
      this.system.spawnRainbow = this.powerups.rainbowActive();
    }

    // merge pointer forces with active special-particle effects
    const inputForces = this.input.getForces();
    const specialForces = this.specials.update(dt);
    this.system.setForcePoints(
      specialForces.length ? inputForces.concat(specialForces) : inputForces
    );

    this.system.step(dt);
    this.playfield.update(dt, this.state.level, this.system.count);
    this.editor.resolve(dt);

    // pushing enough particles through portals earns a power-up
    if (this.mode === "game") {
      this.portalAccum += this.playfield.takeThroughput();
      if (this.portalAccum >= 2000) {
        this.portalAccum -= 2000;
        this.powerups.grantRandom();
      }
    }

    const events = this.system.drainEvents();
    if (events.length) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      for (const e of events) {
        this.scheduler.request(e.kind === "micro" ? "micro" : "particle", {
          pan: (e.x / w) * 2 - 1,
          register: 1 - e.y / h,
          intensity: e.intensity,
        });
      }
    }
  }

  private render(): void {
    this.renderer.draw(this.system);
    if (this.mode !== "collection" && this.mode !== "progress") {
      this.hud.update(this.loop.fps, this.system.count);
    }
    if (this.mode === "game") this.gameHud.update(this.system.count, this.system.avgSpeed);
    perf.countSubsteps(this.loop.lastSubSteps);
    perf.tick(this.loop.fps, this.system.count);
    this.governQuality();

    // periodic autosave during a run
    const now = performance.now();
    if (this.mode === "game" && now - this.lastSave > 4000) {
      this.lastSave = now;
      this.save.persist();
      this.checkAch();
    }
  }

  private ascend(): void {
    const n = this.state.ascend();
    if (n < 0) return;
    this.powerups.clear();
    this.portalAccum = 0;
    this.gameHud.update();
    this.notify("Ascended ✦", `${Math.round(this.state.ascensionMult * 100)}% points forever`, "ascend");
    this.checkAch();
  }

  /** Toast wrapper that silences all in-game notifications while the tutorial is running. */
  private notify(title: string, msg: string, kind: "level" | "ach" | "ascend"): void {
    if (!this.save.data.firstPlayDone && this.mode === "game") return;
    this.toast.show(title, msg, kind);
  }

  private checkAch(): void {
    // suppress achievement popups until the tutorial is complete to avoid overwhelming new players
    if (!this.save.data.firstPlayDone) return;
    for (const a of checkAchievements(this.save)) this.toast.show("Achievement", a.name, "ach");
  }

  private achievementEntries(): { name: string; desc: string; unlocked: boolean }[] {
    return ACHIEVEMENTS.map((a) => ({
      name: a.name,
      desc: a.desc,
      unlocked: !!this.save.data.achievements[a.id],
    }));
  }

  private progressData() {
    const s = this.save.data;
    return {
      level: s.level,
      ascension: s.ascension,
      totalPoints: s.totalPoints,
      discovered: Object.keys(s.discovered).length,
      totalSpecials: DEFS.length,
      achievements: Object.keys(s.achievements).length,
      totalAchievements: ACHIEVEMENTS.length,
      buffTiers: Object.values(s.buffs).reduce((a, b) => a + b, 0),
      colors: s.spectrum,
      totalColors: config.spectrumMax,
      haptics: s.settings.haptics,
      muted: s.settings.muted,
    };
  }

  private collectionEntries(): CollectionEntry[] {
    return DEFS.map((d) => {
      const t = TIERS[d.tier];
      return {
        id: d.id,
        name: d.name,
        tier: t.name,
        tierColor: t.color,
        glyph: d.glyph,
        discovered: this.save.isDiscovered(d.id),
        seen: this.save.data.discovered[d.id] ?? 0,
        effects: d.desc,
      };
    });
  }

  private governQuality(): void {
    const now = performance.now();
    if (now - this.lastGovern < 1000) return;
    this.lastGovern = now;
    const fps = this.loop.fps;
    if (fps <= 0) return;
    const sep = config.separation;
    const rt = config.runtime;
    if (fps < 50) {
      if (sep.maxNeighbors > 6) sep.maxNeighbors -= 2;
      else if (rt.sepEveryN < 3) rt.sepEveryN++;
      else if (sep.enabled) sep.enabled = false;
    } else if (fps > 58) {
      if (!sep.enabled) sep.enabled = true;
      else if (rt.sepEveryN > 1) rt.sepEveryN--;
      else if (sep.maxNeighbors < 12) sep.maxNeighbors += 2;
    }
  }
}
