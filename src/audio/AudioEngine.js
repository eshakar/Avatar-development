// Multi-track mixer + transport. The live graph and the export (OfflineAudioContext) are built by the same
// functions, so what you hear while previewing is exactly what ends up in the video.
const dbToGain = (db) => (db <= -60 ? 0 : 10 ** (db / 20));

export const TRACK_COLORS = ['#a78bfa', '#38bdf8', '#f472b6', '#34d399', '#fbbf24', '#fb7185'];

export const DEFAULT_MASTER = { gainDb: 0, low: 0, mid: 0, high: 0, compressor: true };

function buildMaster(ctx, master) {
  const low = ctx.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 180;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 1100;
  mid.Q.value = 0.8;
  const high = ctx.createBiquadFilter();
  high.type = 'highshelf';
  high.frequency.value = 5500;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 8;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  const bypass = ctx.createGain();
  const wet = ctx.createGain();
  const out = ctx.createGain();
  low.connect(mid).connect(high);
  high.connect(comp).connect(wet).connect(out);
  high.connect(bypass).connect(out);
  const nodes = { input: low, low, mid, high, wet, bypass, out };
  applyMaster(nodes, master, ctx.currentTime);
  return nodes;
}

function applyMaster(nodes, m, now) {
  nodes.low.gain.setTargetAtTime(m.low, now, 0.02);
  nodes.mid.gain.setTargetAtTime(m.mid, now, 0.02);
  nodes.high.gain.setTargetAtTime(m.high, now, 0.02);
  nodes.wet.gain.setTargetAtTime(m.compressor ? 1 : 0, now, 0.02);
  nodes.bypass.gain.setTargetAtTime(m.compressor ? 0 : 1, now, 0.02);
  nodes.out.gain.setTargetAtTime(dbToGain(m.gainDb), now, 0.02);
}

const audible = (track, anySolo) => !track.mute && (!anySolo || track.solo);

export class AudioEngine {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = { ...DEFAULT_MASTER };
    this.masterNodes = buildMaster(this.ctx, this.master);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.masterNodes.out.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.meterData = new Float32Array(this.analyser.fftSize);

    this.tracks = [];
    this.playing = false;
    this.position = 0;
    this.startedAt = 0;
    this.startPos = 0;
    this.loop = true;
    this.length = 0;

