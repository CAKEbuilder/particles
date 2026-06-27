// Sandbox maze editor: draw lines, place shapes, persist layouts to localStorage.
// Runs alongside (not inside) Playfield — owns its own collision + DOM overlays.

import { config } from "../config";
import type { CpuParticleSystem } from "../sim/CpuParticleSystem";
import type { Input } from "../input/Input";
import {
  makeBox, makeTriangle, resolveBox, resolveShape,
  type BoxShape, type CircleShape, type TriangleShape,
} from "../level/shapes";

type EditorTool = "line" | "box" | "circle" | "triangle" | "move" | "resize" | "delete";

interface LineItem {
  kind: "line";
  x1: number; y1: number;
  x2: number; y2: number;
  shape: BoxShape;
  el: HTMLDivElement;
}

interface BoxItem {
  kind: "box";
  x: number; y: number;
  hw: number; hh: number;
  angle: number;
  shape: BoxShape;
  el: HTMLDivElement;
}

interface CircleItem {
  kind: "circle";
  x: number; y: number;
  r: number;
  shape: CircleShape;
  el: HTMLDivElement;
}

interface TriItem {
  kind: "triangle";
  x: number; y: number;
  r: number;
  angle: number;
  shape: TriangleShape;
  el: HTMLDivElement;
}

type EditorItem = LineItem | BoxItem | CircleItem | TriItem;

interface SavedItem {
  kind: EditorItem["kind"];
  x1?: number; y1?: number; x2?: number; y2?: number;
  x?: number; y?: number;
  hw?: number; hh?: number;
  r?: number;
  angle?: number;
}

const STORAGE_KEY = "particles.editor.v1";
const MAX_HISTORY = 50;

function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

function snapAngle(a: number, stepDeg: number): number {
  const step = stepDeg * Math.PI / 180;
  return Math.round(a / step) * step;
}

export class SandboxEditor {
  private items: EditorItem[] = [];
  private tool: EditorTool = "line";
  private snapEnabled = true;
  private active = false;
  private selected: EditorItem | null = null;

  // drag state
  private dragging = false;
  private dragHandle: "body" | "p1" | "p2" | "rotate" | null = null;
  private dragStartX = 0; private dragStartY = 0;
  private dragItemStart: SavedItem | null = null;
  private previewEl: HTMLDivElement | null = null;

  // undo / redo
  private history: SavedItem[][] = [];
  private histIdx = -1;

  private toolbar: HTMLDivElement;
  private toolBtns = new Map<string, HTMLButtonElement>();
  private selectionRing: HTMLDivElement;

  constructor(
    private readonly parent: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly system: CpuParticleSystem,
    private readonly input: Input,
  ) {
    this.toolbar = this.buildToolbar();
    this.selectionRing = document.createElement("div");
    this.selectionRing.className = "editor-selection";
    this.parent.appendChild(this.selectionRing);

    this.canvas.addEventListener("pointerdown", this.onDown);
    this.canvas.addEventListener("pointermove", this.onMove);
    this.canvas.addEventListener("pointerup", this.onUp);
    this.canvas.addEventListener("pointercancel", this.onUp);
    window.addEventListener("keydown", this.onKey);

    this.load();
    this.pushHistory(); // initial state
    this.setActive(false);
  }

  setActive(on: boolean): void {
    this.active = on;
    this.toolbar.classList.toggle("hidden-ui", !on);
    if (!on) {
      this.selected = null;
      this.selectionRing.style.display = "none";
      this.input.suspended = false;
    }
    for (const item of this.items) {
      item.el.classList.toggle("hidden-ui", !on);
    }
  }

  /** Called every physics step (after system.step). */
  resolve(dt: number): void {
    if (!this.active) return;
    const { px, py, vx, vy, count } = this.system;
    const r = config.editor.restitution;
    for (const item of this.items) {
      if (item.kind === "line" || item.kind === "box") {
        resolveBox(item.shape, px, py, vx, vy, count, r, dt);
      } else {
        resolveShape(item.shape, px, py, vx, vy, count, r);
      }
    }
  }

