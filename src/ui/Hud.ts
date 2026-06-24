// Shared bottom toolbar: tool selector + actions (gravity / pause / clear / menu) + stats.
// Used by both Sandbox and Game modes; show/hide via setVisible.

import { config } from "../config";
import type { Input, Tool } from "../input/Input";
import type { Loop } from "../core/loop";
import type { CpuParticleSystem } from "../sim/CpuParticleSystem";

type ToolFilter = Tool[] | null; // null = show all unlocked; array = show only these

const TOOLS: { tool: Tool; label: string; unlockLevel: number }[] = [
  { tool: "spawn",   label: "✦ Spawn",   unlockLevel: 1 },
  { tool: "attract", label: "◉ Attract", unlockLevel: 1 },
  { tool: "repel",   label: "◎ Repel",   unlockLevel: 2 },
  { tool: "wind",    label: "≈ Wind",     unlockLevel: 4 },
  { tool: "erase",   label: "⌫ Erase",   unlockLevel: 6 },
];

export interface HudOptions {
  onMenu: () => void;
  onTilt: () => Promise<boolean> | boolean; // toggle tilt gravity; returns new enabled state
}

export class Hud {
  private el: HTMLDivElement;
  private stats: HTMLDivElement;
  private toolButtons = new Map<Tool, HTMLButtonElement>();
  private gravityBtn!: HTMLButtonElement;
  private tiltBtn!: HTMLButtonElement;
  private pauseBtn!: HTMLButtonElement;
  private toolFilter: ToolFilter = null;
  private currentUnlockLevel = 1;

  constructor(
    parent: HTMLElement,
    private readonly input: Input,
    private readonly system: CpuParticleSystem,
    private readonly loop: Loop,
    private readonly opts: HudOptions
  ) {
    this.el = document.createElement("div");
    this.el.className = "hud";

    const tools = document.createElement("div");
    tools.className = "hud-group";
    for (const t of TOOLS) {
      const btn = this.button(t.label, () => this.selectTool(t.tool));
      this.toolButtons.set(t.tool, btn);
      tools.appendChild(btn);
    }
    this.el.appendChild(tools);

    const actions = document.createElement("div");
    actions.className = "hud-group";
    this.gravityBtn = this.button("↓ Gravity", () => this.toggleGravity());
    this.tiltBtn = this.button("⟲ Tilt", () => this.toggleTilt());
    this.pauseBtn = this.button("❚❚", () => this.togglePause());
    const clearBtn = this.button("✕ Clear", () => this.system.clear());
    const menuBtn = this.button("☰ Menu", () => this.opts.onMenu());
    actions.appendChild(this.gravityBtn);
    actions.appendChild(this.tiltBtn);
    actions.appendChild(this.pauseBtn);
    actions.appendChild(clearBtn);
    actions.appendChild(menuBtn);
    this.el.appendChild(actions);

    parent.appendChild(this.el);

    this.stats = document.createElement("div");
    this.stats.className = "hud-stats";
    document.body.appendChild(this.stats);

    this.selectTool("spawn");
    this.syncGravity();
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "hud-btn";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  private selectTool(tool: Tool): void {
    this.input.tool = tool;
    for (const [t, btn] of this.toolButtons) btn.classList.toggle("active", t === tool);
  }

  private toggleGravity(): void {
    config.gravityEnabled = !config.gravityEnabled;
    this.syncGravity();
  }
  private syncGravity(): void {
    this.gravityBtn.classList.toggle("active", config.gravityEnabled);
  }

  private async toggleTilt(): Promise<void> {
    const on = await Promise.resolve(this.opts.onTilt());
    this.tiltBtn.classList.toggle("active", on);
    this.syncGravity(); // tilt toggles gravity too
  }

  private togglePause(): void {
    if (this.loop.isRunning) {
      this.loop.stop();
      this.pauseBtn.textContent = "▶";
      this.pauseBtn.classList.add("active");
    } else {
      this.loop.start();
      this.pauseBtn.textContent = "❚❚";
      this.pauseBtn.classList.remove("active");
    }
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle("hidden-ui", !v);
    this.stats.classList.toggle("hidden-ui", !v);
  }

  /** Show only tools the player has unlocked at their current level. */
  updateUnlocks(level: number): void {
    this.currentUnlockLevel = level;
    const unlocks = config.toolUnlocks;
    for (const t of TOOLS) {
      const btn = this.toolButtons.get(t.tool);
      if (btn) {
        const lockedByLevel = level < t.unlockLevel;
        const hiddenByFilter = this.toolFilter !== null && !this.toolFilter.includes(t.tool);
        btn.classList.toggle("hidden-ui", lockedByLevel || hiddenByFilter);
      }
    }
    const gravLocked = level < unlocks["gravity"];
    const tiltLocked = level < unlocks["tilt"];
    this.gravityBtn.classList.toggle("hidden-ui", gravLocked || this.toolFilter !== null);
    this.tiltBtn.classList.toggle("hidden-ui", tiltLocked || this.toolFilter !== null);
    // if active tool is now hidden, fall back to spawn
    const activeTool = this.input.tool as Tool;
    const activeDef = TOOLS.find((t) => t.tool === activeTool);
    if (activeDef && (level < activeDef.unlockLevel || (this.toolFilter !== null && !this.toolFilter.includes(activeTool)))) {
      this.selectTool("spawn");
    }
  }

  /** Restrict visible tools during tutorial steps. Pass null to restore normal unlock behaviour. */
  setTutorialTools(allowed: ToolFilter): void {
    this.toolFilter = allowed;
    this.updateUnlocks(this.currentUnlockLevel);
  }

  /** Show every tool regardless of unlock level or tutorial filter (for Sandbox). */
  showAllTools(): void {
    this.toolFilter = null;
    for (const [, btn] of this.toolButtons) btn.classList.remove("hidden-ui");
    this.gravityBtn.classList.remove("hidden-ui");
    this.tiltBtn.classList.remove("hidden-ui");
  }

  update(fps: number, count: number): void {
    this.stats.innerHTML =
      `<span class="count">${count.toLocaleString()}</span> particles<br>${fps.toFixed(0)} fps`;
  }
}
