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
  const e = err as Error & { glDiagnostic?: { webgl2Available: boolean } };
  const isGlError = "glDiagnostic" in e;
  // If the retry inside Renderer actually recovered a context, ask for a reload
  const reloadable = isGlError && e.glDiagnostic?.webgl2Available;
  const msg = e.message;
  const reloadBtn = reloadable
    ? `<button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;` +
      `background:#2ee6ff;color:#05060a;border:none;border-radius:8px;font-size:15px;cursor:pointer">` +
      `Reload</button>`
    : `<p style="font-size:13px;color:rgba(207,227,255,0.5);margin-top:8px">` +
      `Try the latest Chrome, Firefox, or Safari</p>`;
  document.body.innerHTML =
    `<div style="position:fixed;inset:0;display:grid;place-items:center;` +
    `color:#cfe3ff;font-family:system-ui;padding:24px;text-align:center">` +
    `<div><div style="font-size:48px;color:#2ee6ff">▽</div>` +
    `<p style="max-width:320px;line-height:1.5">${msg}</p>` +
    reloadBtn +
    `</div></div>`;
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