  // ---- toolbar ----

  private buildToolbar(): HTMLDivElement {
    const bar = document.createElement("div");
    bar.className = "editor-toolbar";

    const group = (keys: string[], labels: string[], actions: (() => void)[]): void => {
      const g = document.createElement("div");
      g.className = "editor-toolbar-group";
      for (let i = 0; i < keys.length; i++) {
        const b = document.createElement("button");
        b.className = "hud-btn";
        b.textContent = labels[i];
        b.addEventListener("click", actions[i]);
        g.appendChild(b);
        this.toolBtns.set(keys[i], b);
      }
      bar.appendChild(g);
    };

    group(
      ["line", "box", "circle", "triangle"],
      ["Line", "Box", "Circle", "Triangle"],
      [
        () => this.selectTool("line"),
        () => this.selectTool("box"),
        () => this.selectTool("circle"),
        () => this.selectTool("triangle"),
      ],
    );

    group(
      ["move", "resize", "delete"],
      ["Move", "Resize", "Delete"],
      [
        () => this.selectTool("move"),
        () => this.selectTool("resize"),
        () => this.deleteSelected(),
      ],
    );

    group(
      ["snap", "undo", "redo", "clear"],
      ["Snap ✓", "Undo", "Redo", "Clear All"],
      [
        () => this.toggleSnap(),
        () => this.undo(),
        () => this.redo(),
        () => this.clearAll(),
      ],
    );

    this.parent.appendChild(bar);
    this.syncToolBtns();
    return bar;
  }

  private selectTool(t: EditorTool): void {
    this.tool = t;
    // all editor tools suspend particle input so you don't accidentally spawn
    this.input.suspended = true;
    this.syncToolBtns();
    if (t !== "move" && t !== "resize") this.clearSelection();
  }

  /** Called by Hud when a play tool is selected — unsuspend input. */
  onPlayToolSelected(): void {
    this.tool = "move"; // keep a neutral editor tool selected visually
    this.input.suspended = false;
    this.syncToolBtns();
    this.clearSelection();
  }

  private syncToolBtns(): void {
    for (const [key, btn] of this.toolBtns) {
      if (key === "snap") {
        btn.textContent = this.snapEnabled ? "Snap ✓" : "Snap";
        btn.classList.toggle("active", this.snapEnabled);
      } else if (key === "undo") {
        btn.classList.toggle("active", false);
        btn.disabled = this.histIdx <= 0;
      } else if (key === "redo") {
        btn.classList.toggle("active", false);
        btn.disabled = this.histIdx >= this.history.length - 1;
      } else if (key === "clear" || key === "delete") {
        btn.classList.remove("active");
      } else {
        btn.classList.toggle("active", key === this.tool);
      }
    }
  }

  private toggleSnap(): void {
    this.snapEnabled = !this.snapEnabled;
    this.syncToolBtns();
  }

