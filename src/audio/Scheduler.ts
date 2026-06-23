// Turns a flood of "play something" requests into a pleasant, rhythmic texture:
// quantize to a soft grid, cap voices per slot (separately per voice so player touches
// always cut through), and slowly drift the musical root for variety.

import { config } from "../config";
import type { AudioEngine, VoiceName } from "./AudioEngine";

export interface NoteRequest {
  pan: number; // -1..1
  register: number; // 0..1 (low..high)
  intensity: number; // 0..1
}

// pentatonic-friendly root offsets to drift between (all consonant with each other)
const ROOTS = [0, 2, 4, 7, -3, -5, 5];

export class Scheduler {
  private slotDur: number;
  private slotTime = 0;
  private slotUsed: Partial<Record<VoiceName, number>> = {};
  private nextDrift = 0;

  constructor(private readonly engine: AudioEngine) {
    this.slotDur = 60 / config.audio.bpm / 4; // 16th-note grid
  }

  request(voice: VoiceName, req: NoteRequest): void {
    const engine = this.engine;
    if (!engine.ready || !engine.ctx) return;
    const now = engine.ctx.currentTime;

    this.maybeDrift(now);

    const target = Math.ceil((now + 0.02) / this.slotDur) * this.slotDur;
    if (target !== this.slotTime) {
      this.slotTime = target;
      this.slotUsed = {};
    }

    const budget =
      (config.audio.maxVoices as Record<string, number>)[voice] ?? config.audio.maxVoicesDefault;
    const used = this.slotUsed[voice] ?? 0;
    if (used >= budget) return;
    this.slotUsed[voice] = used + 1;

    const gain = config.audio.voiceGain * (0.5 + 0.5 * req.intensity);
    const freq = engine.pickFreq(voice, req.register);
    engine.playNote(voice, freq, target, gain, req.pan);

    // spawn taps occasionally bloom into a 2-note pentatonic flourish (always consonant)
    if (voice === "spawn" && Math.random() < 0.25) {
      const freq2 = engine.pickFreq(voice, Math.min(1, req.register + 0.2));
      engine.playNote(voice, freq2, target + this.slotDur * 0.5, gain * 0.7, req.pan * 0.8);
    }
  }

  /** Slowly move the key root so the harmony keeps evolving over minutes. */
  private maybeDrift(now: number): void {
    if (this.nextDrift === 0) {
      this.nextDrift = now + 10;
      return;
    }
    if (now < this.nextDrift) return;
    this.nextDrift = now + 9 + Math.random() * 7; // every ~9-16s
    this.engine.rootSemis = ROOTS[(Math.random() * ROOTS.length) | 0];
  }
}
