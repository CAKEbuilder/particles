// Obstacle shapes + accurate per-shape collision against the swarm. Add a new shape by
// extending the union + adding a branch in resolveShape (kept batch-style for speed).

export interface Edge {
  nx: number; // outward unit normal
  ny: number;
  c: number; // line: nx*x + ny*y = c  (outside when nx*x+ny*y > c)
}

export interface CircleShape {
  kind: "circle";
  x: number;
  y: number;
  r: number;
}

export interface TriangleShape {
  kind: "triangle";
  x: number;
  y: number;
  r: number; // half-extent (matches the drawn 2r box)
  edges: Edge[];
}

export interface WallShape {
  kind: "wall";
  x: number; // center
  y: number;
  hw: number; // half-width
  hh: number; // half-height
  edges: Edge[]; // 4 outward-normal edges (axis-aligned, so nx/ny are ±1 or 0)
}

export type Shape = CircleShape | TriangleShape | WallShape;

/** Upside-down triangle matching the rendered clip-path: verts (x±r, y-r) and (x, y+r). */
export function makeTriangle(x: number, y: number, r: number): TriangleShape {
  const verts: [number, number][] = [
    [x - r, y - r],
    [x + r, y - r],
    [x, y + r],
  ];
  const edges: Edge[] = [];
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = verts[i];
    const [bx, by] = verts[(i + 1) % 3];
    let nx = by - ay;
    let ny = -(bx - ax);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    // ensure the normal points away from the centroid (outward)
    if (nx * (ax - x) + ny * (ay - y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    edges.push({ nx, ny, c: nx * ax + ny * ay });
  }
  return { kind: "triangle", x, y, r, edges };
}

/** Axis-aligned rectangle (wall segment). Edges point outward along ±x/±y. */
export function makeWall(x: number, y: number, hw: number, hh: number): WallShape {
  return {
    kind: "wall",
    x, y, hw, hh,
    edges: [
      { nx: -1, ny: 0, c: -(x - hw) }, // left face, outward = -x, c = -(x - hw)
      { nx: 1,  ny: 0, c: x + hw },    // right face
      { nx: 0,  ny: -1, c: -(y - hh) }, // top face
      { nx: 0,  ny: 1,  c: y + hh },   // bottom face
    ],
  };
}

/**
 * Push any particles inside `shape` out to its surface and reflect their inward velocity.
 * Batched for speed (one tight loop per shape). `restitution` 0..1.
 */
export function resolveShape(
  shape: Shape,
  px: Float32Array,
  py: Float32Array,
  vx: Float32Array,
  vy: Float32Array,
  count: number,
  restitution: number
): void {
  const bounce = 1 + restitution;

  if (shape.kind === "circle") {
    const { x, y, r } = shape;
    const r2 = r * r;
    for (let i = 0; i < count; i++) {
      const dx = px[i] - x;
      const dy = py[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2 && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        px[i] = x + nx * r;
        py[i] = y + ny * r;
        const vn = vx[i] * nx + vy[i] * ny;
        if (vn < 0) {
          vx[i] -= bounce * vn * nx;
          vy[i] -= bounce * vn * ny;
        }
      }
    }
    return;
  }

  // triangle: inside iff on the inner side of all edges
  if (shape.kind === "triangle") {
    const edges = shape.edges;
    const e0 = edges[0];
    const e1 = edges[1];
    const e2 = edges[2];
    for (let i = 0; i < count; i++) {
      const x = px[i];
      const y = py[i];
      const d0 = e0.nx * x + e0.ny * y - e0.c;
      if (d0 > 0) continue;
      const d1 = e1.nx * x + e1.ny * y - e1.c;
      if (d1 > 0) continue;
      const d2 = e2.nx * x + e2.ny * y - e2.c;
      if (d2 > 0) continue;
      // inside: pick the nearest edge (largest d, closest to 0) and push out along it
      let nx = e0.nx;
      let ny = e0.ny;
      let maxD = d0;
      if (d1 > maxD) { maxD = d1; nx = e1.nx; ny = e1.ny; }
      if (d2 > maxD) { maxD = d2; nx = e2.nx; ny = e2.ny; }
      px[i] = x - maxD * nx;
      py[i] = y - maxD * ny;
      const vn = vx[i] * nx + vy[i] * ny;
      if (vn < 0) { vx[i] -= bounce * vn * nx; vy[i] -= bounce * vn * ny; }
    }
    return;
  }

  // wall (axis-aligned rectangle): same edge push-out, 4 edges
  const edges = shape.edges;
  const e0 = edges[0];
  const e1 = edges[1];
  const e2 = edges[2];
  const e3 = edges[3];
  for (let i = 0; i < count; i++) {
    const x = px[i];
    const y = py[i];
    const d0 = e0.nx * x + e0.ny * y - e0.c;
    if (d0 > 0) continue;
    const d1 = e1.nx * x + e1.ny * y - e1.c;
    if (d1 > 0) continue;
    const d2 = e2.nx * x + e2.ny * y - e2.c;
    if (d2 > 0) continue;
    const d3 = e3.nx * x + e3.ny * y - e3.c;
    if (d3 > 0) continue;
    let nx = e0.nx;
    let ny = e0.ny;
    let maxD = d0;
    if (d1 > maxD) { maxD = d1; nx = e1.nx; ny = e1.ny; }
    if (d2 > maxD) { maxD = d2; nx = e2.nx; ny = e2.ny; }
    if (d3 > maxD) { maxD = d3; nx = e3.nx; ny = e3.ny; }
    px[i] = x - maxD * nx;
    py[i] = y - maxD * ny;
    const vn = vx[i] * nx + vy[i] * ny;
    if (vn < 0) { vx[i] -= bounce * vn * nx; vy[i] -= bounce * vn * ny; }
  }
}
