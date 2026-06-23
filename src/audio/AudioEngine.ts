// Web Audio synth. Each tool/event maps to its own voice so the modes sound distinct
// yet complementary, all snapped to a pentatonic key (so any combination is consonant):
//   spawn   - warm marimba/bell pluck (player, foreground)
//   attract - rising shimmer (pitch glides up)
//   repel   - airy downward sigh (pitch glides down)
//   wind    - breathy filtered-noise whoosh
//   erase   - soft low muted thud
//   particle- glassy sparkle for wall bounces
//   micro   - tiny high tick for particle-particle collisions (very quiet)
// A drifting key root + per-note detune/octave-scatter keep it from feeling exhausted.

import { config } from "../config";
import { buildScale, pickNote } from "./scale";

export type VoiceName = "spawn" | "attract" | "repel" | "wind" | "erase" | "particle" | "micro";

interface Harmonic {
  ratio: number;
  gain: number;
  type: OscillatorType;
}

interface VoicePreset {
  partials?: Harmonic[];
  noise?: boolean; // filtered-noise voice (wind)
  noiseQ?: number;
  glide?: number; // freq end/start ratio over the note (>1 up, <1 down)
  attack: number;
  decay: number; // base ring time (s)
  gain: number; // relative loudness
  reverb: number;
  delay: number;
  regLo: number; // register window (0..1) this voice sings in
  regHi: number;
}

const VOICES: Record<VoiceName, VoicePreset> = {
  spawn: {
    partials: [
      { ratio: 1, gain: 1.0, type: "triangle" },
      { ratio: 2.01, gain: 0.28, type: "sine" },
      { ratio: 3.0, gain: 0.12, type: "sine" },
    ],
    attack: 0.006,
    decay: 1.1,
    gain: 1.0,
    reverb: 0.45,
    delay: 0.2,
    regLo: 0.12,
    regHi: 0.62,
  },
  attract: {
    // warm, soft "gathering" tone with a gentle lift (no shrill sweep)
    partials: [
      { ratio: 1, gain: 0.9, type: "sine" },
      { ratio: 1.5, gain: 0.16, type: "sine" },
      { ratio: 3.0, gain: 0.06, type: "sine" },
    ],
    glide: 1.12, // subtle upward bend
    attack: 0.05,
    decay: 0.9,
    gain: 0.6,
    reverb: 0.6,
    delay: 0.14,
    regLo: 0.22,
    regHi: 0.58,
  },
  repel: {
    partials: [
      { ratio: 1, gain: 0.8, type: "sine" },
      { ratio: 1.5, gain: 0.2, type: "sine" },
    ],
    glide: 0.6, // falls
    attack: 0.02,
    decay: 0.8,
    gain: 0.7,
    reverb: 0.55,
    delay: 0.18,
    regLo: 0.3,
    regHi: 0.65,
  },
  wind: {
    noise: true,
    noiseQ: 5,
    attack: 0.08,
    decay: 0.6,
    gain: 0.5,
    reverb: 0.5,
    delay: 0.1,
    regLo: 0.25,
    regHi: 0.6,
  },
  erase: {
    partials: [
      { ratio: 1, gain: 0.9, type: "sine" },
      { ratio: 0.5, gain: 0.3, type: "sine" },
    ],
    attack: 0.004,
    decay: 0.35,
    gain: 0.6,
    reverb: 0.25,
    delay: 0.05,
    regLo: 0.05,
    regHi: 0.32,
  },
  particle: {
    partials: [
      { ratio: 1, gain: 0.7, type: "sine" },
      { ratio: 4.02, gain: 0.22, type: "sine" },
    ],
    attack: 0.003,
    decay: 0.4,
    gain: 0.5,
    reverb: 0.7,
    delay: 0.28,
    regLo: 0.5,
    regHi: 1.0,
  },
  micro: {
    partials: [{ ratio: 1, gain: 0.6, type: "sine" }],
    attack: 0.002,
    decay: 0.18,
    gain: 0.3,
    reverb: 0.6,
    delay: 0.1,
    regLo: 0.7,
    regHi: 1.0,
  },
};

