// Fixed-timestep game loop with an accumulator: stable, frame-rate-independent physics.

export class Loop {
  private rafId = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  private fpsAcc = 0;
  private fpsFrames = 0;
  fps = 0;
  lastSubSteps = 0;

  constructor(
    private readonly fixedDt: number,
    private readonly maxSubSteps: number,
    private readonly update: (dt: number) => void,
    private readonly render: () => void
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  get isRunning(): boolean {
    return this.running;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    let frame = (now - this.last) / 1000;
    this.last = now;
    if (frame > 0.25) frame = 0.25; // tab was backgrounded etc.

    this.acc += frame;
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < this.maxSubSteps) {
      this.update(this.fixedDt);
      this.acc -= this.fixedDt;
      steps++;
    }
    // if we blew the budget, drop the backlog rather than spiral
    if (steps === this.maxSubSteps) this.acc = 0;
    this.lastSubSteps = steps;

    this.render();

    // fps (smoothed over ~0.5s)
    this.fpsAcc += frame;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  };
}
