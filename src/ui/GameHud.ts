// Game-mode HUD: swarm counter, points, level + XP bar, spawn-energy bar, and a
// permanent-buffs shop. Reads live values from GameState.

import { config } from "../config";
import type { GameState } from "../game/GameState";
import type { PowerUps } from "../game/PowerUps";

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export class GameHud {
  private el: HTMLDivElement;
  private pointsEl: HTMLSpanElement;
  private levelEl: HTMLSpanElement;
  private xpFill: HTMLDivElement;
  private energyFill: HTMLDivElement;
  private powerEl: HTMLDivElement;
  private shop: HTMLDivElement;
  private shopOpen = false;
  private buffRows = new Map<string, { cost: HTMLSpanElement; tier: HTMLSpanElement; btn: HTMLButtonElement; row: HTMLDivElement }>();

  private ascendBtn!: HTMLButtonElement;
  private shopBtn!: HTMLButtonElement;
  private hero: HTMLDivElement;
  private heroPps: HTMLDivElement;
  private swarmCount: HTMLDivElement;

  // Staged reveal refs
  private rowPoints: HTMLDivElement;
  private rowXp: HTMLDivElement;
  private rowEnergy: HTMLDivElement;

  private lastDisplayedCount = -1;
  private revealStage: 0 | 1 | 2 | 3 = 3;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly powerups: PowerUps,
    private readonly onAscend: () => void
  ) {
    // hero slot (top-centre): swarm counter always visible; pts/s shown at reveal ≥ 3
    this.hero = document.createElement("div");
    this.hero.className = "hero";

    this.swarmCount = document.createElement("div");
    this.swarmCount.className = "swarm-count";
    this.swarmCount.textContent = "0 / 0";

    this.heroPps = document.createElement("div");
    this.heroPps.className = "hero-pps";
    this.heroPps.innerHTML = `<b class="hero-pps-val">+0</b> pts/s`;

    this.hero.append(this.swarmCount, this.heroPps);
    parent.appendChild(this.hero);

    this.el = document.createElement("div");
    this.el.className = "game-hud";

    // points + level row
    this.rowPoints = document.createElement("div");
    this.rowPoints.className = "gh-top";
    this.rowPoints.innerHTML =
      `<div class="gh-points">◆ <span class="gh-points-val">0</span></div>` +
      `<div class="gh-level">Lv <span class="gh-level-val">1</span></div>`;
    this.el.appendChild(this.rowPoints);
    this.pointsEl = this.rowPoints.querySelector(".gh-points-val")!;
    this.levelEl = this.rowPoints.querySelector(".gh-level-val")!;

    // xp bar
    this.rowXp = document.createElement("div");
    this.rowXp.className = "gh-bar gh-bar-xp";
    this.rowXp.innerHTML = `<span class="gh-bar-label">XP</span><div class="gh-bar-track"><div class="gh-bar-fill"></div></div>`;
    this.el.appendChild(this.rowXp);
    this.xpFill = this.rowXp.querySelector(".gh-bar-fill") as HTMLDivElement;

    // energy bar
    this.rowEnergy = document.createElement("div");
    this.rowEnergy.className = "gh-bar gh-bar-energy";
    this.rowEnergy.innerHTML = `<span class="gh-bar-label">Energy</span><div class="gh-bar-track"><div class="gh-bar-fill"></div></div>`;
    this.el.appendChild(this.rowEnergy);
    this.energyFill = this.rowEnergy.querySelector(".gh-bar-fill") as HTMLDivElement;

    this.powerEl = document.createElement("div");
    this.powerEl.className = "gh-powerups";
    this.el.appendChild(this.powerEl);

    this.shopBtn = document.createElement("button");
    this.shopBtn.className = "hud-btn gh-shop-btn hidden-ui";
    this.shopBtn.innerHTML = `⚡ Buffs <span class="gh-deal">★</span>`;
    this.shopBtn.addEventListener("click", () => this.toggleShop());
    this.el.appendChild(this.shopBtn);

    this.shop = this.buildShop();
    this.el.appendChild(this.shop);

    parent.appendChild(this.el);
  }

  private buildShop(): HTMLDivElement {
    const shop = document.createElement("div");
    shop.className = "gh-shop hidden-ui";
    const title = document.createElement("div");
    title.className = "gh-shop-title";
    title.textContent = "Permanent buffs";
    shop.appendChild(title);

    for (const id of Object.keys(config.game.buffs)) {
      const b = config.game.buffs[id];
      const row = document.createElement("div");
      row.className = "gh-shop-row hidden-ui"; // hidden until unlockLevel met
      const nameWrap = document.createElement("div");
      nameWrap.className = "gh-shop-name-wrap";
      const name = document.createElement("span");
      name.className = "gh-shop-name";
      name.textContent = b.label;
      const desc = document.createElement("span");
      desc.className = "gh-shop-desc";
      desc.textContent = b.desc;
      nameWrap.append(name, desc);
      const tier = document.createElement("span");
      tier.className = "gh-shop-tier";
      const btn = document.createElement("button");
      btn.className = "hud-btn gh-buy";
      const cost = document.createElement("span");
      cost.className = "gh-shop-cost";
      btn.appendChild(cost);
      btn.addEventListener("click", () => {
        if (this.state.buyBuff(id)) this.refreshShop();
      });
      row.append(nameWrap, tier, btn);
      shop.appendChild(row);
      this.buffRows.set(id, { cost, tier, btn, row });
    }

    this.ascendBtn = document.createElement("button");
    this.ascendBtn.className = "hud-btn gh-ascend hidden-ui";
    this.ascendBtn.addEventListener("click", () => this.onAscend());
    shop.appendChild(this.ascendBtn);

    return shop;
  }

  private toggleShop(): void {
    this.shopOpen = !this.shopOpen;
    this.shop.classList.toggle("hidden-ui", !this.shopOpen);
    if (this.shopOpen) this.refreshShop();
  }

  private refreshShop(): void {
    const pts = this.state.points;
    const level = this.state.level;
    for (const [id, row] of this.buffRows) {
      const unlockLevel = config.game.buffs[id].unlockLevel;
      // hide rows the player hasn't unlocked yet
      row.row.classList.toggle("hidden-ui", level < unlockLevel);
      if (level < unlockLevel) continue;

      row.tier.textContent = `${this.state.buffTier(id)}/${config.game.buffs[id].max}`;
      if (this.state.buffMaxed(id)) {
        row.cost.textContent = "MAX";
        row.btn.disabled = true;
        row.btn.classList.remove("affordable");
      } else {
        const c = this.state.buffCost(id);
        row.cost.textContent = `◆ ${c}`;
        const ok = pts >= c;
        row.btn.disabled = !ok;
        row.btn.classList.toggle("affordable", ok);
      }
    }
    const can = this.state.canAscend();
    this.ascendBtn.classList.toggle("hidden-ui", !can);
    if (can) {
      const next = Math.round((1 + (this.state.ascension + 1) * config.game.ascendBonus) * 100);
      this.ascendBtn.textContent = `✦ Ascend → ${next}% points (resets level & buffs)`;
    }
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle("hidden-ui", !v);
    this.hero.classList.toggle("hidden-ui", !v);
  }

  /**
   * Staged reveal for tutorial:
   *   0 — counter only (game-hud panel hidden, pts/s hidden)
   *   1 — panel shows with level + XP bar; energy + points still hidden
   *   2 — add energy bar + points
   *   3 — full (pts/s subline visible)
   */
  setReveal(stage: 0 | 1 | 2 | 3): void {
    this.revealStage = stage;
    // stage 0: whole panel hidden; counter visible via hero block
    this.el.classList.toggle("hidden-ui", stage === 0);
    // pts/s only at full reveal
    this.heroPps.classList.toggle("hidden-ui", stage < 3);
    // points row + energy: hidden until stage 2
    this.rowPoints.classList.toggle("hidden-ui", stage < 2);
    this.rowEnergy.classList.toggle("hidden-ui", stage < 2);
    // xp bar: hidden until stage 1
    this.rowXp.classList.toggle("hidden-ui", stage < 1);
    // shop button gated by level separately (updateunlocks handles it)
  }

  /** Trigger a count-pop animation on the swarm counter. */
  private popCount(): void {
    this.swarmCount.classList.remove("count-pop");
    // force reflow so the class removal takes effect before re-adding
    void this.swarmCount.offsetWidth;
    this.swarmCount.classList.add("count-pop");
  }

  update(liveCount = 0): void {
    const cap = this.state.maxCapacity;
    const displayCount = formatCount(liveCount) + " / " + formatCount(cap);
    if (this.swarmCount.textContent !== displayCount) {
      this.swarmCount.textContent = displayCount;
      // pop on any change; more dramatic the larger the jump
      if (liveCount !== this.lastDisplayedCount) this.popCount();
      this.lastDisplayedCount = liveCount;
    }

    const rate = liveCount * config.game.pointRatePerParticle * this.state.pointMult;
    this.heroPps.querySelector(".hero-pps-val")!.textContent = `+${rate.toFixed(0)}`;
    this.pointsEl.textContent = Math.floor(this.state.points).toLocaleString();
    this.levelEl.textContent = String(this.state.level);
    this.xpFill.style.width = `${(this.state.levelProgress * 100).toFixed(1)}%`;
    this.energyFill.style.width = `${((this.state.energy / this.state.energyMax) * 100).toFixed(1)}%`;
    this.rowEnergy.classList.toggle("locked", this.state.locked);

    const ups = this.powerups.list();
    this.powerEl.innerHTML = ups
      .map((u) => `<span class="gh-pu">${u.label} <b>${Math.ceil(u.remaining)}s</b></span>`)
      .join("");

    // show the Buffs button only after reaching level 2 AND at full reveal
    this.shopBtn.classList.toggle("hidden-ui", this.state.level < 2 || this.revealStage < 3);
    this.shopBtn.classList.toggle("has-deal", this.anyAffordable());
    if (this.shopOpen) this.refreshShop();
  }

  /** True if any unlocked buff is purchasable now, or ascension is available — drives the ★ badge. */
  private anyAffordable(): boolean {
    if (this.state.canAscend()) return true;
    for (const [id] of this.buffRows) {
      if (config.game.buffs[id].unlockLevel > this.state.level) continue;
      if (!this.state.buffMaxed(id) && this.state.points >= this.state.buffCost(id)) return true;
    }
    return false;
  }
}
