// Maps between seconds on the project timeline and musical beats. Beat 0 is the first detected beat;
// the grid is extrapolated with the median period before and after, so every time has a beat position.
export class BeatGrid {
  constructor({ beats, downbeat = 0, beatEnergy, beatAccent, pulse, pulseRate = 1, peaks, peaksRate = 100, offset = 0, duration }) {
    const detected = beats.length >= 2 ? Array.from(beats) : [0, 0.5];
    const intervals = detected.slice(1).map((t, i) => t - detected[i]).sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    this.period = fitPeriod(detected, median);
    this.bpm = 60 / this.period;
    this.offset = offset;
    this.duration = duration;
    this.count = detected.length;
    this.downbeat = ((downbeat % 4) + 4) % 4;
    this.beatEnergy = beatEnergy ?? energyFromPeaks(detected, peaks, peaksRate, this.period);
    this.beatAccent = beatAccent ?? new Float32Array(detected.length).fill(0.6);
    this.pulse = pulse;
    this.pulseRate = pulseRate;
    this.peaks = peaks;
    this.peaksRate = peaksRate;

    // Detected beats wobble by a few ms; a time-warped dance would speed up and slow down with every wobble.
    // A rolling least-squares fit (±4 beats) keeps real tempo changes but irons out the jitter.
    const times = smoothBeats(detected);
    let base = 0;
    while (times[0] > -this.period) {
      times.unshift(times[0] - this.period);
      base++;
    }
    while (times[times.length - 1] < duration + this.period * 8) times.push(times[times.length - 1] + this.period);
    this.times = Float64Array.from(times, (t) => t + offset);
    this.base = base;
  }

  // Fractional beat index at time t.
  beatAt(t) {
    const times = this.times;
    if (t <= times[0]) return -this.base + (t - times[0]) / this.period;
    const last = times.length - 1;
    if (t >= times[last]) return last - this.base + (t - times[last]) / this.period;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo - this.base + (t - times[lo]) / (times[lo + 1] - times[lo]);
  }

  timeAt(beat) {
    const j = beat + this.base;
    const times = this.times;
    if (j <= 0) return times[0] + j * this.period;
    const last = times.length - 1;
    if (j >= last) return times[last] + (j - last) * this.period;
    const i = Math.floor(j);
    return times[i] + (times[i + 1] - times[i]) * (j - i);
  }

  isDownbeat(i) {
    return (((i - this.downbeat) % 4) + 4) % 4 === 0;
  }

  // Beat index within the bar, 0 = downbeat.
  beatInBar(i) {
    return (((Math.floor(i) - this.downbeat) % 4) + 4) % 4;
  }

  bar(beat) {
    return Math.floor((beat - this.downbeat) / 4);
  }

  energy(i) {
    const k = Math.floor(i);
    return k >= 0 && k < this.count ? this.beatEnergy[k] : 0;
  }

  accent(i) {
    const k = Math.floor(i);
    return k >= 0 && k < this.count ? this.beatAccent[k] : 0;
  }

  // Kick envelope (0..1) at time t, for beat-reactive visuals.
  pulseAt(t) {
    if (!this.pulse) return 0;
    const f = (t - this.offset) * this.pulseRate;
    const i = Math.floor(f);
    if (i < 0 || i >= this.pulse.length - 1) return 0;
    return this.pulse[i] + (this.pulse[i + 1] - this.pulse[i]) * (f - i);
  }

  // Last detected beat, used to end the choreography.
  get lastBeat() {
    return this.count - 1;
  }

  static manual({ bpm, firstBeat = 0, downbeat = 0, duration, offset = 0, pulse, pulseRate, peaks, peaksRate }) {
    const period = 60 / bpm;
    const beats = [];
    for (let t = firstBeat; t < duration; t += period) beats.push(t);
    return new BeatGrid({ beats, downbeat, offset, duration, pulse, pulseRate, peaks, peaksRate });
  }
}

// Fallback loudness per beat (for a manual grid) from the waveform peaks.
function energyFromPeaks(beats, peaks, peaksRate, period) {
  const out = new Float32Array(beats.length).fill(0.6);
  if (!peaks?.length) return out;
  let max = 1e-6;
  beats.forEach((t, i) => {
    const a = Math.max(0, Math.floor(t * peaksRate));
    const b = Math.min(peaks.length, Math.floor((beats[i + 1] ?? t + period) * peaksRate));
    let s = 0;
    for (let k = a; k < b; k++) s += peaks[k];
    out[i] = b > a ? s / (b - a) : 0;
    max = Math.max(max, out[i]);
  });
  for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

// Least-squares slope of beat time vs. beat index: steadier than any single interval.
function fitPeriod(beats, fallback) {
  const n = beats.length;
  if (n < 8) return fallback;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  beats.forEach((t, i) => ((sx += i), (sy += t), (sxx += i * i), (sxy += i * t)));
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  // Fall back to the median if the tempo drifts a lot (live recordings).
  return Math.abs(slope - fallback) < 0.03 * fallback ? slope : fallback;
}

function smoothBeats(beats, radius = 4) {
  const n = beats.length;
  if (n < 2 * radius + 1) return [...beats];
  return beats.map((_, i) => {
    const a = Math.max(0, i - radius);
    const b = Math.min(n - 1, i + radius);
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    const m = b - a + 1;
    for (let k = a; k <= b; k++) ((sx += k), (sy += beats[k]), (sxx += k * k), (sxy += k * beats[k]));
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    const fitted = (sy - slope * sx) / m + slope * i;
    // Never move a beat by more than 12 ms: the hits must stay where the music is.
    return beats[i] + Math.max(-0.012, Math.min(0.012, fitted - beats[i]));
  });
}
