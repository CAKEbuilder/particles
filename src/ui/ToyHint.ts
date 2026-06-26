// Wordless first-touch affordance for the toy mode: a soft pulsing ring at center
// that disappears the moment the player touches the screen.

export class ToyHint {
  private el: HTMLDivElement;
  private onFirstTouch: (() => void) | null = null;
  private pointerHandler = () => this.dismiss();

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "toy-hint hidden-ui";
    this.el.innerHTML =
      `<div class="toy-hint-ring toy-hint-ring--a"></div>` +
      `<div class="toy-hint-ring toy-hint-ring--b"></div>` +
      `<div class="toy-hint-dot"></div>`;
    parent.appendChild(this.el);
  }

  show(onFirstTouch?: () => void): void {
    this.onFirstTouch = onFirstTouch ?? null;
    this.el.classList.remove("hidden-ui");
    // Use capture so we see the touch before Input does
    window.addEventListener("pointerdown", this.pointerHandler, { once: true, capture: true });
  }

  private dismiss(): void {
    this.el.classList.add("toy-hint--out");
    setTimeout(() => this.el.classList.add("hidden-ui"), 400);
    this.onFirstTouch?.();
    this.onFirstTouch = null;
  }

  hide(): void {
    window.removeEventListener("pointerdown", this.pointerHandler, true);
    this.el.classList.add("hidden-ui");
    this.el.classList.remove("toy-hint--out");
  }
}
