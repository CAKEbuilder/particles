// Pick a particle budget + DPR the device can actually sustain at 60fps.
// DPR strongly affects memory: the HDR ping-pong framebuffers are full backing-resolution,
// so capping DPR on phones avoids the memory pressure that was reloading the page.

export interface DeviceTier {
  capacity: number;
  mobile: boolean;
  label: string;
  dprCap: number;
}

export function detectDevice(): DeviceTier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  let capacity: number;
  let label: string;
  let dprCap: number;

  // The runtime governor eases quality if a device can't keep up; these are conservative
  // so typical play holds 60fps with comfortable memory headroom.
  if (mobile) {
    if (mem <= 2 || cores <= 4) {
      capacity = 5000;
      label = "mobile-low";
      dprCap = 1.25;
    } else {
      capacity = 11000;
      label = "mobile";
      dprCap = 1.5;
    }
  } else {
    if (cores >= 8 && mem >= 8) {
      capacity = 40000;
      label = "desktop-high";
      dprCap = 2;
    } else {
      capacity = 26000;
      label = "desktop";
      dprCap = 2;
    }
  }

  return { capacity, mobile, label, dprCap };
}
