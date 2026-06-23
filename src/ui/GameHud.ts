// Game-mode HUD: points, level + XP bar, spawn-energy bar, capacity meter, and a
// permanent-buffs shop. Reads live values from GameState.

import { config } from "../config";
import type { GameState } from "../game/GameState";
import type { PowerUps } from "../game/PowerUps";

export class GameHud {
  private el: HTMLDivElement;
  private pointsEl: HTMLSpanElement;
  private levelEl: HTMLSpanElement;
  private xpFill: HTMLDivElement;
  private energyFill: HTMLDivElement;
  private capEl: HTMLSpanElement;
  private powerEl: HTMLDivElement;
  private shop: HTMLDivElement;
  private shopOpen = false;
  private buffRows = new Map<string, { cost: HTMLSpanElement; tier: HTMLSpanElement; btn: HTMLButtonElement; row: HTMLDivElement }>();

  private ascendBtn!: HTMLButtonElement;
  private shopBtn!: HTMLButtonElement;
  private hero: HTMLDivElement;
  private heroPps: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly powerups: PowerUps,
    private readonly onAscend: () => void
  ) {
    // hero readout (top-centre): pts/sec is the number you always want high
    this.hero = document.createElement("div");
    this.hero.className = "hero";
    this.hero.innerHTML = `<div class="hero-pps"><b class="hero-pps-val">+0</b> pts/s</div>`;
    parent.appendChild(this.hero);
    this.heroPps = this.hero.querySelector(".hero-pps-val")!;

    this.el = document.createElement("div");
    this.el.className = "game-hud";

    const top = document.createElement("div");
    top.className = "gh-top";
    top.innerHTML =
      `<div class="gh-points">◆ <span class="gh-points-val">0</span></div>` +
      `<div class="gh-level">Lv <span class="gh-level-val">1</span></div>`;
    this.el.appendChild(top);
    this.pointsEl = top.querySelector(".gh-points-val")!;
    this.levelEl = top.querySelector(".gh-level-val")!;

    this.xpFill = this.bar("xp", "XP");
    this.energyFill = this.bar("energy", "Energy");

    const capLine = document.createElement("div");
    capLine.className = "gh-cap";
    capLine.innerHTML = `Capacity <span class="gh-cap-val">0</span>`;
    this.el.appendChild(capLine);
    this.capEl = capLine.querySelector(".gh-cap-val")!;

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

  private bar(cls: string, label: string): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = `gh-bar gh-bar-${cls}`;
    wrap.innerHTML = `<span class="gh-bar-label">${label}</span><div class="gh-bar-track"><div class="gh-bar-fill"></div></div>`;
    this.el.appendChild(wrap);
    return wrap.querySelector(".gh-bar-fill") as HTMLDivElement;
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

  /** Hide distracting readouts during tutorial; unhide when done. */
  setTutorialMode(on: boolean): void {
    this.hero.classList.toggle("hidden-ui", on);
    this.pointsEl.parentElement?.classList.toggle("hidden-ui", on);
    // energyFill → gh-bar-track → gh-bar-energy
    this.energyFill.parentElement?.parentElement?.classList.toggle("hidden-ui", on);
  }

  update(liveCount = 0): void {
    const rate = liveCount * config.game.pointRatePerParticle * this.state.pointMult;
    this.heroPps.textContent = `+${rate.toFixed(0)}`;
    this.pointsEl.textContent = Math.floor(this.state.points).toLocaleString();
    this.levelEl.textContent = String(this.state.level);
    this.xpFill.style.width = `${(this.state.levelProgress * 100).toFixed(1)}%`;
    this.energyFill.style.width = `${((this.state.energy / this.state.energyMax) * 100).toFixed(1)}%`;
    this.energyFill.parentElement?.parentElement?.classList.toggle("locked", this.state.locked);
    this.capEl.textContent = this.state.maxCapacity.toLocaleString();

    const ups = this.powerups.list();
    this.powerEl.innerHTML = ups
      .map((u) => `<span class="gh-pu">${u.label} <b>${Math.ceil(u.remaining)}s</b></span>`)
      .join("");

    // show the Buffs button only after reaching level 2
    this.shopBtn.classList.toggle("hidden-ui", this.state.level < 2);
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