  private toLocal(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ---- undo / redo ----

  private pushHistory(): void {
    const snapshot = this.items.map(i => this.serializeItem(i));
    this.history = this.history.slice(0, this.histIdx + 1);
    this.history.push(snapshot);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.histIdx = this.history.length - 1;
    this.syncToolBtns();
  }

  private undo(): void {
    if (this.histIdx <= 0) return;
    this.histIdx--;
    this.restoreSnapshot(this.history[this.histIdx]);
    this.syncToolBtns();
  }

  private redo(): void {
    if (this.histIdx >= this.history.length - 1) return;
    this.histIdx++;
    this.restoreSnapshot(this.history[this.histIdx]);
    this.syncToolBtns();
  }

  private restoreSnapshot(snapshot: SavedItem[]): void {
    for (const item of this.items) item.el.remove();
    this.items.length = 0;
    this.clearSelection();
    for (const s of snapshot) this.restoreItem(s);
    this.save();
  }

  // ---- pointer handlers ----

  private onDown = (e: PointerEvent): void => {
    if (!this.active) return;
    const [x, y] = this.toLocal(e);

    if (this.tool === "move" || this.tool === "resize") {
      const hit = this.hitTest(x, y);
      if (hit) {
        this.setSelected(hit.item);
        this.dragHandle = hit.handle;
        this.dragging = true;
        this.dragStartX = x; this.dragStartY = y;
        this.dragItemStart = this.serializeItem(hit.item);
        try { this.canvas.setPointerCapture(e.pointerId); } catch { /**/ }
      } else {
        this.clearSelection();
      }
      return;
    }

    if (this.tool === "delete") {
      const hit = this.hitTest(x, y);
      if (hit) this.removeItem(hit.item);
      return;
    }

    // creation tools
    this.dragging = true;
    this.dragStartX = x; this.dragStartY = y;
    this.previewEl = document.createElement("div");
    this.previewEl.className = "editor-preview";
    this.parent.appendChild(this.previewEl);
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /**/ }
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.active || !this.dragging) return;
    const [x, y] = this.toLocal(e);

    if ((this.tool === "move" || this.tool === "resize") && this.selected && this.dragHandle) {
      this.applyDrag(x, y);
      return;
    }

    if (this.previewEl) {
      this.updatePreview(this.dragStartX, this.dragStartY, x, y, this.previewEl);
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.active || !this.dragging) return;
    const [x, y] = this.toLocal(e);
    this.dragging = false;

    if (this.tool !== "move" && this.tool !== "resize" && this.tool !== "delete" && this.previewEl) {
      this.previewEl.remove();
      this.previewEl = null;
      this.finalizeCreate(this.dragStartX, this.dragStartY, x, y);
    } else if ((this.tool === "move" || this.tool === "resize") && this.dragItemStart && this.selected) {
      // only push history if something actually moved
      const after = this.serializeItem(this.selected);
      if (JSON.stringify(after) !== JSON.stringify(this.dragItemStart)) {
        this.pushHistory();
        this.save();
      }
    }

