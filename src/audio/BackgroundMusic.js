// Looping background music. Everything runs through one Web Audio master gain, so file tracks and the
// built-in generative pad share the same volume control and fades.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Am7 → Fmaj7 → Cmaj7 → G6, low register.
const CHORDS = [
  [110.0, 130.81, 164.81, 196.0],
  [87.31, 110.0, 130.81, 164.81],
  [130.81, 164.81, 196.0, 246.94],
  [98.0, 123.47, 146.83, 164.81],
];
const CHORD_SECONDS = 8;

function startAmbientPad(ctx, destination) {
  const out = ctx.createGain();
  out.gain.value = 0.09;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 800;
  filter.Q.value = 1;

  // Slow filter sweep so the pad breathes.
  const lfo = ctx.createOscillator();
  const lfoDepth = ctx.createGain();
  lfo.frequency.value = 0.07;
  lfoDepth.gain.value = 450;
  lfo.connect(lfoDepth).connect(filter.frequency);

  // A little echo for space.
  const delay = ctx.createDelay();
  const feedback = ctx.createGain();
  delay.delayTime.value = 0.45;
  feedback.gain.value = 0.35;
  delay.connect(feedback).connect(delay);

  filter.connect(out);
  filter.connect(delay);
  delay.connect(out);
  out.connect(destination);

  const voices = CHORDS[0].flatMap((freq) =>
    [-7, 7].map((detune) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start();
      return osc;
    }),
  );
  lfo.start();

  let chord = 0;
  const timer = setInterval(() => {
    chord = (chord + 1) % CHORDS.length;
    voices.forEach((osc, i) => osc.frequency.setTargetAtTime(CHORDS[chord][i >> 1], ctx.currentTime, 0.8));
  }, CHORD_SECONDS * 1000);

  return () => {
    clearInterval(timer);
    [...voices, lfo].forEach((osc) => osc.stop());
    out.disconnect();
  };
}

export const BUILTIN_TRACKS = [{ id: 'ambient-pad', name: 'Ambient pad', tag: 'Generated live', synth: true }];

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'webm'];

export const isAudioFile = (name) => AUDIO_EXTENSIONS.includes(name.split('.').pop().toLowerCase());

// Reads /public/music/manifest.json, e.g. [{ "name": "Lo-fi loop", "file": "lofi.mp3" }]
export async function loadMusicManifest() {
  try {
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}music/manifest.json`, { cache: 'no-store' });
    if (!res.ok) return [];
    const list = await res.json();
    return list
      .filter((entry) => entry.file && isAudioFile(entry.file))
      .map((entry) => ({
        id: `local-${entry.file}`,
        name: entry.name ?? entry.file.replace(/\.[^.]+$/, ''),
        tag: entry.tag ?? 'Local track',
        url: `${base}music/${encodeURI(entry.file)}`,
      }));
  } catch {
    return [];
  }
}

export class BackgroundMusic {
  constructor() {
    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.crossOrigin = 'anonymous';
    this.ctx = null;
    this.master = null;
    this.track = null;
    this.loadedUrl = null;
    this.stopPad = null;
    this.stopTimer = null;
    this.volume = 0.5;
    this.playing = false;
  }

  // Must first run inside a user gesture: browsers block audio until the page is interacted with.
  #ensureContext() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.ctx.destination);
    this.ctx.createMediaElementSource(this.audio).connect(this.master);
  }

  #ramp(value, seconds) {
    if (!this.ctx) return;
    const gain = this.master.gain;
    const now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(value * value, now + seconds);
  }

  async #startSource() {
    if (!this.track) return;
    if (this.track.synth) {
      this.stopPad ??= startAmbientPad(this.ctx, this.master);
      return;
    }
    if (this.loadedUrl !== this.track.url) {
      this.audio.src = this.track.url;
      this.loadedUrl = this.track.url;
    }
    await this.audio.play();
  }

  #stopSource() {
    this.stopPad?.();
    this.stopPad = null;
    this.audio.pause();
  }

  async play() {
    this.#ensureContext();
    clearTimeout(this.stopTimer);
    await this.ctx.resume();
    this.playing = true;
    try {
      await this.#startSource();
    } catch (err) {
      this.playing = false;
      throw err;
    }
    this.#ramp(this.volume, 1.2);
  }

  pause() {
    this.playing = false;
    this.#ramp(0, 0.6);
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => !this.playing && this.#stopSource(), 650);
  }

  // Crossfades when already playing.
  async setTrack(track) {
    this.track = track;
    if (!this.playing) {
      this.#stopSource();
      return;
    }
    this.#ramp(0, 0.3);
    await wait(320);
    if (this.track !== track || !this.playing) return;
    this.#stopSource();
    await this.#startSource();
    this.#ramp(this.volume, 1);
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.playing) this.#ramp(volume, 0.1);
  }

  dispose() {
    clearTimeout(this.stopTimer);
    this.#stopSource();
    this.audio.removeAttribute('src');
    this.ctx?.close();
  }
}
