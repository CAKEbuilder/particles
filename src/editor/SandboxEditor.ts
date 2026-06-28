// Sandbox maze editor: draw collision shapes + place interactive effects.
// Runs alongside (not inside) Playfield — owns its own collision + DOM overlays.

import { config } from "../config";
import type { CpuParticleSystem } from "../sim/CpuParticleSystem";
import type { Input } from "../input/Input";
import {
  makeBox, makeTriangle, resolveBox, resolveShape,
  type BoxShape, type CircleShape, type TriangleShape,
} from "../level/shapes";

// ---- types ----

type DrawTool = "line" | "box" | "circle" | "triangle" | "blackhole" | "gravityfield" | "funnel" | "condenser";
type EditTool = "move" | "resize" | "delete";
type EditorTool = DrawTool | EditTool;

// collision shapes
interface LineItem     { kind: "line";     x1: number; y1: number; x2: number; y2: number; shape: BoxShape; el: HTMLDivElement; }
interface BoxItem      { kind: "box";      x: number; y: number; hw: number; hh: number; angle: number; shape: BoxShape; el: HTMLDivElement; }
interface CircleItem   { kind: "circle";   x: number; y: number; r: number; shape: CircleShape; el: HTMLDivElement; }
interface TriItem      { kind: "triangle"; x: number; y: number; r: number; angle: number; shape: TriangleShape; el: HTMLDivElement; }
// effects
interface BlackHoleItem    { kind: "blackhole";    x: number; y: number; r: number; el: HTMLDivElement; }
interface GravityFieldItem { kind: "gravityfield"; x: number; y: number; hw: number; hh: number; angle: number; shape: BoxShape; el: HTMLDivElement; }
interface FunnelItem       { kind: "funnel";       inX: number; inY: number; outX: number; outY: number; inR: number; el: HTMLDivElement; }
interface CondenserItem    { kind: "condenser";    x: number; y: number; r: number; timer: number; el: HTMLDivElement; }

type EditorItem = LineItem | BoxItem | CircleItem | TriItem | BlackHoleItem | GravityFieldItem | FunnelItem | CondenserItem;

interface SavedItem {
  kind: EditorItem["kind"];
  x1?: number; y1?: number; x2?: number; y2?: number;
  x?: number; y?: number;
  hw?: number; hh?: number;
  r?: number; angle?: number;
  inX?: number; inY?: number; outX?: number; outY?: number;
}

const STORAGE_KEY = "particles.editor.v1";
const MAX_HISTORY = 50;
const BIG_PARTICLE_SIZE = 28; // condenser output — above Game.ts skip threshold (16)
const CONDENSER_INTERVAL = 0.12; // seconds between condenser pulses
const BH_STRENGTH = 3500;      // black hole pull px/s² at distance r
const MASS_STRENGTH = 1800;    // mass zone radial pull px/s²
const BIG_ATTRACT_STR = 700;   // big-particle-to-small attraction px/s²
const BIG_ATTRACT_R = 140;     // influence radius around big particles (px)
const BIG_THRESHOLD = 16;      // size above which a particle counts as "big" (matches Game.ts)

function snap(v: number, grid: number): number { return Math.round(v / grid) * grid; }
function snapAngle(a: number, stepDeg: number): number {
  const step = stepDeg * Math.PI / 180;
  return Math.round(a / step) * step;
}

// ---- class ----

export class SandboxEditor {
  private items: EditorItem[] = [];
  private tool: EditorTool = "line";
  private active = false;
  private selected: EditorItem | null = null;

