// Progress / stats / settings screen: visual bars for completion, header for identity.

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
  private body: HTMLDivElement;
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

    this.body = document.createElement("div");
    this.body.className = "prog-body";
    this.el.appendChild(this.body);

    const settings = document.createElement("div");
    settings.className = "prog-settings";
    this.hapticsBtn = this.toggleBtn("Haptics", () => {
      const on = !this.el.dataset.haptics;
      this.opts.onToggleHaptics(on);
      this.refresh();
    });
    this.soundBtn = this.toggleBtn("Sound", () => {
      const on = this.el.dataset.muted === "true";
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

  private bar(label: string, value: number, total: number, color: string): string {
    const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
    return `
      <div class="prog-bar-row">
        <div class="prog-bar-header">
          <span class="prog-bar-label">${label}</span>
          <span class="prog-bar-frac">${value} / ${total}</span>
        </div>
        <div class="prog-bar-track">
          <div class="prog-bar-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div>
        </div>
      </div>`;
  }

  refresh(): void {
    const d = this.opts.getData();
    this.el.dataset.haptics = d.haptics ? "true" : "";
    this.el.dataset.muted = d.muted ? "true" : "false";

    // identity header
    const identity = `
      <div class="prog-identity">
        <div class="prog-id-item">
          <span class="prog-id-val">${d.level}</span>
          <span class="prog-id-key">Level</span>
        </div>
        <div class="prog-id-item">
          <span class="prog-id-val">${d.ascension}</span>
          <span class="prog-id-key">Ascensions</span>
        </div>
        <div class="prog-id-item">
          <span class="prog-id-val">${Math.floor(d.totalPoints).toLocaleString()}</span>
          <span class="prog-id-key">Lifetime pts</span>
        </div>
      </div>`;

    // completion bars
    const bars =
      this.bar("Visitors found", d.discovered, d.totalSpecials, "linear-gradient(90deg,#2ee6ff,#b06bff)") +
      this.bar("Achievements", d.achievements, d.totalAchievements, "linear-gradient(90deg,#ffb13b,#ff5bd0)") +
      this.bar("Colors unlocked", d.colors, d.totalColors, "linear-gradient(90deg,#3bff9e,#2ee6ff)");

    // buff tally (just a number, not a fraction)
    const buffLine = `
      <div class="prog-buff-tally">
        <span class="prog-buff-label">Buff levels purchased</span>
        <span class="prog-buff-val">${d.buffTiers}</span>
      </div>`;

    this.body.innerHTML = identity + bars + buffLine;

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
