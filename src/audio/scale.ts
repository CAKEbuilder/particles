// Major pentatonic across several octaves. The whole point: ANY combination of these
// notes is consonant, so randomized triggers always sound pleasant.

const PENTATONIC = [0, 2, 4, 7, 9]; // major pentatonic semitone offsets

export function buildScale(baseFreq: number, octaves: number, startOctave: number): number[] {
  const freqs: number[] = [];
  for (let o = 0; o < octaves; o++) {
    for (const semi of PENTATONIC) {
      const n = semi + 12 * (o + startOctave);
      freqs.push(baseFreq * Math.pow(2, n / 12));
    }
  }
  freqs.sort((a, b) => a - b);
  return freqs;
}

/**
 * Pick a frequency. `t01` (0..1) chooses the rough register (low->high); a small
 * random scatter across nearby scale steps reveals "another element of surprise"
 * while staying in key.
 */
export function pickNote(scale: number[], t01: number, scatter = 2): number {
  const n = scale.length;
  let idx = Math.round(t01 * (n - 1));
  idx += Math.round((Math.random() - 0.5) * 2 * scatter);
  if (idx < 0) idx = 0;
  else if (idx >= n) idx = n - 1;
  return scale[idx];
}