  private dragging = false;
  private dragHandle: "body" | "p1" | "p2" | "rotate" | null = null;
  private dragStartX = 0; private dragStartY = 0;
  private dragItemStart: SavedItem | null = null;
  private previewEl: HTMLDivElement | null = null;

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
    this.pushHistory();
    this.setActive(false);
  }

  setActive(on: boolean): void {
    this.active = on;
    this.toolbar.classList.toggle("hidden-ui", !on);
    if (!on) { this.clearSelection(); this.input.suspended = false; }
    for (const item of this.items) item.el.classList.toggle("hidden-ui", !on);
  }

  /** Called every physics step (after system.step). */
  resolve(dt: number): void {
    if (!this.active) return;
    this.resolveCollision(dt);
    this.updateEffects(dt);
  }

  // ---- collision ----

  private resolveCollision(dt: number): void {
    const { px, py, vx, vy, count } = this.system;
    const r = config.editor.restitution;
    for (const item of this.items) {
      if (item.kind === "line" || item.kind === "box" || item.kind === "gravityfield") {
        resolveBox(item.shape, px, py, vx, vy, count, r, dt);
      } else if (item.kind === "circle") {
        resolveShape(item.shape, px, py, vx, vy, count, r);
      } else if (item.kind === "triangle") {
        resolveShape(item.shape, px, py, vx, vy, count, r);
      }
      // other effects don't do collision
    }
  }

  // ---- effects ----

  private updateEffects(dt: number): void {
    const { px, py, vx, vy, count } = this.system;

    for (const item of this.items) {
      if (item.kind === "blackhole") {
        const pullR2 = (item.r * 2.5) * (item.r * 2.5);
        for (let i = 0; i < count; i++) {
          const dx = item.x - px[i], dy = item.y - py[i];
          const d2 = dx * dx + dy * dy;
          if (d2 < pullR2 && d2 > 1) {
            const d = Math.sqrt(d2);
            const f = BH_STRENGTH * item.r / (d2 + 100) * dt;
            vx[i] += dx / d * f;
            vy[i] += dy / d * f;
          }
        }
        this.system.eraseNear(item.x, item.y, item.r * 0.35);

      } else if (item.kind === "gravityfield") {
        // pull all particles in the zone toward the center
        const r = Math.max(item.hw, item.hh);
        const r2 = r * r;
        for (let i = 0; i < count; i++) {
          const dx = item.x - px[i], dy = item.y - py[i];
          const d2 = dx * dx + dy * dy;
          if (d2 < r2 * 4 && d2 > 1) {
            const d = Math.sqrt(d2);
            const f = MASS_STRENGTH * r / (d2 + 200) * dt;
            vx[i] += dx / d * f;
            vy[i] += dy / d * f;
          }
        }

      } else if (item.kind === "funnel") {
        const inR2 = item.inR * item.inR;
        const exitAngle = Math.atan2(item.outY - item.inY, item.outX - item.inX);
        const outR = Math.max(8, item.inR * 0.35);
        for (let i = count - 1; i >= 0; i--) {
          const dx = px[i] - item.inX, dy = py[i] - item.inY;
          if (dx * dx + dy * dy < inR2) {
            const jitter = (Math.random() - 0.5) * outR * 0.6;
            const perp = exitAngle + Math.PI / 2;
            px[i] = item.outX + Math.cos(perp) * jitter;
            py[i] = item.outY + Math.sin(perp) * jitter;
            vx[i] = Math.cos(exitAngle) * 320 + (Math.random() - 0.5) * 80;
            vy[i] = Math.sin(exitAngle) * 320 + (Math.random() - 0.5) * 80;
          }
        }

      } else if (item.kind === "condenser") {
        item.timer += dt;
        if (item.timer < CONDENSER_INTERVAL) continue;
        item.timer = 0;
        // count only small particles so big ones can drift out freely
        const r2 = item.r * item.r;
        let inRange = 0;
        for (let i = 0; i < count; i++) {
          const dx = px[i] - item.x, dy = py[i] - item.y;
          if (dx * dx + dy * dy < r2 && this.system.size[i] <= BIG_THRESHOLD && ++inRange >= 10) break;
        }
        if (inRange >= 10) {
          this.system.consumeNear(item.x, item.y, item.r, 10, BIG_THRESHOLD);
          this.system.spawnBurst(item.x, item.y, { count: 1, speed: 0, speedJitter: 30 });
          const newIdx = this.system.count - 1;
          if (newIdx >= 0) this.system.size[newIdx] = BIG_PARTICLE_SIZE;
        }
      }
    }

    // big particles (from condenser) attract nearby small ones
    const bigR2 = BIG_ATTRACT_R * BIG_ATTRACT_R;
    for (let i = 0; i < count; i++) {
      if (this.system.size[i] <= BIG_THRESHOLD) continue;
      const bx = px[i], by = py[i];
      for (let j = 0; j < count; j++) {
        if (i === j || this.system.size[j] > BIG_THRESHOLD) continue;
        const dx = bx - px[j], dy = by - py[j];
        const d2 = dx * dx + dy * dy;
        if (d2 < bigR2 && d2 > 1) {
          const d = Math.sqrt(d2);
          const f = BIG_ATTRACT_STR / (d + 40) * dt;
          vx[j] += dx / d * f;
          vy[j] += dy / d * f;
        }
      }
    }
  }

  // ---- toolbar ----

  private buildToolbar(): HTMLDivElement {
    const bar = document.createElement("div");
    bar.className = "editor-toolbar";

    const header = document.createElement("div");
    header.className = "sandbox-section-header sandbox-section-header--objects";
    header.textContent = "Objects";
    bar.appendChild(header);

    const group = (pairs: [string, string, string?, (() => void)?][], isEdit = false): void => {
      const g = document.createElement("div");
      g.className = "editor-toolbar-group" + (isEdit ? " editor-toolbar-group--edit" : "");
      for (const [key, label, extraClass, onClick] of pairs) {
        const b = document.createElement("button");
        b.className = "hud-btn" + (extraClass ? " " + extraClass : "");
        b.textContent = label;
        if (onClick) b.addEventListener("click", onClick);
        g.appendChild(b);
        this.toolBtns.set(key, b);
      }
      bar.appendChild(g);
    };

    group([
      ["line",     "Line",     undefined, () => this.selectTool("line")],
      ["box",      "Box",      undefined, () => this.selectTool("box")],
      ["circle",   "Circle",   undefined, () => this.selectTool("circle")],
      ["triangle", "Triangle", undefined, () => this.selectTool("triangle")],
    ]);

    group([
      ["blackhole",    "Black Hole", undefined, () => this.selectTool("blackhole")],
      ["gravityfield", "Mass",       undefined, () => this.selectTool("gravityfield")],
      ["funnel",       "Funnel",     undefined, () => this.selectTool("funnel")],
      ["condenser",    "Condenser",  undefined, () => this.selectTool("condenser")],
    ]);

    group([
      ["move",   "Move",   undefined,        () => this.selectTool("move")],
      ["resize", "Resize", undefined,        () => this.selectTool("resize")],
      ["undo",   "↺",      undefined,        () => this.undo()],
      ["redo",   "↻",      undefined,        () => this.redo()],
      ["delete", "🗑",     "editor-btn-gap", () => this.deleteSelected()],
    ], true);

    this.parent.appendChild(bar);
    this.syncToolBtns();
    return bar;
  }

  private selectTool(t: EditorTool): void {
    this.tool = t;
    this.input.suspended = true;
    this.syncToolBtns();
    if (t !== "move" && t !== "resize") this.clearSelection();
  }

  onPlayToolSelected(): void {
    this.tool = "move";
    this.input.suspended = false;
    this.syncToolBtns();
    this.clearSelection();
  }

  private syncToolBtns(): void {
    for (const [key, btn] of this.toolBtns) {
      if (key === "undo") {
        btn.classList.remove("active");
        btn.disabled = this.histIdx <= 0;
      } else if (key === "redo") {
        btn.classList.remove("active");
        btn.disabled = this.histIdx >= this.history.length - 1;
      } else if (key === "delete") {
        btn.classList.remove("active");
      } else {
        btn.classList.toggle("active", key === this.tool);
      }
    }
  }

  private toLocal(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ---- undo / redo ----

  private pushHistory(): void {
    const snap = this.items.map(i => this.serializeItem(i));
    this.history = this.history.slice(0, this.histIdx + 1);
    this.history.push(snap);
    if (this.history.length > MAX_HISTORY) this.history.shift();
    this.histIdx = this.history.length - 1;
    this.syncToolBtns();
  }

  private undo(): void {
    if (this.histIdx <= 0) return;
    this.histIdx--;
    this.restoreSnapshot(this.history[this.histIdx]);
  }

  private redo(): void {
    if (this.histIdx >= this.history.length - 1) return;
    this.histIdx++;
    this.restoreSnapshot(this.history[this.histIdx]);
  }

  private restoreSnapshot(snapshot: SavedItem[]): void {
    for (const item of this.items) item.el.remove();
    this.items.length = 0;
    this.clearSelection();
    for (const s of snapshot) this.restoreItem(s);
    this.save();
    this.syncToolBtns();
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
    if (this.previewEl) this.updatePreview(this.dragStartX, this.dragStartY, x, y, this.previewEl);
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
    if ((e.key === "Delete" || e.key === "Backspace") && this.selected) { e.preventDefault(); this.deleteSelected(); }
    if (e.key === "Escape") this.clearSelection();
    if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); this.undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); this.redo(); }
  };

  // ---- creation ----

  private applySnapXY(x: number, y: number): [number, number] {
    const g = config.editor.snapGrid;
    return [snap(x, g), snap(y, g)];
  }

  private lineAngle(x1: number, y1: number, x2: number, y2: number): number {
    return snapAngle(Math.atan2(y2 - y1, x2 - x1), config.editor.snapAngleDeg);
  }

  private finalizeCreate(x1: number, y1: number, x2: number, y2: number): void {
    [x1, y1] = this.applySnapXY(x1, y1);
    [x2, y2] = this.applySnapXY(x2, y2);
    const t = this.tool as DrawTool;
    let item: EditorItem | null = null;

    if (t === "line") {
      const len = Math.hypot(x2 - x1, y2 - y1);
      if (len < 4) return;
      const angle = this.lineAngle(x1, y1, x2, y2);
      item = this.createLine(x1, y1, x2, y2, (x1+x2)/2, (y1+y2)/2, len/2, angle);
    } else if (t === "box") {
      const hw = Math.abs(x2-x1)/2, hh = Math.abs(y2-y1)/2;
      if (hw < 4 && hh < 4) return;
      item = this.createBox((x1+x2)/2, (y1+y2)/2, Math.max(4,hw), Math.max(4,hh), 0);
    } else if (t === "circle") {
      const r = Math.max(8, Math.hypot(x2-x1, y2-y1));
      item = this.createCircle(x1, y1, r);
    } else if (t === "triangle") {
      const r = Math.max(12, Math.hypot(x2-x1, y2-y1));
      item = this.createTriangle(x1, y1, r, 0);
    } else if (t === "blackhole") {
      const r = Math.max(20, Math.hypot(x2-x1, y2-y1));
      item = this.createBlackHole(x1, y1, r);
    } else if (t === "gravityfield") {
      const hw = Math.max(20, Math.abs(x2-x1)/2), hh = Math.max(20, Math.abs(y2-y1)/2);
      item = this.createGravityField((x1+x2)/2, (y1+y2)/2, hw, hh, 0);
    } else if (t === "funnel") {
      const inR = Math.max(24, Math.hypot(x2-x1, y2-y1) * 0.28);
      item = this.createFunnel(x1, y1, x2, y2, inR);
    } else if (t === "condenser") {
      const r = Math.max(24, Math.hypot(x2-x1, y2-y1));
      item = this.createCondenser(x1, y1, r);
    }

    if (item) { this.items.push(item); this.setSelected(item); }
    this.pushHistory();
    this.save();
  }

  private updatePreview(x1: number, y1: number, x2: number, y2: number, el: HTMLDivElement): void {
    [x1, y1] = this.applySnapXY(x1, y1);
    [x2, y2] = this.applySnapXY(x2, y2);
    const t = this.tool as DrawTool;
    if (t === "line") {
      el.style.cssText = lineCSS((x1+x2)/2, (y1+y2)/2, Math.hypot(x2-x1,y2-y1), config.editor.lineThickness*2, this.lineAngle(x1,y1,x2,y2));
    } else if (t === "box" || t === "gravityfield") {
      el.style.cssText = boxCSS((x1+x2)/2, (y1+y2)/2, Math.abs(x2-x1), Math.abs(y2-y1), 0);
    } else if (t === "circle" || t === "blackhole" || t === "condenser") {
      el.style.cssText = circleCSS(x1, y1, Math.hypot(x2-x1,y2-y1));
    } else if (t === "triangle") {
      el.style.cssText = triCSS(x1, y1, Math.hypot(x2-x1,y2-y1), 0);
    } else if (t === "funnel") {
      el.style.cssText = circleCSS(x1, y1, Math.max(24, Math.hypot(x2-x1,y2-y1)*0.28));
    }
  }

  // ---- item factories ----

  private createLine(x1: number, y1: number, x2: number, y2: number, cx: number, cy: number, hw: number, angle: number): LineItem {
    const hh = config.editor.lineThickness;
    const el = document.createElement("div");
    el.className = "editor-item editor-line";
    el.style.cssText = lineCSS(cx, cy, hw*2, hh*2, angle);
    this.parent.appendChild(el);
    return { kind: "line", x1, y1, x2, y2, shape: makeBox(cx, cy, hw, hh, angle), el };
  }

  private createBox(x: number, y: number, hw: number, hh: number, angle: number): BoxItem {
    const el = document.createElement("div");
    el.className = "editor-item editor-box";
    el.style.cssText = boxCSS(x, y, hw*2, hh*2, angle);
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

  private createBlackHole(x: number, y: number, r: number): BlackHoleItem {
    const el = document.createElement("div");
    el.className = "editor-effect editor-blackhole";
    el.style.cssText = circleCSS(x, y, r);
    this.parent.appendChild(el);
    return { kind: "blackhole", x, y, r, el };
  }

  private createGravityField(x: number, y: number, hw: number, hh: number, angle: number): GravityFieldItem {
    const el = document.createElement("div");
    el.className = "editor-effect editor-gravityfield";
    el.style.cssText = boxCSS(x, y, hw*2, hh*2, angle);
    el.innerHTML = `<span class="editor-effect-glyph">◉</span>`;
    this.parent.appendChild(el);
    return { kind: "gravityfield", x, y, hw, hh, angle, shape: makeBox(x, y, hw, hh, angle), el };
  }

  private createFunnel(inX: number, inY: number, outX: number, outY: number, inR: number): FunnelItem {
    const el = document.createElement("div");
    el.className = "editor-effect-funnel";
    el.innerHTML = funnelHTML(inX, inY, outX, outY, inR);
    this.parent.appendChild(el);
    return { kind: "funnel", inX, inY, outX, outY, inR, el };
  }

  private createCondenser(x: number, y: number, r: number): CondenserItem {
    const el = document.createElement("div");
    el.className = "editor-effect editor-condenser";
    el.style.cssText = circleCSS(x, y, r);
    el.innerHTML = `<span class="editor-effect-glyph">◎</span>`;
    this.parent.appendChild(el);
    return { kind: "condenser", x, y, r, timer: 0, el };
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
      const hw = Math.hypot(item.x2-item.x1, item.y2-item.y1)/2;
      const cx = (item.x1+item.x2)/2, cy = (item.y1+item.y2)/2;
      const angle = Math.atan2(item.y2-item.y1, item.x2-item.x1);
      this.selectionRing.style.cssText = lineCSS(cx, cy, hw*2, (config.editor.lineThickness+8)*2, angle) + base + "border-radius:4px;";
    } else if (item.kind === "box" || item.kind === "gravityfield") {
      const hw = (item as BoxItem | GravityFieldItem).hw;
      const hh = (item as BoxItem | GravityFieldItem).hh;
      this.selectionRing.style.cssText = boxCSS(item.x, item.y, hw*2+12, hh*2+12, item.angle ?? 0) + base;
    } else if (item.kind === "circle" || item.kind === "blackhole" || item.kind === "condenser") {
      const r = (item as CircleItem | BlackHoleItem | CondenserItem).r;
      this.selectionRing.style.cssText = circleCSS(item.x, item.y, r+8) + base;
    } else if (item.kind === "triangle") {
      this.selectionRing.style.cssText = boxCSS(item.x, item.y, item.r*2+12, item.r*2+12, 0) + base;
    } else if (item.kind === "funnel") {
      this.selectionRing.style.cssText = circleCSS(item.inX, item.inY, item.inR+8) + base;
    }
  }

  private hitTest(x: number, y: number): { item: EditorItem; handle: "body" | "p1" | "p2" | "rotate" } | null {
    const hr = config.editor.handleRadius;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];

      if (item.kind === "line") {
        if (this.tool === "resize") {
          if (dist(x,y,item.x1,item.y1) < hr*1.5) return { item, handle: "p1" };
          if (dist(x,y,item.x2,item.y2) < hr*1.5) return { item, handle: "p2" };
        }
        if (distToSegment(x,y,item.x1,item.y1,item.x2,item.y2) < hr) return { item, handle: "body" };

      } else if (item.kind === "box" || item.kind === "gravityfield") {
        const itb = item as BoxItem | GravityFieldItem;
        if (pointInBox(x, y, itb.x, itb.y, itb.hw+hr, itb.hh+hr, itb.angle)) {
          if (this.tool === "resize") {
            const inner = pointInBox(x, y, itb.x, itb.y, itb.hw*0.55, itb.hh*0.55, itb.angle);
            return { item, handle: inner ? "body" : "rotate" };
          }
          return { item, handle: "body" };
        }

      } else if (item.kind === "circle") {
        if (dist(x,y,item.x,item.y) < item.r+hr) return { item, handle: "body" };

      } else if (item.kind === "triangle") {
        if (dist(x,y,item.x,item.y) < item.r+hr) {
          if (this.tool === "resize") return { item, handle: dist(x,y,item.x,item.y) < item.r*0.5 ? "body" : "rotate" };
          return { item, handle: "body" };
        }

      } else if (item.kind === "blackhole" || item.kind === "condenser") {
        const itc = item as BlackHoleItem | CondenserItem;
        if (dist(x,y,itc.x,itc.y) < itc.r+hr) return { item, handle: "body" };

      } else if (item.kind === "funnel") {
        if (this.tool === "resize") {
          if (dist(x,y,item.inX,item.inY) < hr*1.5) return { item, handle: "p1" };
          if (dist(x,y,item.outX,item.outY) < hr*1.5) return { item, handle: "p2" };
        }
        const outR = Math.max(8, item.inR * 0.35);
        if (dist(x,y,item.inX,item.inY) < item.inR+hr || dist(x,y,item.outX,item.outY) < outR+hr ||
            distToSegment(x,y,item.inX,item.inY,item.outX,item.outY) < hr) {
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
    const s = this.dragItemStart;

    if (this.tool === "move") {
      if (item.kind === "line") {
        const [nx1,ny1] = this.applySnapXY((s.x1??0)+dx, (s.y1??0)+dy);
        const [nx2,ny2] = this.applySnapXY((s.x2??0)+dx, (s.y2??0)+dy);
        item.x1=nx1; item.y1=ny1; item.x2=nx2; item.y2=ny2;
        this.rebuildLine(item);
      } else if (item.kind === "box" || item.kind === "gravityfield") {
        const itb = item as BoxItem | GravityFieldItem;
        [itb.x, itb.y] = this.applySnapXY((s.x??0)+dx, (s.y??0)+dy);
        item.kind === "box" ? this.rebuildBox(item as BoxItem) : this.rebuildGravityField(item as GravityFieldItem);
      } else if (item.kind === "circle") {
        [item.x, item.y] = this.applySnapXY((s.x??0)+dx, (s.y??0)+dy);
        this.rebuildCircle(item);
      } else if (item.kind === "triangle") {
        [item.x, item.y] = this.applySnapXY((s.x??0)+dx, (s.y??0)+dy);
        this.rebuildTriangle(item);
      } else if (item.kind === "blackhole") {
        [item.x, item.y] = this.applySnapXY((s.x??0)+dx, (s.y??0)+dy);
        item.el.style.cssText = circleCSS(item.x, item.y, item.r);
      } else if (item.kind === "condenser") {
        [item.x, item.y] = this.applySnapXY((s.x??0)+dx, (s.y??0)+dy);
        item.el.style.cssText = circleCSS(item.x, item.y, item.r);
      } else if (item.kind === "funnel") {
        const [ninX,ninY] = this.applySnapXY((s.inX??0)+dx, (s.inY??0)+dy);
        const [noutX,noutY] = this.applySnapXY((s.outX??0)+dx, (s.outY??0)+dy);
        item.inX=ninX; item.inY=ninY; item.outX=noutX; item.outY=noutY;
        item.el.innerHTML = funnelHTML(item.inX, item.inY, item.outX, item.outY, item.inR);
      }
    } else if (this.tool === "resize") {
      if (item.kind === "line") {
        if (this.dragHandle === "p1") [item.x1,item.y1] = this.applySnapXY(x,y);
        else if (this.dragHandle === "p2") [item.x2,item.y2] = this.applySnapXY(x,y);
        else { item.x1=(s.x1??0)+dx; item.y1=(s.y1??0)+dy; item.x2=(s.x2??0)+dx; item.y2=(s.y2??0)+dy; }
        this.rebuildLine(item);
      } else if (item.kind === "box") {
        if (this.dragHandle === "rotate") { let a=Math.atan2(dy,dx); a=snapAngle(a,config.editor.snapAngleDeg); item.angle=a; }
        else { item.hw=Math.max(6,(s.hw??6)+(dx>0?Math.abs(dx):-Math.abs(dx))); item.hh=Math.max(6,(s.hh??6)+(dy>0?Math.abs(dy):-Math.abs(dy))); }
        this.rebuildBox(item);
      } else if (item.kind === "gravityfield") {
        if (this.dragHandle === "rotate") { let a=Math.atan2(dy,dx); a=snapAngle(a,config.editor.snapAngleDeg); item.angle=a; }
        else { item.hw=Math.max(20,(s.hw??20)+(dx>0?Math.abs(dx):-Math.abs(dx))); item.hh=Math.max(20,(s.hh??20)+(dy>0?Math.abs(dy):-Math.abs(dy))); }
        this.rebuildGravityField(item);
      } else if (item.kind === "circle") {
        item.r=Math.max(8,(s.r??8)+Math.hypot(dx,dy)*(dx+dy>0?1:-1));
        this.rebuildCircle(item);
      } else if (item.kind === "triangle") {
        if (this.dragHandle === "rotate") { let a=Math.atan2(dy,dx); a=snapAngle(a,config.editor.snapAngleDeg); item.angle=a; }
        else item.r=Math.max(12,(s.r??12)+Math.hypot(dx,dy)*(dx+dy>0?1:-1));
        this.rebuildTriangle(item);
      } else if (item.kind === "blackhole") {
        item.r=Math.max(20,(s.r??20)+Math.hypot(dx,dy)*(dx+dy>0?1:-1));
        item.el.style.cssText = circleCSS(item.x, item.y, item.r);
      } else if (item.kind === "condenser") {
        item.r=Math.max(24,(s.r??24)+Math.hypot(dx,dy)*(dx+dy>0?1:-1));
        item.el.style.cssText = circleCSS(item.x, item.y, item.r);
      } else if (item.kind === "funnel") {
        if (this.dragHandle === "p1") [item.inX,item.inY]=this.applySnapXY(x,y);
        else if (this.dragHandle === "p2") [item.outX,item.outY]=this.applySnapXY(x,y);
        else { item.inX=(s.inX??0)+dx; item.inY=(s.inY??0)+dy; item.outX=(s.outX??0)+dx; item.outY=(s.outY??0)+dy; }
        item.el.innerHTML = funnelHTML(item.inX, item.inY, item.outX, item.outY, item.inR);
      }
    }

    this.updateSelectionRing();
  }

  // ---- rebuild helpers ----

  private rebuildLine(item: LineItem): void {
    const cx=(item.x1+item.x2)/2, cy=(item.y1+item.y2)/2;
    const hw=Math.hypot(item.x2-item.x1, item.y2-item.y1)/2;
    const angle=this.lineAngle(item.x1,item.y1,item.x2,item.y2);
    item.shape=makeBox(cx,cy,Math.max(1,hw),config.editor.lineThickness,angle);
    item.el.style.cssText=lineCSS(cx,cy,hw*2,config.editor.lineThickness*2,angle);
  }

  private rebuildBox(item: BoxItem): void {
    item.shape=makeBox(item.x,item.y,item.hw,item.hh,item.angle);
    item.el.style.cssText=boxCSS(item.x,item.y,item.hw*2,item.hh*2,item.angle);
  }

  private rebuildCircle(item: CircleItem): void {
    item.shape={ kind:"circle", x:item.x, y:item.y, r:item.r };
    item.el.style.cssText=circleCSS(item.x,item.y,item.r);
  }

  private rebuildTriangle(item: TriItem): void {
    item.shape=makeTriangle(item.x,item.y,item.r,item.angle);
    item.el.style.cssText=triCSS(item.x,item.y,item.r,item.angle);
  }

  private rebuildGravityField(item: GravityFieldItem): void {
    item.shape = makeBox(item.x, item.y, item.hw, item.hh, item.angle);
    item.el.style.cssText=boxCSS(item.x,item.y,item.hw*2,item.hh*2,item.angle);
  }

  // ---- deletion ----

  private deleteSelected(): void { if (this.selected) this.removeItem(this.selected); }

  private removeItem(item: EditorItem): void {
    item.el.remove();
    const idx = this.items.indexOf(item);
    if (idx >= 0) this.items.splice(idx, 1);
    if (this.selected === item) this.clearSelection();
    this.pushHistory();
    this.save();
  }



  // ---- persistence ----

  private serializeItem(item: EditorItem): SavedItem {
    if (item.kind === "line")         return { kind:"line", x1:item.x1, y1:item.y1, x2:item.x2, y2:item.y2 };
    if (item.kind === "box")          return { kind:"box", x:item.x, y:item.y, hw:item.hw, hh:item.hh, angle:item.angle };
    if (item.kind === "circle")       return { kind:"circle", x:item.x, y:item.y, r:item.r };
    if (item.kind === "triangle")     return { kind:"triangle", x:item.x, y:item.y, r:item.r, angle:item.angle };
    if (item.kind === "blackhole")    return { kind:"blackhole", x:item.x, y:item.y, r:item.r };
    if (item.kind === "gravityfield") return { kind:"gravityfield", x:item.x, y:item.y, hw:item.hw, hh:item.hh, angle:item.angle };
    if (item.kind === "funnel")       return { kind:"funnel", inX:item.inX, inY:item.inY, outX:item.outX, outY:item.outY, r:item.inR };
    return { kind:"condenser", x:item.x, y:item.y, r:item.r };
  }

  private restoreItem(s: SavedItem): void {
    if (s.kind==="line" && s.x1!==undefined) {
      const x2=s.x2??0, y2=s.y2??0, y1=s.y1??0;
      const cx=(s.x1+x2)/2, cy=(y1+y2)/2, hw=Math.hypot(x2-s.x1,y2-y1)/2;
      this.items.push(this.createLine(s.x1,y1,x2,y2,cx,cy,hw,Math.atan2(y2-y1,x2-s.x1)));
    } else if (s.kind==="box" && s.x!==undefined) {
      this.items.push(this.createBox(s.x,s.y??0,s.hw??40,s.hh??40,s.angle??0));
    } else if (s.kind==="circle" && s.x!==undefined) {
      this.items.push(this.createCircle(s.x,s.y??0,s.r??40));
    } else if (s.kind==="triangle" && s.x!==undefined) {
      this.items.push(this.createTriangle(s.x,s.y??0,s.r??40,s.angle??0));
    } else if (s.kind==="blackhole" && s.x!==undefined) {
      this.items.push(this.createBlackHole(s.x,s.y??0,s.r??40));
    } else if (s.kind==="gravityfield" && s.x!==undefined) {
      this.items.push(this.createGravityField(s.x,s.y??0,s.hw??60,s.hh??60,s.angle??0));
    } else if (s.kind==="funnel" && s.inX!==undefined) {
      this.items.push(this.createFunnel(s.inX,s.inY??0,s.outX??0,s.outY??0,s.r??36));
    } else if (s.kind==="condenser" && s.x!==undefined) {
      this.items.push(this.createCondenser(s.x,s.y??0,s.r??40));
    }
  }

  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version:1, items:this.items.map(i=>this.serializeItem(i)) })); } catch { /**/ }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { version:number; items:SavedItem[] };
      for (const s of data.items) this.restoreItem(s);
    } catch { /**/ }
  }
}

