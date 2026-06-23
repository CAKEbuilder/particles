// Intentional haptics: short vibrations on clear, meaningful events only. No-op where
// unsupported (most desktops, iOS Safari). Toggleable via settings.

let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

function buzz(pattern: number | number[]): void {
  if (!enabled) return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate === "function") nav.vibrate(pattern);
}

export const Haptics = {
  tap: () => buzz(8), // small confirmation
  level: () => buzz(22), // level up
  lock: () => buzz([24, 26, 24]), // ran out of energy
  unlock: () => buzz([14, 40, 28]), // special / buff secured
};
