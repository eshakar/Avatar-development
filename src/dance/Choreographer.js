import * as THREE from 'three';
import { blendPose, smoothstep } from './CharacterRig.js';

export const DEFAULT_DANCE = {
  phraseBeats: 8,
  seed: 1,
  variety: 0.5,
  energyFollow: 0.8,
  mocapFirst: true,
  accent: 0.25,
  blendBeats: 1,
  // 0..1: averages the pose over ±25 ms, rounding off any hard corners in motion or blends.
  smoothness: 0.5,
  // Prefer clips whose own tempo suits the song, so mocap plays close to its natural speed.
  naturalSpeed: true,
  overrides: {},
  disabled: [],
};

const bounce = (u) => (0.5 + 0.5 * Math.cos(2 * Math.PI * u)) ** 1.5;

function rng(seed) {
  let s = (seed * 9301 + 49297) % 233280 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// Splits the song into phrases (aligned to downbeats), picks a move for each one by matching the
// move's energy to the music's, then evaluates the dance at any time t by mapping t → beats.
export class Choreographer {
  constructor(rig) {
    this.rig = rig;
    this.moves = [];
    this.grid = null;
    this.options = { ...DEFAULT_DANCE };
    this.segments = [];
    this.poseA = rig.createPose();
    this.poseB = rig.createPose();
    this.pose = rig.createPose();
    this.out = rig.createPose();
    this.sA = rig.createPose();
    this.sB = rig.createPose();
    this._dip = new THREE.Vector3();
  }

  setMoves(moves) {
    this.moves = moves.filter((m) => m.valid);
    // Mocap energy is measured in rad/s; rank clips onto 0.35..1 so they share a scale with procedural moves.
    const mocap = this.moves.filter((m) => m.kind === 'mocap').sort((a, b) => a.energy - b.energy);
    mocap.forEach((m, i) => (m.energyLevel = 0.35 + (0.65 * (i + 1)) / mocap.length));
    this.rebuild();
  }

  setGrid(grid) {
    this.grid = grid;
    this.rebuild();
  }

  setOptions(patch) {
    Object.assign(this.options, patch);
    this.rebuild();
  }

  moveById(id) {
    return this.moves.find((m) => m.id === id);
  }

  rebuild() {
    const g = this.grid;
    const o = this.options;
    this.segments = [];
    if (!g || !this.moves.length) return this.segments;

    const pool = this.moves.filter((m) => !o.disabled.includes(m.id));
    const choices = pool.length ? pool : this.moves;
    const calm = [...this.moves].sort((a, b) => a.energyLevel - b.energyLevel)[0];
    const random = rng(o.seed);
    const P = o.phraseBeats;

    const phrases = [];
    for (let start = g.downbeat; start <= g.lastBeat; start += P) {
      let e = 0;
      for (let b = start; b < start + P; b++) e += g.energy(b);
      phrases.push({ start, end: start + P, energy: e / P });
    }
    const es = phrases.map((p) => p.energy);
    const lo = Math.min(...es);
    const hi = Math.max(...es);

    const uses = new Map();
    const recent = [];
    // Clip beats per music beat: ½, 1 or 2, whichever keeps playback closest to the clip's own speed.
    const rateFor = (m) => {
      const ratio = m.period / g.period;
      return [0.5, 1, 2].reduce((best, r) => (Math.abs(Math.log(r * ratio)) < Math.abs(Math.log(best * ratio)) ? r : best), 1);
    };
    const speedCost = (m) => (m.kind === 'mocap' ? Math.abs(Math.log((rateFor(m) * m.period) / g.period)) : 0);
    const push = (seg) => {
      const m = seg.move;
      if (m.kind === 'mocap') {
        seg.rate = rateFor(m);
        // A clip that comes back later continues where it left off.
        seg.offset = uses.get(m.id) ?? 0;
        uses.set(m.id, (seg.offset + (seg.end - seg.start) * seg.rate) % m.beats);
      } else {
        seg.rate = 1;
        seg.offset = 0;
      }
      this.segments.push(seg);
    };

    push({ index: -1, start: -Infinity, end: phrases[0]?.start ?? Infinity, move: calm, energy: 0, intro: true });

    phrases.forEach((ph, i) => {
      const target = hi > lo ? 0.12 + 0.88 * ((ph.energy - lo) / (hi - lo)) : 0.6;
      const override = this.moveById(o.overrides[i]);
      let move = override;
      if (!move) {
        let best = -Infinity;
        for (const m of choices) {
          let score = -o.energyFollow * 2.5 * Math.abs(m.energyLevel - target) + o.variety * 1.6 * random();
          if (o.mocapFirst && m.kind === 'mocap') score += 0.45;
          // A clip at 125% or 62% speed looks sped-up / slow-motion; prefer ones near 100%.
          if (o.naturalSpeed) score -= 2.2 * speedCost(m);
          if (m === recent[recent.length - 1]) score -= 3;
          else if (recent.includes(m)) score -= 0.7;
          if (score > best) (best = score), (move = m);
        }
      } else random();
      recent.push(move);
      if (recent.length > 3) recent.shift();
      push({ index: i, start: ph.start, end: i === phrases.length - 1 ? ph.end : phrases[i + 1].start, move, energy: target, overridden: !!override });
    });

    const lastEnd = this.segments[this.segments.length - 1].end;
    if (Number.isFinite(lastEnd)) push({ index: -2, start: lastEnd, end: Infinity, move: calm, energy: 0, outro: true });
    return this.segments;
  }

  segmentAt(beat) {
    const segs = this.segments;
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].start <= beat) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  #sample(seg, beat, pose) {
    const local = (beat - (Number.isFinite(seg.start) ? seg.start : 0)) * seg.rate + seg.offset;
    return seg.move.sample(local, pose);
  }

  // Poses the rig for time t; returns the active segment.
  evaluate(t) {
    const g = this.grid;
    if (!g || !this.segments.length) return null;
    const { seg, beat } = this.#poseAt(t, this.out);
    const s = this.options.smoothness;
    if (s > 0) {
      // Small symmetric kernel (weights ⅙, ⅔, ⅙): still a pure function of t, so export stays exact.
      const d = 0.05 * s;
      this.#poseAt(t - d, this.sA);
      this.#poseAt(t + d, this.sB);
      blendPose(this.sA, this.sA, this.sB, 0.5);
      blendPose(this.out, this.out, this.sA, 1 / 3);
    }

    // Groove accent on mocap: a small hip dip on every beat, scaled by how hard that beat hits.
    // The knees take it (foot IK), so feet stay planted.
    this._dip.set(0, 0, 0);
    if (this.options.accent > 0 && seg.move.kind === 'mocap') {
      const u = beat - Math.floor(beat);
      this._dip.y = -this.options.accent * 0.03 * this.rig.legLength * bounce(u) * (0.5 + 0.5 * g.accent(beat));
    }
    this.rig.applyPlanted(this.out, this._dip);
    return seg;
  }

  #poseAt(t, out) {
    const g = this.grid;
    const beat = g.beatAt(t);
    const i = this.segmentAt(beat);
    const seg = this.segments[i];
    const half = this.options.blendBeats / 2;
    const prev = this.segments[i - 1];
    const next = this.segments[i + 1];

    let pose = this.#sample(seg, beat, this.poseA);
    if (prev && beat - seg.start < half) {
      this.#sample(prev, beat, this.poseB);
      pose = blendPose(this.pose, this.poseB, pose, smoothstep(0.5 + (beat - seg.start) / (2 * half)));
    } else if (next && seg.end - beat < half) {
      this.#sample(next, beat, this.poseB);
      pose = blendPose(this.pose, pose, this.poseB, smoothstep(0.5 - (seg.end - beat) / (2 * half)));
    }

    out.q.set(pose.q);
    out.p.set(pose.p);
    return { seg, beat };
  }
}