    this.dragHandle = null;
    this.dragItemStart = null;
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.active) return;
    if ((e.key === "Delete" || e.key === "Backspace") && this.selected) {
      e.preventDefault();
      this.deleteSelected();
    }
    if (e.key === "Escape") this.clearSelection();
    if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); this.undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); this.redo(); }
  };

  // ---- creation ----

  private applySnap(x: number, y: number): [number, number] {
    if (!this.snapEnabled) return [x, y];
    const g = config.editor.snapGrid;
    return [snap(x, g), snap(y, g)];
  }

  private lineAngle(x1: number, y1: number, x2: number, y2: number): number {
    let a = Math.atan2(y2 - y1, x2 - x1);
    if (this.snapEnabled) a = snapAngle(a, config.editor.snapAngleDeg);
    return a;
  }

  private finalizeCreate(x1: number, y1: number, x2: number, y2: number): void {
    [x1, y1] = this.applySnap(x1, y1);
    [x2, y2] = this.applySnap(x2, y2);

    if (this.tool === "line") {
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (len < 4) return;
      const angle = this.lineAngle(x1, y1, x2, y2);
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const item = this.createLine(x1, y1, x2, y2, cx, cy, len / 2, angle);
      this.items.push(item);
      this.setSelected(item);
    } else if (this.tool === "box") {
      const hw = Math.abs(x2 - x1) / 2;
      const hh = Math.abs(y2 - y1) / 2;
      if (hw < 4 && hh < 4) return;
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const item = this.createBox(cx, cy, Math.max(4, hw), Math.max(4, hh), 0);
      this.items.push(item);
      this.setSelected(item);
    } else if (this.tool === "circle") {
      const r = Math.max(8, Math.hypot(x2 - x1, y2 - y1));
      const item = this.createCircle(x1, y1, r);
      this.items.push(item);
      this.setSelected(item);
    } else if (this.tool === "triangle") {
      const r = Math.max(12, Math.hypot(x2 - x1, y2 - y1));
      const item = this.createTriangle(x1, y1, r, 0);
      this.items.push(item);
      this.setSelected(item);
    }

    this.pushHistory();
    this.save();
  }

  private updatePreview(x1: number, y1: number, x2: number, y2: number, el: HTMLDivElement): void {
    [x1, y1] = this.applySnap(x1, y1);
    [x2, y2] = this.applySnap(x2, y2);

    if (this.tool === "line") {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const angle = this.lineAngle(x1, y1, x2, y2);
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      el.style.cssText = lineCSS(cx, cy, len, config.editor.lineThickness * 2, angle);
    } else if (this.tool === "box") {
      const hw = Math.abs(x2 - x1) / 2, hh = Math.abs(y2 - y1) / 2;
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      el.style.cssText = boxCSS(cx, cy, hw * 2, hh * 2, 0);
    } else if (this.tool === "circle") {
      el.style.cssText = circleCSS(x1, y1, Math.hypot(x2 - x1, y2 - y1));
    } else if (this.tool === "triangle") {
      el.style.cssText = triCSS(x1, y1, Math.hypot(x2 - x1, y2 - y1), 0);
    }
  }

  // ---- item factories ----

  private createLine(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, hw: number, angle: number): LineItem {
    const hh = config.editor.lineThickness;
    const el = document.createElement("div");
    el.className = "editor-item editor-line";
    el.style.cssText = lineCSS(cx, cy, hw * 2, hh * 2, angle);
    this.parent.appendChild(el);
    return { kind: "line", x1, y1, x2, y2, shape: makeBox(cx, cy, hw, hh, angle), el };
  }

  private createBox(x: number, y: number, hw: number, hh: number, angle: number): BoxItem {
    const el = document.createElement("div");
    el.className = "editor-item editor-box";
    el.style.cssText = boxCSS(x, y, hw * 2, hh * 2, angle);
    this.parent.appendChild(el);
    return { kind: "box", x, y, hw, hh, angle, shape: makeBox(x, y, hw, hh, angle), el };
  }

  private createCircle(x: number, y: number, r: number): CircleItem {
    const el = document.createElement("div");
    el.className = "editor-item editor-circle";
    el.style.cssText = circleCSS(x, y, r);
    this.parent.appendChild(el);
    return { kind: "circle", x, y, r, shape: { kind: "circle", x, y, r }, el };
  }

  private createTriangle(x: number, y: number, r: number, angle: number): TriItem {
    const el = document.createElement("div");
    el.className = "editor-item editor-triangle";
    el.style.cssText = triCSS(x, y, r, angle);
    this.parent.appendChild(el);
    return { kind: "triangle", x, y, r, angle, shape: makeTriangle(x, y, r, angle), el };
  }

  // ---- selection + drag ----

  private setSelected(item: EditorItem): void {
    this.selected = item;
    this.updateSelectionRing();
  }

  private clearSelection(): void {
    this.selected = null;
    this.selectionRing.style.display = "none";
  }

  private updateSelectionRing(): void {
    const item = this.selected;
    if (!item) { this.selectionRing.style.display = "none"; return; }
    this.selectionRing.style.display = "block";
    const base = "border:2px solid var(--accent);background:transparent;z-index:10;";

    if (item.kind === "line") {
      const hw = Math.hypot(item.x2 - item.x1, item.y2 - item.y1) / 2;
      const cx = (item.x1 + item.x2) / 2, cy = (item.y1 + item.y2) / 2;
      const angle = Math.atan2(item.y2 - item.y1, item.x2 - item.x1);
      this.selectionRing.style.cssText = lineCSS(cx, cy, hw * 2, (config.editor.lineThickness + 8) * 2, angle) + base + "border-radius:4px;";
    } else if (item.kind === "box") {
      this.selectionRing.style.cssText = boxCSS(item.x, item.y, item.hw * 2 + 12, item.hh * 2 + 12, item.angle) + base;
    } else if (item.kind === "circle") {
      this.selectionRing.style.cssText = circleCSS(item.x, item.y, item.r + 8) + base;
    } else {
      this.selectionRing.style.cssText = boxCSS(item.x, item.y, item.r * 2 + 12, item.r * 2 + 12, 0) + base;
    }
  }

  /** Returns the hit item and a handle type (used to drive drag behaviour per mode). */
  private hitTest(x: number, y: number): { item: EditorItem; handle: "body" | "p1" | "p2" | "rotate" } | null {
    const hr = config.editor.handleRadius;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item.kind === "line") {
        if (this.tool === "resize") {
          if (dist(x, y, item.x1, item.y1) < hr * 1.5) return { item, handle: "p1" };
          if (dist(x, y, item.x2, item.y2) < hr * 1.5) return { item, handle: "p2" };
        }
        if (distToSegment(x, y, item.x1, item.y1, item.x2, item.y2) < hr) return { item, handle: "body" };
      } else if (item.kind === "box") {
        if (this.tool === "resize" && pointInBox(x, y, item.x, item.y, item.hw + hr, item.hh + hr, item.angle)) {
          // outer band = rotate, inner = resize
          const inner = pointInBox(x, y, item.x, item.y, item.hw * 0.55, item.hh * 0.55, item.angle);
          return { item, handle: inner ? "body" : "rotate" };
        }
        if (pointInBox(x, y, item.x, item.y, item.hw + hr, item.hh + hr, item.angle)) return { item, handle: "body" };
      } else if (item.kind === "circle") {
        if (dist(x, y, item.x, item.y) < item.r + hr) return { item, handle: "body" };
      } else if (item.kind === "triangle") {
        if (dist(x, y, item.x, item.y) < item.r + hr) {
          if (this.tool === "resize") {
            const inner = dist(x, y, item.x, item.y) < item.r * 0.5;
            return { item, handle: inner ? "body" : "rotate" };
          }
          return { item, handle: "body" };
        }
      }
    }
    return null;
  }

  private applyDrag(x: number, y: number): void {
    const item = this.selected;
    if (!item || !this.dragHandle || !this.dragItemStart) return;
    const dx = x - this.dragStartX, dy = y - this.dragStartY;

    if (this.tool === "move") {
      // Move: translate body
      if (item.kind === "line") {
        const nx1 = (this.dragItemStart.x1 ?? 0) + dx;
        const ny1 = (this.dragItemStart.y1 ?? 0) + dy;
        const nx2 = (this.dragItemStart.x2 ?? 0) + dx;
        const ny2 = (this.dragItemStart.y2 ?? 0) + dy;
        const [sx1, sy1] = this.applySnap(nx1, ny1);
        const [sx2, sy2] = this.applySnap(nx2, ny2);
        item.x1 = sx1; item.y1 = sy1; item.x2 = sx2; item.y2 = sy2;
        this.rebuildLine(item);
      } else if (item.kind === "box") {
        [item.x, item.y] = this.applySnap((this.dragItemStart.x ?? 0) + dx, (this.dragItemStart.y ?? 0) + dy);
        this.rebuildBox(item);
      } else if (item.kind === "circle") {
        [item.x, item.y] = this.applySnap((this.dragItemStart.x ?? 0) + dx, (this.dragItemStart.y ?? 0) + dy);
        this.rebuildCircle(item);
      } else if (item.kind === "triangle") {
        [item.x, item.y] = this.applySnap((this.dragItemStart.x ?? 0) + dx, (this.dragItemStart.y ?? 0) + dy);
        this.rebuildTriangle(item);
      }
    } else if (this.tool === "resize") {
      // Resize: change dimensions / endpoints / rotate
      if (item.kind === "line") {
        if (this.dragHandle === "p1") {
          [item.x1, item.y1] = this.applySnap(x, y);
        } else if (this.dragHandle === "p2") {
          [item.x2, item.y2] = this.applySnap(x, y);
        } else {
          // body drag on a line in resize mode: translate (same as move)
          item.x1 = (this.dragItemStart.x1 ?? 0) + dx;
          item.y1 = (this.dragItemStart.y1 ?? 0) + dy;
          item.x2 = (this.dragItemStart.x2 ?? 0) + dx;
          item.y2 = (this.dragItemStart.y2 ?? 0) + dy;
        }
        this.rebuildLine(item);
      } else if (item.kind === "box") {
        if (this.dragHandle === "rotate") {
          let a = Math.atan2(dy, dx);
          if (this.snapEnabled) a = snapAngle(a, config.editor.snapAngleDeg);
          item.angle = a;
        } else {
          // resize: drag offset from center defines new half-extents
          const ldx = Math.abs(dx), ldy = Math.abs(dy);
          item.hw = Math.max(6, (this.dragItemStart.hw ?? 6) + (dx > 0 ? ldx : -ldx));
          item.hh = Math.max(6, (this.dragItemStart.hh ?? 6) + (dy > 0 ? ldy : -ldy));
        }
        this.rebuildBox(item);
      } else if (item.kind === "circle") {
        item.r = Math.max(8, (this.dragItemStart.r ?? 8) + Math.hypot(dx, dy) * (dx + dy > 0 ? 1 : -1));
        this.rebuildCircle(item);
      } else if (item.kind === "triangle") {
        if (this.dragHandle === "rotate") {
          let a = Math.atan2(dy, dx);
          if (this.snapEnabled) a = snapAngle(a, config.editor.snapAngleDeg);
          item.angle = a;
        } else {
          item.r = Math.max(12, (this.dragItemStart.r ?? 12) + Math.hypot(dx, dy) * (dx + dy > 0 ? 1 : -1));
        }
        this.rebuildTriangle(item);
      }
    }

    this.updateSelectionRing();
  }

  // ---- shape rebuild helpers (update shape + DOM) ----

  private rebuildLine(item: LineItem): void {
    const cx = (item.x1 + item.x2) / 2, cy = (item.y1 + item.y2) / 2;
    const hw = Math.hypot(item.x2 - item.x1, item.y2 - item.y1) / 2;
    const angle = this.lineAngle(item.x1, item.y1, item.x2, item.y2);
    item.shape = makeBox(cx, cy, Math.max(1, hw), config.editor.lineThickness, angle);
    item.el.style.cssText = lineCSS(cx, cy, hw * 2, config.editor.lineThickness * 2, angle);
  }

  private rebuildBox(item: BoxItem): void {
    item.shape = makeBox(item.x, item.y, item.hw, item.hh, item.angle);
    item.el.style.cssText = boxCSS(item.x, item.y, item.hw * 2, item.hh * 2, item.angle);
  }

  private rebuildCircle(item: CircleItem): void {
    item.shape = { kind: "circle", x: item.x, y: item.y, r: item.r };
    item.el.style.cssText = circleCSS(item.x, item.y, item.r);
  }

  private rebuildTriangle(item: TriItem): void {
    item.shape = makeTriangle(item.x, item.y, item.r, item.angle);
    item.el.style.cssText = triCSS(item.x, item.y, item.r, item.angle);
  }

  // ---- deletion ----

  private deleteSelected(): void {
    if (this.selected) this.removeItem(this.selected);
  }

  private removeItem(item: EditorItem): void {
    item.el.remove();
    const idx = this.items.indexOf(item);
    if (idx >= 0) this.items.splice(idx, 1);
    if (this.selected === item) this.clearSelection();
    this.pushHistory();
    this.save();
  }

  private clearAll(): void {
    for (const item of this.items) item.el.remove();
    this.items.length = 0;
    this.clearSelection();
    this.pushHistory();
    this.save();
  }

  // ---- persistence ----

  private serializeItem(item: EditorItem): SavedItem {
    if (item.kind === "line") return { kind: "line", x1: item.x1, y1: item.y1, x2: item.x2, y2: item.y2 };
    if (item.kind === "box") return { kind: "box", x: item.x, y: item.y, hw: item.hw, hh: item.hh, angle: item.angle };
    if (item.kind === "circle") return { kind: "circle", x: item.x, y: item.y, r: item.r };
    return { kind: "triangle", x: item.x, y: item.y, r: item.r, angle: item.angle };
  }

  private restoreItem(s: SavedItem): void {
    if (s.kind === "line" && s.x1 !== undefined) {
      const x2 = s.x2 ?? 0, y2 = s.y2 ?? 0, y1 = s.y1 ?? 0;
      const cx = (s.x1 + x2) / 2, cy = (y1 + y2) / 2;
      const hw = Math.hypot(x2 - s.x1, y2 - y1) / 2;
      const angle = Math.atan2(y2 - y1, x2 - s.x1);
      this.items.push(this.createLine(s.x1, y1, x2, y2, cx, cy, hw, angle));
    } else if (s.kind === "box" && s.x !== undefined) {
      this.items.push(this.createBox(s.x, s.y ?? 0, s.hw ?? 40, s.hh ?? 40, s.angle ?? 0));
    } else if (s.kind === "circle" && s.x !== undefined) {
      this.items.push(this.createCircle(s.x, s.y ?? 0, s.r ?? 40));
    } else if (s.kind === "triangle" && s.x !== undefined) {
      this.items.push(this.createTriangle(s.x, s.y ?? 0, s.r ?? 40, s.angle ?? 0));
    }
  }

  private save(): void {
    const items = this.items.map(i => this.serializeItem(i));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, items })); } catch { /**/ }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { version: number; items: SavedItem[] };
      for (const s of data.items) this.restoreItem(s);
    } catch { /**/ }
  }
}

