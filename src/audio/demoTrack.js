// A royalty-free demo song rendered offline: 118 BPM, Am–F–C–G, with an intro, groove, breakdown
// and drop so the choreography has real energy changes to follow.
export const DEMO_BPM = 118;
const BARS = 26;
const CHORDS = [
  [57, 60, 64, 67], // Am7
  [53, 57, 60, 64], // Fmaj7
  [48, 52, 55, 59], // Cmaj7
  [55, 59, 62, 65], // G7
];
const ROOTS = [45, 41, 48, 43];
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export async function renderDemoTrack(sampleRate = 44100) {
  const beat = 60 / DEMO_BPM;
  const duration = BARS * 4 * beat + 2;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  comp.attack.value = 0.005;
  comp.release.value = 0.12;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(comp).connect(ctx.destination);

  // Pads and bass duck under the kick (sidechain feel).
  const duck = ctx.createGain();
  duck.connect(master);

  const noise = ctx.createBuffer(1, sampleRate, sampleRate);
  const data = noise.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    data[i] = (seed / 2147483647) * 2 - 1;
  }

  const delay = ctx.createDelay();
  delay.delayTime.value = beat * 0.75;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const delayOut = ctx.createGain();
  delayOut.gain.value = 0.35;
  delay.connect(fb).connect(delay);
  delay.connect(delayOut).connect(master);

  const kick = (t, level = 1) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.45);
    duck.gain.setValueAtTime(0.35, t);
    duck.gain.linearRampToValueAtTime(1, t + beat * 0.6);
  };

  const noiseHit = (t, { type, freq, q = 1, level, decay, pan = 0 }) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    s.connect(f).connect(g).connect(p).connect(master);
    s.start(t, (t * 7.31) % 0.5);
    s.stop(t + decay + 0.02);
  };

  const clap = (t, level = 0.5) => {
    for (let k = 0; k < 3; k++) noiseHit(t + k * 0.011, { type: 'bandpass', freq: 1400, q: 0.8, level, decay: k === 2 ? 0.22 : 0.03 });
  };
  const hat = (t, open, level = 0.16) =>
    noiseHit(t, { type: 'highpass', freq: 7500, level, decay: open ? 0.22 : 0.045, pan: open ? 0.15 : -0.12 });

  const tone = (t, len, freq, { type = 'sawtooth', level = 0.1, cutoff = 1200, dest = duck, attack = 0.01, detune = 0 }) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff * 2, t);
    f.frequency.exponentialRampToValueAtTime(cutoff, t + Math.min(len, 0.25));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + Math.max(attack, len - 0.05));
    g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(f).connect(g).connect(dest);
    o.start(t);
    o.stop(t + len + 0.02);
    return g;
  };

  for (let bar = 0; bar < BARS; bar++) {
    const t0 = bar * 4 * beat;
    const chord = bar % 4;
    const intro = bar < 4;
    const groove = bar >= 4 && bar < 14;
    const breakdown = bar >= 14 && bar < 18;
    const drop = bar >= 18 && bar < 25;
    const outro = bar === 25;

    // Pad, every section.
    const padLevel = breakdown ? 0.05 : intro ? 0.045 : 0.03;
    for (const n of CHORDS[chord]) {
      for (const d of [-8, 8]) tone(t0, 4 * beat, midi(n), { level: padLevel / 2, cutoff: breakdown ? 900 : 1500, attack: 0.3, detune: d });
    }

    for (let b = 0; b < 4; b++) {
      const t = t0 + b * beat;
      if ((groove || drop) || (intro && bar >= 2) || outro) kick(t, b === 0 ? 1 : 0.85);
      if ((groove || drop) && (b === 1 || b === 3)) clap(t, drop ? 0.55 : 0.45);
      if (!breakdown && !outro) {
        hat(t + beat / 2, groove || drop);
        if (drop || groove) hat(t, false, 0.08);
      }
      if (breakdown && bar === 17) noiseHit(t, { type: 'bandpass', freq: 600 + b * 900, q: 2, level: 0.08 + b * 0.05, decay: beat });
      if (groove || drop || breakdown) {
        const root = midi(ROOTS[chord]);
        tone(t + beat / 2, beat * 0.45, root, { type: 'sawtooth', level: breakdown ? 0.08 : 0.13, cutoff: drop ? 520 : 380 });
        if (drop) tone(t + beat * 0.75, beat * 0.2, root * 2, { type: 'square', level: 0.05, cutoff: 900 });
      }
      if (drop) {
        // Sixteenth-note arpeggio into the delay.
        for (let s = 0; s < 4; s++) {
          const n = CHORDS[chord][(b * 4 + s) % 4] + 12;
          const g = tone(t + (s * beat) / 4, beat / 4.5, midi(n), { type: 'square', level: 0.035, cutoff: 2600 });
          g.connect(delay);
        }
      }
    }
  }

  return ctx.startRendering();
}