interface Sends {
  reverb: GainNode;
  delay: GainNode;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  ready = false;
  muted = false;
  scale: number[] = [];
  rootSemis = 0; // drifting key root (set by the scheduler)

  private master!: GainNode;
  private sends: Partial<Record<VoiceName, Sends>> = {};
  private noiseBuffer: AudioBuffer | null = null;

  init(): void {
    if (this.ctx) return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;

    const a = config.audio;
    this.scale = buildScale(a.baseFreq, a.octaves, a.startOctave);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = a.lowpassHz;
    lp.Q.value = 0.4;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 24;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.18;

    // brick-wall limiter to stop summed voices from clipping (the main crackle source)
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : a.masterGain;
    this.master.connect(lp);
    lp.connect(comp);
    comp.connect(limiter);
    limiter.connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(ctx, 2.8, 2.6);
    reverb.connect(this.master);

    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 60 / a.bpm / 2;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(this.master);

    for (const name of Object.keys(VOICES) as VoiceName[]) {
      const v = VOICES[name];
      const r = ctx.createGain();
      r.gain.value = v.reverb;
      r.connect(reverb);
      const d = ctx.createGain();
      d.gain.value = v.delay;
      d.connect(delay);
      this.sends[name] = { reverb: r, delay: d };
    }

    this.noiseBuffer = this.makeNoise(ctx, 1.0);
    this.ready = true;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : config.audio.masterGain;
  }

  /** Pick a pentatonic frequency in this voice's register from a 0..1 control value. */
  pickFreq(voiceName: VoiceName, register: number): number {
    const v = VOICES[voiceName];
    const t = v.regLo + Math.max(0, Math.min(1, register)) * (v.regHi - v.regLo);
    return pickNote(this.scale, t);
  }

  voiceGain(voiceName: VoiceName): number {
    return VOICES[voiceName].gain;
  }

  playNote(voiceName: VoiceName, baseFreq: number, when: number, gain: number, pan: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const v = VOICES[voiceName];
    const sends = this.sends[voiceName];

    const detune = Math.pow(2, ((Math.random() - 0.5) * 11) / 1200);
    const freq = baseFreq * Math.pow(2, this.rootSemis / 12) * detune;

    const ring = v.decay * (0.8 + Math.random() * 0.4) * (1.5 - Math.min(1.0, freq / 1500));
    const dur = Math.max(0.1, ring);

    const stop = when + dur + 0.05;
    const env = ctx.createGain();
    const peak = Math.max(0.0005, gain * v.gain);
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(peak, when + v.attack);
    env.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    env.gain.linearRampToValueAtTime(0, stop); // settle to true zero -> no click on stop

    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    env.connect(panner);
    panner.connect(this.master);
    if (sends) {
      panner.connect(sends.reverb);
      panner.connect(sends.delay);
    }

    if (v.noise && this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq;
      bp.Q.value = v.noiseQ ?? 4;
      src.connect(bp);
      bp.connect(env);
      src.start(when);
      src.stop(stop);
      return;
    }

    const partials = v.partials ?? [{ ratio: 1, gain: 1, type: "sine" as OscillatorType }];
    for (const p of partials) {
      const osc = ctx.createOscillator();
      osc.type = p.type;
      const f0 = freq * p.ratio;
      if (v.glide && v.glide !== 1) {
        osc.frequency.setValueAtTime(f0, when);
        osc.frequency.exponentialRampToValueAtTime(f0 * v.glide, when + dur * 0.8);
      } else {
        osc.frequency.value = f0;
      }
      if (p.gain === 1) {
        osc.connect(env);
      } else {
        const g = ctx.createGain();
        g.gain.value = p.gain;
        osc.connect(g);
        g.connect(env);
      }
      osc.start(when);
      osc.stop(stop);
    }
  }

  private makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  private makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }
}