// ---- geometry helpers ----

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return dist(px, py, ax + t * dx, ay + t * dy);
}

function pointInBox(px: number, py: number, cx: number, cy: number, hw: number, hh: number, angle: number): boolean {
  const ddx = px - cx, ddy = py - cy;
  return Math.abs(Math.cos(angle) * ddx + Math.sin(angle) * ddy) < hw &&
         Math.abs(-Math.sin(angle) * ddx + Math.cos(angle) * ddy) < hh;
}

// ---- CSS position helpers ----

function lineCSS(cx: number, cy: number, w: number, h: number, angle: number): string {
  return `position:absolute;left:${cx}px;top:${cy}px;width:${w}px;height:${h}px;transform:translate(-50%,-50%) rotate(${angle}rad);pointer-events:none;`;
}

function boxCSS(cx: number, cy: number, w: number, h: number, angle: number): string {
  return `position:absolute;left:${cx}px;top:${cy}px;width:${w}px;height:${h}px;transform:translate(-50%,-50%) rotate(${angle}rad);pointer-events:none;`;
}

function circleCSS(cx: number, cy: number, r: number): string {
  return `position:absolute;left:${cx}px;top:${cy}px;width:${r * 2}px;height:${r * 2}px;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;`;
}

function triCSS(cx: number, cy: number, r: number, angle: number): string {
  return `position:absolute;left:${cx}px;top:${cy}px;width:${r * 2}px;height:${r * 2}px;transform:translate(-50%,-50%) rotate(${angle}rad);pointer-events:none;clip-path:polygon(50% 100%,0% 0%,100% 0%);`;
}
