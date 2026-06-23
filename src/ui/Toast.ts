// Transient notifications (achievement unlocks, level-ups, ascension). Stack top-center,
// fade in, auto-remove.

export type ToastKind = "ach" | "level" | "ascend";

export class Toast {
  private el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "toasts";
    parent.appendChild(this.el);
  }

  show(title: string, sub: string, kind: ToastKind = "ach"): void {
    const t = document.createElement("div");
    t.className = `toast toast-${kind}`;
    t.innerHTML = `<div class="toast-title">${title}</div><div class="toast-sub">${sub}</div>`;
    this.el.appendChild(t);
    // force reflow then animate in
    requestAnimationFrame(() => t.classList.add("in"));
    setTimeout(() => {
      t.classList.remove("in");
      setTimeout(() => t.remove(), 450);
    }, 3400);
  }
}
