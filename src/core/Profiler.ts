// Lightweight phase profiler. Times named sections, accumulates over a ~1s window,
// and logs rolling averages (ms/frame) to the console so we can optimize from data.
// Also exposed on window.__perf for ad-hoc inspection.

interface Section {
  sum: number;
  start: number;
}

export class Profiler {
  enabled = true;
  private sections = new Map<string, Section>();
  private order: string[] = [];
  private frames = 0;
  private substeps = 0;
  private windowStart = performance.now();
  private lastReport = "";

  begin(name: string): void {
    if (!this.enabled) return;
    let s = this.sections.get(name);
    if (!s) {
      s = { sum: 0, start: 0 };
      this.sections.set(name, s);
      this.order.push(name);
    }
    s.start = performance.now();
  }

  end(name: string): void {
    if (!this.enabled) return;
    const s = this.sections.get(name);
    if (s) s.sum += performance.now() - s.start;
  }

  countSubsteps(n: number): void {
    this.substeps += n;
  }

  /** Call once per rendered frame. Logs a summary roughly once per second. */
  tick(fps: number, particles: number): void {
    if (!this.enabled) return;
    this.frames++;
    const now = performance.now();
    const elapsed = now - this.windowStart;
    if (elapsed < 1000) return;

    const f = this.frames || 1;
    const parts: string[] = [];
    for (const name of this.order) {
      const s = this.sections.get(name)!;
      parts.push(`${name}=${(s.sum / f).toFixed(2)}`);
      s.sum = 0;
    }
    const subPerFrame = (this.substeps / f).toFixed(2);
    this.lastReport =
      `[perf] fps=${fps.toFixed(0)} n=${particles} substeps/frame=${subPerFrame} | ` +
      parts.join(" ") +
      " (ms/frame)";
    // eslint-disable-next-line no-console
    console.log(this.lastReport);

    this.frames = 0;
    this.substeps = 0;
    this.windowStart = now;
  }

  get report(): string {
    return this.lastReport;
  }
}

export const perf = new Profiler();

declare global {
  interface Window {
    __perf?: Profiler;
  }
}
if (typeof window !== "undefined") window.__perf = perf;
