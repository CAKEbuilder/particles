// Device-tilt gravity: while enabled, the phone's orientation drives the gravity
// direction (config.runtime.gravDir*). iOS requires a permission request from a gesture.

import { config } from "../config";

export class Tilt {
  private enabled = false;
  private pending = false; // guard against concurrent enable() calls
  private lastFire = 0; // debounce timestamp

  get isEnabled(): boolean {
    return this.enabled;
  }

  private handler = (e: DeviceOrientationEvent): void => {
    const now = performance.now();
    if (now - this.lastFire < 33) return; // cap at ~30 updates/sec
    this.lastFire = now;
    const beta = isFinite(e.beta ?? NaN) ? (e.beta as number) : 0;
    const gamma = isFinite(e.gamma ?? NaN) ? (e.gamma as number) : 0;
    // ~45° of tilt = full gravity in that direction
    config.runtime.gravDirX = Math.max(-1, Math.min(1, gamma / 45));
    config.runtime.gravDirY = Math.max(-1, Math.min(1, beta / 45));
  };

  /** Returns true if tilt is now active (false if permission denied / unsupported). */
  async enable(): Promise<boolean> {
    if (this.pending || this.enabled) return this.enabled;
    if (!("DeviceOrientationEvent" in window)) return false;
    this.pending = true;
    try {
      const DOE = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<"granted" | "denied">;
      };
      if (typeof DOE?.requestPermission === "function") {
        const result = await DOE.requestPermission();
        if (result !== "granted") return false;
      }
      try {
        window.addEventListener("deviceorientation", this.handler, true);
      } catch {
        return false;
      }
      this.enabled = true;
      config.gravityEnabled = true; // tilt implies gravity on
      return true;
    } catch {
      return false;
    } finally {
      this.pending = false;
    }
  }

  disable(): void {
    window.removeEventListener("deviceorientation", this.handler, true);
    this.enabled = false;
    config.runtime.gravDirX = 0;
    config.runtime.gravDirY = 1; // back to straight down
    config.gravityEnabled = false;
  }
}
