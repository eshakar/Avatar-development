import * as THREE from 'three';
import { blendPose, canonicalBone, smoothstep } from './CharacterRig.js';

const RATE = 60;
const FINGER = /(Thumb|Index|Middle|Ring|Pinky)\d/;
const _a = new THREE.Quaternion();
const _b = new THREE.Quaternion();
const _v = new THREE.Vector3();

// The bone each canonical bone points at, used to line up rest poses (T-pose vs A-pose) when retargeting.
function childOf(canon) {
  const finger = canon.match(/^(.*Hand(?:Thumb|Index|Middle|Ring|Pinky))([12])$/);
  if (finger) return `${finger[1]}${+finger[2] + 1}`;
  const side = canon.match(/^(Left|Right)(.*)$/);
  if (side) {
    const next = { Shoulder: 'Arm', Arm: 'ForeArm', ForeArm: 'Hand', Hand: 'HandMiddle1', UpLeg: 'Leg', Leg: 'Foot', Foot: 'ToeBase' }[side[2]];
    return next ? side[1] + next : null;
  }
  return { Hips: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head' }[canon] ?? null;
}

// A mocap clip as a beat-addressable move.
// When the clip was made for a different skeleton (e.g. Mixamo → Reallusion CC3), pass `sourceRig`: the clip is
// evaluated on its own rig and each bone's world rotation is transferred, corrected for rest-pose differences. On load we find the clip's own rhythm (motion beats:
// periodic minima of joint speed, where a dancer "hits" a pose) so that later we can play
// "clip beat k" exactly on "music beat k" — the clip is time-warped beat by beat onto the song.
export class ClipMove {
  constructor(clip, rig, meta, sourceRig = null) {
    this.id = meta.id;
    this.name = meta.name;
    this.source = meta.source;
    this.kind = 'mocap';
    this.rig = rig;
    this.duration = clip.duration;
    this.channels = [];
    this.hipsTrack = null;
    this.sourceRig = sourceRig;
    const bindRig = sourceRig ?? rig;
    this.bindRig = bindRig;

    for (const track of clip.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
      const bone = bindRig.boneIndex(nodeName);
      if (bone === undefined) continue;
      if (propertyName === 'quaternion') {
        this.channels.push({ bone, interp: track.createInterpolant(), finger: FINGER.test(canonicalBone(nodeName)) });
      } else if (propertyName === 'position' && bone === bindRig.hips) {
        this.hipsTrack = track.createInterpolant();
      }
    }

    this.#centerRootMotion();
    this.#analyzeRhythm();
    this.poseA = rig.createPose();
    this.poseB = rig.createPose();
    if (sourceRig) this.#prepareRetarget(sourceRig, rig);
  }

  #prepareRetarget(S, T) {
    this.srcPose = S.createPose();
    this.srcWorld = S.bones.map(() => new THREE.Quaternion());
    this.targets = new Map();
    this.map = [];
    for (const [canon, t] of T.byCanon) {
      const s = S.byCanon.get(canon);
      if (s === undefined) continue;
      // corr = Ws⁻¹ · R · Wt, with R turning the target's rest bone direction onto the source's.
      const R = new THREE.Quaternion();
      const child = childOf(canon);
      const sc = child && S.byCanon.get(child);
      const tc = child && T.byCanon.get(child);
      if (sc !== undefined && tc !== undefined && sc !== null && tc !== null) {
        const dS = S.restWorldP[sc].clone().sub(S.restWorldP[s]).normalize();
        const dT = T.restWorldP[tc].clone().sub(T.restWorldP[t]).normalize();
        if (dS.lengthSq() > 0 && dT.lengthSq() > 0) R.setFromUnitVectors(dT, dS);
      }
      const corr = S.restWorldQ[s].clone().invert().multiply(R).multiply(T.restWorldQ[t]);
      this.map.push({ s, t, corr, out: new THREE.Quaternion() });
    }
    this.hipsToChar = S.charToHipsParent.clone().invert();
    this.legScale = T.legLength / S.legLength;
  }

  #retarget(src, pose) {
    const S = this.sourceRig;
    const T = this.rig;
    const world = this.srcWorld;
    for (let i = 0; i < S.bones.length; i++) {
      const p = S.parent[i];
      world[i].fromArray(src.q, i * 4).premultiply(p >= 0 ? world[p] : S.anchorQ[i]);
    }
    this.targets.clear();
    for (const m of this.map) this.targets.set(m.t, m.out.multiplyQuaternions(world[m.s], m.corr));
    T.resetPose(pose);
    _v.set(src.p[0] - S.restHipsP[0], src.p[1] - S.restHipsP[1], src.p[2] - S.restHipsP[2])
      .applyMatrix3(this.hipsToChar)
      .multiplyScalar(this.legScale);
    T.setHipsOffset(pose, _v);
    T.solve(this.targets, pose);
  }

  get valid() {
    return this.channels.length > 0;
  }

  // Keep the dancer on the spot: remove the clip's average horizontal drift but keep bounce and steps.
  #centerRootMotion() {
    this.hipsShift = [0, 0, 0];
    if (!this.hipsTrack) return;
    const up = new THREE.Vector3(0, 1, 0).applyMatrix3(this.bindRig.charToHipsParent).normalize();
    const mean = new THREE.Vector3();
    const steps = Math.max(2, Math.ceil(this.duration * 30));
    for (let i = 0; i < steps; i++) mean.add(new THREE.Vector3().fromArray(this.hipsTrack.evaluate((i / (steps - 1)) * this.duration)));
    mean.divideScalar(steps).sub(new THREE.Vector3().fromArray(this.bindRig.restHipsP));
    mean.addScaledVector(up, -mean.dot(up));
    this.hipsShift = mean.toArray();
  }

  #analyzeRhythm() {
    const frames = Math.max(8, Math.floor(this.duration * RATE));
    const speed = new Float32Array(frames);
    const prev = this.channels.map((c) => _a.fromArray(c.interp.evaluate(0)).clone());
    for (let f = 1; f < frames; f++) {
      const t = f / RATE;
      let s = 0;
      this.channels.forEach((c, i) => {
        if (c.finger) return;
        _b.fromArray(c.interp.evaluate(t));
        s += prev[i].angleTo(_b);
        prev[i].copy(_b);
      });
      speed[f] = s * RATE;
    }
    speed[0] = speed[1];
    this.energy = speed.reduce((a, v) => a + v, 0) / frames;

    // Period: autocorrelation over 0.3–1.2 s with a prior around 0.5 s (120 BPM).
    const mean = this.energy;
    const centered = Float32Array.from(speed, (v) => v - mean);
    let bestLag = Math.round(0.5 * RATE);
    let best = -Infinity;
    const ac = (lag) => {
      let s = 0;
      for (let i = lag; i < frames; i++) s += centered[i] * centered[i - lag];
      return s / (frames - lag);
    };
    for (let lag = Math.round(0.3 * RATE); lag <= Math.min(Math.round(1.2 * RATE), frames - 4); lag++) {
      const prior = Math.exp(-0.5 * (Math.log2(lag / RATE / 0.5) / 0.7) ** 2);
      const score = ac(lag) * prior;
      if (score > best) (best = score), (bestLag = lag);
    }
    const period = bestLag / RATE;

    // Phase: fold the speed curve over one period and take its minimum.
    const bins = 24;
    const fold = new Float32Array(bins);
    const count = new Float32Array(bins);
    for (let f = 0; f < frames; f++) {
      const k = Math.floor((((f / RATE) % period) / period) * bins);
      fold[k] += speed[f];
      count[k]++;
    }
    let minBin = 0;
    for (let k = 1; k < bins; k++) if (fold[k] / count[k] < fold[minBin] / count[minBin]) minBin = k;

    this.period = period;
    this.phase = ((minBin + 0.5) / bins) * period;
    const total = Math.max(1, Math.floor((this.duration - this.phase - 1 / RATE) / period));
    this.bpm = 60 / period;

    // Most clips start and end in a still "ready" stance; loop only the part where the dance happens.
    const beatSpeed = (k) => {
      const a = Math.floor((this.phase + k * period) * RATE);
      const b = Math.min(frames, Math.floor((this.phase + (k + 1) * period) * RATE));
      let s = 0;
      for (let f = a; f < b; f++) s += speed[f];
      return s / Math.max(1, b - a);
    };
    let first = 0;
    let last = total - 1;
    while (first < last && beatSpeed(first) < 0.55 * mean) first++;
    while (last > first && beatSpeed(last) < 0.55 * mean) last--;
    if (last - first + 1 < 4) (first = 0), (last = total - 1);
    this.firstBeat = first;
    this.beats = last - first + 1;
  }

  #sampleAt(time, pose) {
    if (this.sourceRig) {
      this.#sampleRaw(time, this.srcPose);
      this.#retarget(this.srcPose, pose);
      return;
    }
    this.#sampleRaw(time, pose);
  }

  #sampleRaw(time, pose) {
    this.bindRig.resetPose(pose);
    for (const c of this.channels) pose.q.set(c.interp.evaluate(time), c.bone * 4);
    if (this.hipsTrack) {
      const v = this.hipsTrack.evaluate(time);
      pose.p[0] = v[0] - this.hipsShift[0];
      pose.p[1] = v[1] - this.hipsShift[1];
      pose.p[2] = v[2] - this.hipsShift[2];
    }
  }

  // Pose at a position measured in the clip's own beats; loops with a half-beat crossfade.
  sample(beat, pose) {
    const n = this.beats;
    const m = ((beat % n) + n) % n;
    const start = this.phase + this.firstBeat * this.period;
    const time = start + m * this.period;
    const fade = Math.min(0.5, n / 4);
    if (m <= n - fade) {
      this.#sampleAt(time, pose);
      return pose;
    }
    this.#sampleAt(time, this.poseA);
    this.#sampleAt(Math.max(0, start + (m - n) * this.period), this.poseB);
    return blendPose(pose, this.poseA, this.poseB, smoothstep((m - (n - fade)) / fade));
  }
}
