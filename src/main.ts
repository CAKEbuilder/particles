import "./style.css";

import { config } from "./config";
import { perf } from "./core/Profiler";
import { Game } from "./app/Game";

perf.enabled = import.meta.env.DEV; // profiler logging only in dev

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const uiRoot = document.getElementById("ui") as HTMLElement;

let game: Game;
try {
  game = new Game(canvas, uiRoot);
} catch (err) {
  document.body.innerHTML =
    `<div style="position:fixed;inset:0;display:grid;place-items:center;` +
    `color:#cfe3ff;font-family:system-ui;padding:24px;text-align:center">` +
    `<div><div style="font-size:48px;color:#2ee6ff">▽</div>` +
    `<p>${(err as Error).message}</p></div></div>`;
  throw err;
}

game.start();

// dev debug handle (load tests, tuning)
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = game;
  (game as unknown as Record<string, unknown>).config = config;
}

// PWA: register the service worker in production builds only.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
