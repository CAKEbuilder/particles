// Title screen: apex logo + wordmark + Play (calm toy) / Journey (scored) / Sandbox / etc.

import { apexLogoSVG } from "./apexLogo";

export interface TitleOptions {
  onPlay: () => void;
  onJourney: () => void;
  onSandbox: () => void;
  onCollection: () => void;
  onProgress: () => void;
}

export class TitleOverlay {
  private el: HTMLDivElement;

  constructor(parent: HTMLElement, opts: TitleOptions) {
    this.el = document.createElement("div");
    this.el.className = "title-screen";
    this.el.innerHTML =
      `<div class="title-logo">${apexLogoSVG(132)}</div>` +
      `<h1 class="title-word">PARTICLES</h1>` +
      `<div class="title-menu"></div>`;

    const menu = this.el.querySelector(".title-menu") as HTMLDivElement;
    menu.append(
      this.button("▶  Play", "primary", opts.onPlay),
      this.button("◆  Journey", "", opts.onJourney),
      this.button("✦  Sandbox", "", opts.onSandbox),
      this.button("◈  Collection", "", opts.onCollection),
      this.button("☰  Progress", "", opts.onProgress)
    );
    parent.appendChild(this.el);
  }

  private button(label: string, variant: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `title-btn ${variant}`;
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle("hidden-ui", !v);
  }
}
