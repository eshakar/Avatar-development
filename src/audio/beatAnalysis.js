// Beat tracking in three steps, all in plain JS so it runs in a worker (or Node for tests):
//   1. onset strength: log-magnitude spectral flux, plus a low-band (kick) flux and RMS
//   2. tempo: autocorrelation of the onset envelope, weighted by a log-normal tempo prior
//   3. beats: Ellis (2007) dynamic programming, which follows small tempo drifts
// Downbeats come from which of the four bar positions carries the most low-end accent.

const FRAME = 1024;
const HOP = 256;

export function analyzeBeats(samples, sampleRate, { bpmHint = 120, minBpm = 70, maxBpm = 160 } = {}) {
  // Decimate to ~22 kHz; plenty for rhythm and halves the FFT work.
  const factor = Math.max(1, Math.round(sampleRate / 22050));
  const sr = sampleRate / factor;
  const n = Math.floor(samples.length / factor);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += samples[i * factor + k];
    x[i] = s / factor;
  }

  const fps = sr / HOP;
  const frames = Math.max(1, Math.floor((n - FRAME) / HOP) + 1);
  const { flux, low, lowEnergy, rms } = spectralFlux(x, sr, frames);

  const onset = normalizeOnset(flux, Math.round(fps * 0.4));
  const lowOnset = normalizeOnset(low, Math.round(fps * 0.4));

  let { period, confidence } = estimateTempo(onset, fps, bpmHint);
  let bpm = (60 * fps) / period;
  while (bpm < minBpm) (bpm *= 2), (period /= 2);
  while (bpm > maxBpm) (bpm /= 2), (period *= 2);

  const beatFrames = trackBeats(onset, period);
  // Frame f is centred on sample f·hop + frame/2; flux peaks slightly before the transient reaches the centre.
  const frameTime = (f) => (f * HOP + FRAME / 2 + 0.75 * HOP) / sr;
  const beats = Float64Array.from(beatFrames, frameTime);

  const sample = (arr, f) => {
    let m = 0;
    for (let k = Math.max(0, f - 2); k <= Math.min(arr.length - 1, f + 2); k++) m = Math.max(m, arr[k]);
    return m;
  };

  // Bar position whose beats carry the most low-end energy wins.
  let downbeat = 0;
  let best = -Infinity;
  for (let phase = 0; phase < 4; phase++) {
    let sum = 0;
    let count = 0;
    for (let i = phase; i < beatFrames.length; i += 4) {
      sum += sample(lowEnergy, Math.round(beatFrames[i]));
      count++;
    }
    const score = count ? sum / count : 0;
    if (score > best) (best = score), (downbeat = phase);
  }

  // Per-beat loudness and accent, normalised to the song's 95th percentile.
  const beatEnergy = new Float32Array(beatFrames.length);
  const beatAccent = new Float32Array(beatFrames.length);
  for (let i = 0; i < beatFrames.length; i++) {
    const a = Math.round(beatFrames[i]);
    const b = i + 1 < beatFrames.length ? Math.round(beatFrames[i + 1]) : Math.min(rms.length, a + Math.round(period));
    let e = 0;
    for (let f = a; f < b; f++) e += rms[f];
    beatEnergy[i] = e / Math.max(1, b - a);
    beatAccent[i] = sample(onset, Math.round(a));
  }
  normalizeToPercentile(beatEnergy, 0.95);
  normalizeToPercentile(beatAccent, 0.95);

  // Kick envelope with a fast attack and ~150 ms release, for beat-reactive visuals.
  const pulse = new Float32Array(frames);
  const release = Math.exp(-1 / (0.15 * fps));
  let level = 0;
  for (let f = 0; f < frames; f++) {
    level = Math.max(lowOnset[f], level * release);
    pulse[f] = level;
  }
  normalizeToPercentile(pulse, 0.98);

  // Waveform peaks for the timeline, 100 per second, from the full-rate signal.
  const peaksRate = 100;
  const bucket = sampleRate / peaksRate;
  const peaks = new Float32Array(Math.ceil(samples.length / bucket));
  for (let i = 0; i < peaks.length; i++) {
    let m = 0;
    const end = Math.min(samples.length, Math.floor((i + 1) * bucket));
    for (let k = Math.floor(i * bucket); k < end; k++) {
      const v = Math.abs(samples[k]);
      if (v > m) m = v;
    }
    peaks[i] = m;
  }

  return {
    bpm,
    period: period / fps,
    confidence,
    beats,
    downbeat,
    beatEnergy,
    beatAccent,
    pulse,
    pulseRate: fps,
    peaks,
    peaksRate,
    duration: samples.length / sampleRate,
  };
}

