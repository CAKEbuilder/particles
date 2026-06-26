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

export interface BoxShape {
  kind: "box";
  x: number; y: number;   // center (world px)
  hw: number; hh: number; // half-length along local x, half-thickness along local y
  cos: number; sin: number; // rotation (precomputed)
  angle: number; // stored for serialisation
}

export type Shape = CircleShape | TriangleShape | WallShape | BoxShape;

/** Upside-down triangle matching the rendered clip-path: verts (x±r, y-r) and (x, y+r). Optional rotation angle (rad). */
export function makeTriangle(x: number, y: number, r: number, angle = 0): TriangleShape {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const rotate = (dx: number, dy: number): [number, number] => [
    x + cos * dx - sin * dy,
    y + sin * dx + cos * dy,
  ];
  const verts: [number, number][] = [
    rotate(-r, -r),
    rotate( r, -r),
    rotate( 0,  r),
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

/** Oriented box (covers lines and rectangles). hw = half-length, hh = half-thickness. */
export function makeBox(x: number, y: number, hw: number, hh: number, angle: number): BoxShape {
  return { kind: "box", x, y, hw, hh, angle, cos: Math.cos(angle), sin: Math.sin(angle) };
}

/**
 * Resolve particles against an oriented box with a swept (anti-tunnel) thin-axis check.
 * `dt` is the physics step so we can compute the previous position.
 */
export function resolveBox(
  shape: BoxShape,
  px: Float32Array,
  py: Float32Array,
  vx: Float32Array,
  vy: Float32Array,
  count: number,
  restitution: number,
  dt: number
): void {
  const { x, y, hw, hh, cos, sin } = shape;
  const bounce = 1 + restitution;

  for (let i = 0; i < count; i++) {
    const dx = px[i] - x;
    const dy = py[i] - y;
    // current local coords
    const lx =  cos * dx + sin * dy;
    const ly = -sin * dx + cos * dy;

    // previous local y (thin-axis tunnel check)
    const ply = ly - (-sin * vx[i] + cos * vy[i]) * dt;

    const insideX = Math.abs(lx) < hw;
    const insideY = Math.abs(ly) < hh;

    if (insideX && insideY) {
      // inside box — push out along the nearer face
      const ox = hw - Math.abs(lx);
      const oy = hh - Math.abs(ly);
      let nlx = 0, nly = 0;
      if (oy < ox) {
        nly = ly < 0 ? -1 : 1;
        const py_ = nly * hh;
        px[i] += (py_ - ly) * (-sin);
        py[i] += (py_ - ly) * cos;
        const lvy = -sin * vx[i] + cos * vy[i];
        if (lvy * nly < 0) {
          vx[i] += bounce * (-lvy * nly) * (-sin) * nly;
          vy[i] += bounce * (-lvy * nly) * cos * nly;
        }
      } else {
        nlx = lx < 0 ? -1 : 1;
        const px_ = nlx * hw;
        px[i] += (px_ - lx) * cos;
        py[i] += (px_ - lx) * sin;
        const lvx = cos * vx[i] + sin * vy[i];
        if (lvx * nlx < 0) {
          vx[i] -= bounce * lvx * nlx * cos * nlx;
          vy[i] -= bounce * lvx * nlx * sin * nlx;
        }
      }
      continue;
    }

    // swept thin-axis check: did the particle cross the hh slab this step?
    if (insideX && Math.sign(ply) !== Math.sign(ly) && Math.sign(ply) !== 0) {
      const nly = ply < 0 ? -1 : 1;
      // snap to entry-side surface
      const snapY = nly * hh;
      px[i] += (snapY - ly) * (-sin);
      py[i] += (snapY - ly) * cos;
      const lvy = -sin * vx[i] + cos * vy[i];
      if (lvy * nly < 0) {
        const dvly = bounce * lvy;
        vx[i] -= dvly * (-sin);
        vy[i] -= dvly * cos;
      }
    }
  }
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
  if (shape.kind !== "wall") return;
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