    this.click = { on: false, grid: null, nextBeat: 0, timer: null };
  }

  decode(arrayBuffer) {
    return this.ctx.decodeAudioData(arrayBuffer);
  }

  addTrack({ id, name, buffer, offset = 0, gainDb = 0, pan = 0, color }) {
    const gain = this.ctx.createGain();
    const panner = this.ctx.createStereoPanner();
    gain.connect(panner).connect(this.masterNodes.input);
    const track = {
      id: id ?? `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      buffer,
      offset,
      gainDb,
      pan,
      mute: false,
      solo: false,
      color: color ?? TRACK_COLORS[this.tracks.length % TRACK_COLORS.length],
      nodes: { gain, panner },
      source: null,
    };
    this.tracks.push(track);
    this.#applyTrackParams();
    if (this.playing) this.#startSource(track, this.ctx.currentTime + 0.03, this.time);
    return track;
  }

  removeTrack(id) {
    const track = this.tracks.find((t) => t.id === id);
    if (!track) return;
    this.#stopSource(track);
    track.nodes.panner.disconnect();
    this.tracks = this.tracks.filter((t) => t !== track);
    this.#applyTrackParams();
  }

  updateTrack(id, patch) {
    const track = this.tracks.find((t) => t.id === id);
    if (!track) return;
    const offsetChanged = patch.offset !== undefined && patch.offset !== track.offset;
    Object.assign(track, patch);
    this.#applyTrackParams();
    if (offsetChanged && this.playing) {
      this.#stopSource(track);
      this.#startSource(track, this.ctx.currentTime + 0.03, this.time);
    }
  }

  setMaster(patch) {
    Object.assign(this.master, patch);
    applyMaster(this.masterNodes, this.master, this.ctx.currentTime);
  }

  #applyTrackParams() {
    const anySolo = this.tracks.some((t) => t.solo);
    const now = this.ctx.currentTime;
    for (const t of this.tracks) {
      t.nodes.gain.gain.setTargetAtTime(audible(t, anySolo) ? dbToGain(t.gainDb) : 0, now, 0.015);
      t.nodes.panner.pan.setTargetAtTime(t.pan, now, 0.015);
    }
  }

  // Project length: the end of the last audible track (muted ones don't stretch the video).
  get duration() {
    const anySolo = this.tracks.some((t) => t.solo);
    const live = this.tracks.filter((t) => audible(t, anySolo));
    const end = Math.max(0, ...(live.length ? live : this.tracks).map((t) => t.offset + t.buffer.duration));
    return Math.max(1, this.length || end);
  }

  // Transport position in seconds.
  get time() {
    if (!this.playing) return this.position;
    return this.startPos + (this.ctx.currentTime - this.startedAt);
  }

  // What the listener hears right now: compensates for the output device latency so visuals line up.
  get audibleTime() {
    if (!this.playing) return this.position;
    const latency = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return Math.max(0, this.time - latency);
  }

  #startSource(track, when, pos) {
    const rel = pos - track.offset;
    if (rel >= track.buffer.duration) return;
    const src = this.ctx.createBufferSource();
    src.buffer = track.buffer;
    src.connect(track.nodes.gain);
    if (rel >= 0) src.start(when, rel);
    else src.start(when - rel, 0);
    track.source = src;
  }

  #stopSource(track) {
    if (!track.source) return;
    try {
      track.source.stop();
    } catch {
      /* not started */
    }
    track.source.disconnect();
    track.source = null;
  }

  async play(from = this.position) {
    await this.ctx.resume();
    if (this.playing) this.#stopAll();
    const when = this.ctx.currentTime + 0.04;
    this.startedAt = when;
    this.startPos = from >= this.duration - 0.05 ? 0 : from;
    for (const t of this.tracks) this.#startSource(t, when, this.startPos);
    this.playing = true;
    this.#restartClick();
  }

  pause() {
    if (!this.playing) return;
    this.position = Math.min(this.time, this.duration);
    this.#stopAll();
    this.playing = false;
  }

  seek(t) {
    const pos = Math.max(0, Math.min(t, this.duration));
    if (this.playing) this.play(pos);
    else this.position = pos;
  }

  // Called every frame by the app: handles looping at the end.
  update(rangeEnd = this.duration, rangeStart = 0) {
    if (this.playing && this.time >= rangeEnd) {
      if (this.loop) this.play(rangeStart);
      else {
        this.pause();
        this.position = rangeEnd;
      }
    }
  }

  #stopAll() {
    for (const t of this.tracks) this.#stopSource(t);
    clearInterval(this.click.timer);
  }

  // ------------------------------------------------------------------ metronome

  setClick(on, grid = this.click.grid) {
    this.click.on = on;
    this.click.grid = grid;
    this.#restartClick();
  }

  #restartClick() {
    clearInterval(this.click.timer);
    if (!this.click.on || !this.playing || !this.click.grid) return;
    const grid = this.click.grid;
    this.click.nextBeat = Math.ceil(grid.beatAt(this.time));
    // Look-ahead scheduler: precise audio-clock timing, cheap JS timer.
    const schedule = () => {
      const horizon = this.time + 0.2;
      while (grid.timeAt(this.click.nextBeat) < horizon) {
        const b = this.click.nextBeat++;
        const when = this.startedAt + (grid.timeAt(b) - this.startPos);
        if (when >= this.ctx.currentTime) this.#blip(when, grid.isDownbeat(b));
      }
    };
    schedule();
    this.click.timer = setInterval(schedule, 40);
  }

  #blip(when, accent) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = accent ? 1760 : 1180;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.35, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    o.connect(g).connect(this.ctx.destination);
    o.start(when);
    o.stop(when + 0.08);
  }

  // ------------------------------------------------------------------ metering

  level() {
    this.analyser.getFloatTimeDomainData(this.meterData);
    let peak = 0;
    for (const v of this.meterData) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  // ------------------------------------------------------------------ export

  async renderMix(start, end, sampleRate = 48000) {
    const length = Math.ceil((end - start) * sampleRate);
    const ctx = new OfflineAudioContext(2, length, sampleRate);
    const master = buildMaster(ctx, this.master);
    master.out.connect(ctx.destination);
    const anySolo = this.tracks.some((t) => t.solo);
    for (const t of this.tracks) {
      if (!audible(t, anySolo)) continue;
      const rel = start - t.offset;
      if (rel >= t.buffer.duration) continue;
      const gain = ctx.createGain();
      gain.gain.value = dbToGain(t.gainDb);
      const pan = ctx.createStereoPanner();
      pan.pan.value = t.pan;
      const src = ctx.createBufferSource();
      src.buffer = t.buffer;
      src.connect(gain).connect(pan).connect(master.input);
      if (rel >= 0) src.start(0, rel);
      else src.start(-rel, 0);
    }
    return ctx.startRendering();
  }

  dispose() {
    this.#stopAll();
    this.ctx.close();
  }
}

// Mono mixdown for analysis.
export function toMono(buffer) {
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buffer.numberOfChannels;
  }
  return out;
}

let worker;
let nextId = 0;
const pending = new Map();

export function analyzeInWorker(buffer, options) {
  if (!worker) {
    worker = new Worker(new URL('./analysis.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) p?.reject(new Error(data.error));
      else p?.resolve(data.result);
    };
  }
  const id = ++nextId;
  const samples = toMono(buffer);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, samples, sampleRate: buffer.sampleRate, options }, [samples.buffer]);
  });
}
