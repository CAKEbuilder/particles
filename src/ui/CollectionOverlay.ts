// Collection / "dex" screen: every special, discovered ones shown with art + info,
// undiscovered shown as ??? with rarity styling. Populated in Phase C.

export interface CollectionEntry {
  id: string;
  name: string;
  tier: string;
  tierColor: string;
  glyph: string; // shown when discovered
  discovered: boolean;
  seen: number;
  effects: string[];
}

export interface AchievementEntry {
  name: string;
  desc: string;
  unlocked: boolean;
}

export interface CollectionOptions {
  onBack: () => void;
  getEntries: () => CollectionEntry[];
  getAchievements: () => AchievementEntry[];
}

export class CollectionOverlay {
  private el: HTMLDivElement;
  private grid: HTMLDivElement;
  private summary: HTMLDivElement;
  private achTitle: HTMLHeadingElement;
  private achGrid: HTMLDivElement;

  constructor(parent: HTMLElement, private readonly opts: CollectionOptions) {
    this.el = document.createElement("div");
    this.el.className = "collection-screen";

    const header = document.createElement("div");
    header.className = "coll-header";
    const back = document.createElement("button");
    back.className = "title-btn";
    back.textContent = "‹ Back";
    back.addEventListener("click", () => this.opts.onBack());
    const h = document.createElement("h2");
    h.textContent = "Collection";
    this.summary = document.createElement("div");
    this.summary.className = "coll-summary";
    header.append(back, h, this.summary);
    this.el.appendChild(header);

    this.grid = document.createElement("div");
    this.grid.className = "coll-grid";
    this.el.appendChild(this.grid);

    this.achTitle = document.createElement("h2");
    this.achTitle.className = "coll-ach-title";
    this.achTitle.textContent = "Achievements";
    this.el.appendChild(this.achTitle);
    this.achGrid = document.createElement("div");
    this.achGrid.className = "coll-ach-grid";
    this.el.appendChild(this.achGrid);

    parent.appendChild(this.el);
  }

  refresh(): void {
    const entries = this.opts.getEntries();
    this.grid.innerHTML = "";
    const found = entries.filter((e) => e.discovered).length;
    this.summary.textContent = entries.length
      ? `${found} / ${entries.length} discovered`
      : "";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "coll-empty";
      empty.textContent = "No specials yet — they'll appear here as you discover them.";
      this.grid.appendChild(empty);
      return;
    }

    for (const e of entries) {
      const card = document.createElement("div");
      card.className = "coll-card" + (e.discovered ? " found" : "");
      card.style.setProperty("--tier", e.tierColor);
      if (e.discovered) {
        card.innerHTML =
          `<div class="coll-glyph">${e.glyph}</div>` +
          `<div class="coll-name">${e.name}</div>` +
          `<div class="coll-tier">${e.tier}</div>` +
          `<div class="coll-effects">${e.effects.join(" · ")}</div>`;
      } else {
        card.innerHTML =
          `<div class="coll-glyph coll-unknown">?</div>` +
          `<div class="coll-name">???</div>` +
          `<div class="coll-tier">${e.tier}</div>`;
      }
      this.grid.appendChild(card);
    }

    this.renderAchievements();
  }

  private renderAchievements(): void {
    const list = this.opts.getAchievements();
    this.achGrid.innerHTML = "";
    for (const a of list) {
      const card = document.createElement("div");
      card.className = "coll-ach" + (a.unlocked ? " unlocked" : "");
      card.innerHTML =
        `<div class="coll-ach-name">${a.unlocked ? "★ " : "☆ "}${a.name}</div>` +
        `<div class="coll-ach-desc">${a.desc}</div>`;
      this.achGrid.appendChild(card);
    }
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle("hidden-ui", !v);
    if (v) this.refresh();
  }
}