function spectralFlux(x, sr, frames) {
  const win = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const binHz = sr / FRAME;
  const maxBin = Math.min(FRAME / 2, Math.round(8000 / binHz));
  const lowBin = Math.max(2, Math.round(160 / binHz));
  let prev = new Float64Array(maxBin);
  let cur = new Float64Array(maxBin);
  const flux = new Float32Array(frames);
  const low = new Float32Array(frames);
  const lowEnergy = new Float32Array(frames);
  const rms = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < FRAME; i++) {
      const v = x[off + i] ?? 0;
      e += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    rms[f] = Math.sqrt(e / FRAME);
    fft(re, im);
    let fl = 0;
    let lo = 0;
    let le = 0;
    for (let b = 1; b < maxBin; b++) {
      const mag = Math.hypot(re[b], im[b]);
      if (b < lowBin) le += mag * mag;
      cur[b] = Math.log1p(100 * mag);
      const d = cur[b] - prev[b];
      if (d > 0) {
        fl += d;
        if (b < lowBin) lo += d;
      }
    }
    lowEnergy[f] = le;
    if (f > 0) {
      flux[f] = fl;
      low[f] = lo;
    }
    [prev, cur] = [cur, prev];
  }
  return { flux, low, lowEnergy, rms };
}

// Remove the slowly varying part, keep positive excursions, scale to unit std.
function normalizeOnset(signal, radius) {
  const n = signal.length;
  const out = new Float32Array(n);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + signal[i];
  let sq = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - radius);
    const b = Math.min(n, i + radius + 1);
    const v = Math.max(0, signal[i] - (prefix[b] - prefix[a]) / (b - a));
    out[i] = v;
    sq += v * v;
  }
  const std = Math.sqrt(sq / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] /= std;
  return out;
}

function estimateTempo(onset, fps, bpmHint) {
  const minLag = Math.max(2, Math.floor((60 * fps) / 240));
  const maxLag = Math.min(onset.length - 1, Math.ceil((60 * fps) / 45));
  const acMax = Math.min(onset.length - 1, 4 * maxLag + 2);
  const ac = new Float64Array(acMax + 2);
  for (let lag = 1; lag <= acMax; lag++) {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    ac[lag] = s / (onset.length - lag);
  }
  let bestLag = minLag;
  let bestScore = -Infinity;
  let mean = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.log2(bpm / bpmHint) ** 2);
    // Comb over multiples of the lag: a real beat period also repeats at 2×, 3×, 4×,
    // which rules out the off-beat (½×) and 3/2× aliases that a single lag can't.
    let comb = 0;
    let weight = 0;
    for (let m = 1; m <= 4; m++) {
      if (m * lag > acMax) break;
      comb += acAt(ac, m * lag) / m;
      weight += 1 / m;
    }
    const score = (comb / weight) * prior;
    mean += ac[lag];
    if (score > bestScore) (bestScore = score), (bestLag = lag);
  }
  mean /= maxLag - minLag + 1;
  // Parabolic interpolation for sub-frame period.
  const [a, b, c] = [ac[bestLag - 1], ac[bestLag], ac[bestLag + 1]];
  const denom = a - 2 * b + c;
  const shift = denom ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  return { period: bestLag + shift, confidence: mean > 0 ? Math.min(1, (b / mean - 1) / 4) : 0 };
}

