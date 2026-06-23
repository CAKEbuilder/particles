// Rewind / time machine (backlog). Built on DETERMINISTIC REPLAY rather than storing
// every particle position: record the initial seed + a timeline of user actions and
// re-simulate. "Change something and retry" = fork the action timeline at a point.
//
// Scaffold only — memory-cheap and elegant, deferred per the roadmap.

export interface TimelineAction {
  t: number; // sim time (s)
  type: "spawn" | "force" | "tool" | "clear";
  data: unknown;
}

export class TimeMachine {
  private actions: TimelineAction[] = [];
  seed = 0;

  record(action: TimelineAction): void {
    this.actions.push(action);
  }

  /** Fork the timeline at sim-time `t`, dropping everything after it. */
  forkAt(t: number): TimelineAction[] {
    this.actions = this.actions.filter((a) => a.t <= t);
    return this.actions;
  }

  clear(): void {
    this.actions.length = 0;
  }
}
