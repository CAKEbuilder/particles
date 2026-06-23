// Pause screen for a run: freezes the field (kept intact) and offers Resume / Main Menu.

export interface PauseOptions {
  onResume: () => void;
  onMainMenu: () => void;
  onProgress: () => void;
}

export class PauseOverlay {
  private el: HTMLDivElement;

  constructor(parent: HTMLElement, opts: PauseOptions) {
    this.el = document.createElement("div");
    this.el.className = "pause-screen hidden-ui";
    this.el.innerHTML = `<h2 class="pause-title">Paused</h2><div class="pause-menu"></div>`;
    const menu = this.el.querySelector(".pause-menu") as HTMLDivElement;
    menu.append(
      this.button("▶  Resume", "primary", opts.onResume),
      this.button("◈  Progress", "", opts.onProgress),
      this.button("☰  Main Menu", "", opts.onMainMenu)
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
