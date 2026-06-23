// Score / flow mode (milestone 2). Particles travel from a spawn zone to a finish
// zone: +1 scored, -1 lost. Tension/positivity scales as you approach the goal.
//
// Scaffold only — wired up in the score-mode milestone.

import type { Rect } from "../level/Level";
import type { ParticleSystem } from "../sim/ParticleSystem";

export interface ScoreState {
  score: number;
  goal: number;
  progress: number; // 0..1 toward goal, drives tension scaling
}

export class ScoreMode {
  score = 0;

  constructor(
    private readonly system: ParticleSystem,
    private readonly spawnZone: Rect,
    private readonly finishZone: Rect,
    private readonly goal = 1_000_000
  ) {}

  /** Check particles against the finish zone; tally and remove the ones that scored. */
  update(): ScoreState {
    void this.system;
    void this.spawnZone;
    void this.finishZone;
    // TODO: iterate particles, +1 in finish zone (remove), -1 when lost off-board.
    return {
      score: this.score,
      goal: this.goal,
      progress: Math.max(0, Math.min(1, this.score / this.goal)),
    };
  }
}
