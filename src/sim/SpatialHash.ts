// Uniform-grid spatial hash built with a counting sort. No per-frame allocations
// once warmed up. Gives O(n) neighbour queries for the separation pass.

export class SpatialHash {
  cellSize: number;
  cols = 0;
  rows = 0;

  // counting-sort scratch (preallocated, grown as needed)
  cellStart: Int32Array = new Int32Array(1); // length cols*rows + 1
  order: Int32Array = new Int32Array(1); // particle indices grouped by cell
  private counts: Int32Array = new Int32Array(1);

  constructor(cellSize: number) {
    this.cellSize = Math.max(1, cellSize);
  }

  /** Rebuild the grid for the first `count` particles within [0,w]x[0,h]. */
  build(px: Float32Array, py: Float32Array, count: number, w: number, h: number): void {
    const cell = this.cellSize;
    const cols = Math.max(1, Math.ceil(w / cell));
    const rows = Math.max(1, Math.ceil(h / cell));
    this.cols = cols;
    this.rows = rows;

    const nCells = cols * rows;
    if (this.cellStart.length < nCells + 1) this.cellStart = new Int32Array(nCells + 1);
    if (this.counts.length < nCells) this.counts = new Int32Array(nCells);
    if (this.order.length < count) this.order = new Int32Array(count);

    const counts = this.counts;
    counts.fill(0, 0, nCells);

    // 1) count per cell
    for (let i = 0; i < count; i++) {
      const c = this.cellIndex(px[i], py[i]);
      counts[c]++;
    }

    // 2) prefix sum -> cellStart
    const cellStart = this.cellStart;
    let sum = 0;
    for (let c = 0; c < nCells; c++) {
      cellStart[c] = sum;
      sum += counts[c];
    }
    cellStart[nCells] = sum;

    // 3) scatter indices (reuse counts as a moving cursor)
    counts.set(cellStart.subarray(0, nCells));
    const order = this.order;
    for (let i = 0; i < count; i++) {
      const c = this.cellIndex(px[i], py[i]);
      order[counts[c]++] = i;
    }
  }

  cellIndex(x: number, y: number): number {
    let cx = (x / this.cellSize) | 0;
    let cy = (y / this.cellSize) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }

  clampCol(x: number): number {
    let cx = (x / this.cellSize) | 0;
    if (cx < 0) cx = 0;
    else if (cx >= this.cols) cx = this.cols - 1;
    return cx;
  }

  clampRow(y: number): number {
    let cy = (y / this.cellSize) | 0;
    if (cy < 0) cy = 0;
    else if (cy >= this.rows) cy = this.rows - 1;
    return cy;
  }
}
