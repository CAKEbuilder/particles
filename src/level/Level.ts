// Data-driven level definitions (milestone 3). A level is just data + a few behaviours,
// so boards are easy to author and maintain.

import type { ForcePoint } from "../sim/ParticleSystem";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Obstacle =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "triangle"; x: number; y: number; size: number; flip: boolean };

export interface MovingObstacle {
  obstacle: Obstacle;
  // simple oscillation path; t in seconds
  axis: "x" | "y";
  amplitude: number;
  period: number;
}

export interface LevelDef {
  id: string;
  name: string;
  gravity: boolean;
  obstacles: Obstacle[];
  movers: MovingObstacle[];
  fields: ForcePoint[]; // static force regions
  spawnZone?: Rect; // for score/flow mode
  finishZone?: Rect;
}

export const SANDBOX: LevelDef = {
  id: "sandbox",
  name: "Sandbox",
  gravity: false,
  obstacles: [],
  movers: [],
  fields: [],
};
