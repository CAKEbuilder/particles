// Floating edge indicator that pre-announces an incoming special: pinned near the
// entry point, shows a preview (if discovered) or a tier-styled ??? (if new), with a
// countdown timer. A chevron points back toward where the special is COMING FROM, and
// the whole indicator sweeps inward along the incoming trajectory so the path is clear.

export interface AlertOpts {
  x: number; // entry point (px)
  y: number;
  color: string;
  holo: boolean; // holographic shimmer for rare tiers
  glyph: string; // shown when known
  known: boolean;
  angle: number; // INWARD heading the special travels (deg)
}

const SWEEP_DIST = 42; // px the indicator sweeps inward per cycle
const SWEEP_PERIOD = 1.1; // s per sweep

export class Alert {
  private el: HTMLDivElement;
  private timer: HTMLDivElement;
  private baseX: number;
  private baseY: number;
  private dirX: number;
  private dirY: number;
  private t = 0;

  constructor(parent: HTMLElement, opts: AlertOpts) {
    const rad = (opts.angle * Math.PI) / 180;
    this.dirX = Math.cos(rad);
    this.dirY = Math.sin(rad);

    this.el = document.createElement("div");
    this.el.className = "alert" + (opts.holo ? " holo" : "");
    this.el.style.setProperty("--c", opts.color);

    const icon = document.createElement("div");
    icon.className = "alert-icon";
    // Unknown visitors show a friendly sparkle instead of a threatening "?"
    icon.textContent = opts.known ? opts.glyph : "✦";
    if (!opts.known) icon.classList.add("alert-unknown");

    this.timer = document.createElement("div");
    this.timer.className = "alert-timer";

    // chevron points back toward the origin (where it's coming FROM = opposite travel)
    const arrow = document.createElement("div");
    arrow.className = "alert-arrow";
    arrow.style.setProperty("--a", `${opts.angle + 180}deg`);

    this.el.append(arrow, icon, this.timer);
    parent.appendChild(this.el);

    const m = 30;
    const mBottom = 130; // clear the HUD toolbar on mobile (toolbar ~120px on iPhone)
    this.baseX = Math.max(m, Math.min(window.innerWidth - m, opts.x));
    this.baseY = Math.max(m + 40, Math.min(window.innerHeight - mBottom, opts.y));
    this.place(0);
  }

  private place(off: number): void {
    this.el.style.left = `${this.baseX + this.dirX * off}px`;
    this.el.style.top = `${this.baseY + this.dirY * off}px`;
  }

  /** Sweep inward along the incoming trajectory to convey motion + direction. */
  update(dt: number): void {
    this.t += dt;
    const phase = (this.t % SWEEP_PERIOD) / SWEEP_PERIOD; // 0..1
    this.place(phase * SWEEP_DIST);
    this.el.style.opacity = `${0.55 + 0.45 * (1 - phase)}`; // brightest at the origin
  }

  setCountdown(seconds: number): void {
    this.timer.textContent = seconds > 0 ? `${Math.ceil(seconds)}s` : "";
  }

  remove(): void {
    this.el.remove();
  }
}
