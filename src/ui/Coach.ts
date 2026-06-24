// A small guidance banner for the intro tutorial: a message at the top and, on the
// final step, a button to begin the real run.

export class Coach {
  private el: HTMLDivElement;
  private msg: HTMLDivElement;
  private btn: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "coach hidden-ui";
    this.msg = document.createElement("div");
    this.msg.className = "coach-msg";
    this.btn = document.createElement("button");
    this.btn.className = "title-btn primary coach-btn hidden-ui";
    this.el.append(this.msg, this.btn);
    parent.appendChild(this.el);
  }

  show(text: string, button?: { label: string; onClick: () => void }): void {
    this.el.classList.remove("hidden-ui");
    if (this.msg.textContent !== text) {
      this.msg.textContent = text;
      // re-trigger the entrance animation so each new message gracefully fades/slides in
      this.msg.classList.remove("coach-anim");
      void this.msg.offsetWidth; // force reflow
      this.msg.classList.add("coach-anim");
    }
    if (button) {
      this.btn.classList.remove("hidden-ui");
      this.btn.textContent = button.label;
      this.btn.onclick = button.onClick;
    } else {
      this.btn.classList.add("hidden-ui");
      this.btn.onclick = null;
    }
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle("hidden-ui", !v);
  }
}