// ---- geometry ----

function dist(ax: number, ay: number, bx: number, by: number): number { return Math.hypot(ax-bx, ay-by); }

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx=bx-ax, dy=by-ay, len2=dx*dx+dy*dy;
  if (len2===0) return dist(px,py,ax,ay);
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/len2));
  return dist(px,py,ax+t*dx,ay+t*dy);
}

function pointInBox(px: number, py: number, cx: number, cy: number, hw: number, hh: number, angle: number): boolean {
  const ddx=px-cx, ddy=py-cy;
  return Math.abs(Math.cos(angle)*ddx+Math.sin(angle)*ddy)<hw &&
         Math.abs(-Math.sin(angle)*ddx+Math.cos(angle)*ddy)<hh;
}

// ---- CSS helpers ----

function lineCSS(cx: number, cy: number, w: number, h: number, angle: number): string {
  return `position:absolute;left:${cx}px;top:${cy}px;width:${w}px;height:${h}px;transform:translate(-50%,-50%) rotate(${angle}rad);pointer-events:none;`;
}
function boxCSS(cx: number, cy: number, w: number, h: number, angle: number): string {
  return `position:absolute;left:${cx}px;top:${cy}px;width:${w}px;height:${h}px;transform:translate(-50%,-50%) rotate(${angle}rad);pointer-events:none;`;
}
function circleCSS(cx: number, cy: number, r: number): string {
  return `position:absolute;left:${cx}px;top:${cy}px;width:${r*2}px;height:${r*2}px;transform:translate(-50%,-50%);border-radius:50%;pointer-events:none;`;
}
function triCSS(cx: number, cy: number, r: number, angle: number): string {
  return `position:absolute;left:${cx}px;top:${cy}px;width:${r*2}px;height:${r*2}px;transform:translate(-50%,-50%) rotate(${angle}rad);pointer-events:none;clip-path:polygon(50% 100%,0% 0%,100% 0%);`;
}
function funnelHTML(inX: number, inY: number, outX: number, outY: number, inR: number): string {
  const outR = Math.max(8, inR * 0.35);
  const dx = outX - inX, dy = outY - inY;
  const len = Math.hypot(dx, dy);
  let trapPath = "";
  if (len > 1) {
    const nx = -dy / len, ny = dx / len;
    const p1x = inX + nx * inR,  p1y = inY + ny * inR;
    const p2x = inX - nx * inR,  p2y = inY - ny * inR;
    const p3x = outX - nx * outR, p3y = outY - ny * outR;
    const p4x = outX + nx * outR, p4y = outY + ny * outR;
    trapPath = `<path d="M${p1x},${p1y} L${p2x},${p2y} L${p3x},${p3y} L${p4x},${p4y} Z"
      fill="rgba(46,200,255,0.07)" stroke="rgba(46,200,255,0.28)" stroke-width="1.5" stroke-linejoin="round"/>`;
  }
  return `<svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none">
    ${trapPath}
    <circle cx="${inX}" cy="${inY}" r="${inR}"
      fill="rgba(46,255,140,0.1)" stroke="rgba(46,255,140,0.7)" stroke-width="2"/>
    <circle cx="${outX}" cy="${outY}" r="${outR}"
      fill="rgba(46,180,255,0.14)" stroke="rgba(46,180,255,0.75)" stroke-width="2"/>
  </svg>`;
}