// Linear interpolation between autocorrelation bins, so multiples of a lag stay accurate.
function acAt(ac, lag) {
  const i = Math.floor(lag);
  return ac[i] + (ac[i + 1] - ac[i]) * (lag - i);
}

function trackBeats(onset, period) {
  const n = onset.length;
  // Smooth the onset envelope with a gaussian ~period/32 wide.
  const sigma = Math.max(1, period / 32);
  const radius = Math.ceil(3 * sigma);
  const local = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j >= 0 && j < n) s += onset[j] * Math.exp(-0.5 * (k / sigma) ** 2);
    }
    local[i] = s;
  }

  const tightness = 100;
  const cum = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(2 * period);
  const hi = Math.max(1, Math.round(period / 2));
  for (let i = 0; i < n; i++) {
    let best = -Infinity;
    let arg = -1;
    for (let tau = i - lo; tau <= i - hi; tau++) {
      if (tau < 0) continue;
      const score = cum[tau] - tightness * Math.log((i - tau) / period) ** 2;
      if (score > best) (best = score), (arg = tau);
    }
    cum[i] = local[i] + (arg >= 0 ? best : 0);
    back[i] = arg;
  }

  // Last beat: the final local maximum of the cumulative score above half the median peak.
  const maxima = [];
  for (let i = 1; i < n - 1; i++) if (cum[i] > cum[i - 1] && cum[i] >= cum[i + 1]) maxima.push(i);
  if (!maxima.length) return [];
  const sorted = maxima.map((i) => cum[i]).sort((p, q) => p - q);
  const threshold = 0.5 * sorted[Math.floor(sorted.length / 2)];
  let last = maxima[maxima.length - 1];
  for (let k = maxima.length - 1; k >= 0; k--) {
    if (cum[maxima[k]] >= threshold) {
      last = maxima[k];
      break;
    }
  }

  const beats = [];
  for (let i = last; i >= 0; i = back[i]) beats.push(i);
  beats.reverse();

  // Trim weak leading/trailing beats (silence or fades).
  const strength = beats.map((b) => local[b]);
  const rmsStrength = Math.sqrt(strength.reduce((s, v) => s + v * v, 0) / Math.max(1, strength.length));
  let start = 0;
  let end = beats.length;
  while (start < end && strength[start] < 0.5 * rmsStrength) start++;
  while (end > start && strength[end - 1] < 0.5 * rmsStrength) end--;
  // The DP can stretch or squash the first/last few beats where the signal starts or runs out.
  const off = (a, b) => Math.abs(beats[b] - beats[a] - period) > 0.15 * period;
  // Walk out from the middle and cut at the first irregular interval near either end.
  const mid = Math.floor((start + end) / 2);
  const edge = 8;
  for (let i = Math.max(mid, end - 1 - edge); i < end - 1; i++) {
    if (off(i, i + 1)) {
      end = i + 1;
      break;
    }
  }
  for (let i = Math.min(mid, start + edge); i > start; i--) {
    if (off(i - 1, i)) {
      start = i;
      break;
    }
  }
  // Sub-frame precision: parabolic peak of the smoothed onset around each beat frame.
  return beats.slice(start, end).map((f) => {
    if (f <= 0 || f >= n - 1) return f;
    const [a, b, c] = [local[f - 1], local[f], local[f + 1]];
    const denom = a - 2 * b + c;
    return denom < 0 ? f + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : f;
  });
}

function normalizeToPercentile(arr, p) {
  if (!arr.length) return;
  const sorted = Float32Array.from(arr).sort();
  const ref = sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] || 1;
  for (let i = 0; i < arr.length; i++) arr[i] = Math.min(1, arr[i] / ref);
}

// In-place iterative radix-2 FFT.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}
