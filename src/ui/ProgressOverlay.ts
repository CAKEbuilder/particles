// Progress / stats / settings screen: review everything + reset progress (with confirm).

export interface ProgressData {
  level: number;
  ascension: number;
  totalPoints: number;
  discovered: number;
  totalSpecials: number;
  achievements: number;
  totalAchievements: number;
  buffTiers: number;
  colors: number;
  totalColors: number;
  haptics: boolean;
  muted: boolean;
}

export interface ProgressOptions {
  onBack: () => void;
  onReset: () => void;
  onToggleHaptics: (on: boolean) => void;
  onToggleSound: (on: boolean) => void;
  getData: () => ProgressData;
}

export class ProgressOverlay {
  private el: HTMLDivElement;
  private grid: HTMLDivElement;
  private hapticsBtn: HTMLButtonElement;
  private soundBtn: HTMLButtonElement;
  private resetBtn: HTMLButtonElement;
  private resetArmed = false;
  private resetTimer = 0;

  constructor(parent: HTMLElement, private readonly opts: ProgressOptions) {
    this.el = document.createElement("div");
    this.el.className = "progress-screen";

    const header = document.createElement("div");
    header.className = "coll-header";
    const back = document.createElement("button");
    back.className = "title-btn";
    back.textContent = "‹ Back";
    back.addEventListener("click", () => this.opts.onBack());
    const h = document.createElement("h2");
    h.textContent = "Progress";
    header.append(back, h);
    this.el.appendChild(header);

    this.grid = document.createElement("div");
    this.grid.className = "prog-grid";
    this.el.appendChild(this.grid);

    const settings = document.createElement("div");
    settings.className = "prog-settings";
    this.hapticsBtn = this.toggleBtn("Haptics", () => {
      const on = !this.el.dataset.haptics;
      this.opts.onToggleHaptics(on);
      this.refresh();
    });
    this.soundBtn = this.toggleBtn("Sound", () => {
      const on = this.el.dataset.muted === "true"; // toggling: if muted, turn on
      this.opts.onToggleSound(on);
      this.refresh();
    });
    settings.append(this.hapticsBtn, this.soundBtn);
    this.el.appendChild(settings);

    this.resetBtn = document.createElement("button");
    this.resetBtn.className = "title-btn prog-reset";
    this.resetBtn.textContent = "Reset progress";
    this.resetBtn.addEventListener("click", () => this.onResetClick());
    this.el.appendChild(this.resetBtn);

    parent.appendChild(this.el);
  }

  private toggleBtn(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "title-btn prog-toggle";
    b.dataset.label = label;
    b.addEventListener("click", onClick);
    return b;
  }

  private onResetClick(): void {
    if (!this.resetArmed) {
      this.resetArmed = true;
      this.resetBtn.textContent = "Tap again to confirm reset";
      this.resetBtn.classList.add("armed");
      clearTimeout(this.resetTimer);
      this.resetTimer = window.setTimeout(() => {
        this.resetArmed = false;
        this.resetBtn.textContent = "Reset progress";
        this.resetBtn.classList.remove("armed");
      }, 3000);
      return;
    }
    clearTimeout(this.resetTimer);
    this.resetArmed = false;
    this.resetBtn.textContent = "Reset progress";
    this.resetBtn.classList.remove("armed");
    this.opts.onReset();
  }

  private stat(label: string, value: string): string {
    return `<div class="prog-stat"><div class="prog-stat-val">${value}</div><div class="prog-stat-label">${label}</div></div>`;
  }

  refresh(): void {
    const d = this.opts.getData();
    this.el.dataset.haptics = d.haptics ? "true" : "";
    this.el.dataset.muted = d.muted ? "true" : "false";
    this.grid.innerHTML =
      this.stat("Level", String(d.level)) +
      this.stat("Ascensions", String(d.ascension)) +
      this.stat("Lifetime points", Math.floor(d.totalPoints).toLocaleString()) +
      this.stat("Specials found", `${d.discovered} / ${d.totalSpecials}`) +
      this.stat("Achievements", `${d.achievements} / ${d.totalAchievements}`) +
      this.stat("Colors unlocked", `${d.colors} / ${d.totalColors}`) +
      this.stat("Buff levels", String(d.buffTiers));
    this.hapticsBtn.textContent = `Haptics: ${d.haptics ? "On" : "Off"}`;
    this.hapticsBtn.classList.toggle("on", d.haptics);
    this.soundBtn.textContent = `Sound: ${d.muted ? "Off" : "On"}`;
    this.soundBtn.classList.toggle("on", !d.muted);
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle("hidden-ui", !v);
    if (v) this.refresh();
  }
}
