import * as THREE from 'three';

// Every Mixamo rig shares the same "mixamorig" bone names, so clips from one
// character can drive any other. This pools clips and adapts them per target.
// Clips can carry a licence restriction: Ready Player Me animations may only drive RPM avatars.
const DANCE = /danc|samba|hip.?hop|salsa|twerk|shuffle|break|groove|robot|swing|tut|thriller|gangnam|macarena|rumba|tango|jazz|b-?boy|cheer|party|bounce|step|wave|house|krump|vogue/i;

export const licensedFor = (sourceDef, targetDef) => !sourceDef.rpmOnly || targetDef.family === 'rpm';
export class AnimationLibrary {
  constructor() {
    this.entries = new Map();
    this.adapted = new Map();
  }

  register(asset) {
    const added = [];
    for (const clip of asset.animations) {
      if (!clip.tracks.length) continue;
      let name = clip.name;
      const existing = this.entries.get(name);
      if (existing) {
        if (existing.asset === asset) continue;
        name = `${clip.name} · ${asset.def.name}`;
        if (this.entries.has(name)) continue;
      }
      const dance = asset.def.dance ?? (DANCE.test(clip.name) || asset.def.upload === true);
      this.entries.set(name, { name, clip, asset, dance });
      added.push(name);
    }
    return added;
  }

  entry(name) {
    return this.entries.get(name);
  }

  list(target) {
    return [...this.entries.values()].map((e) => ({
      name: e.name,
      source: e.asset.def.name,
      dance: e.dance,
      duration: e.clip.duration,
      native: e.asset === target,
      compatible: target ? (this.clipFor(e.name, target)?.tracks.length ?? 0) > 0 : false,
    }));
  }

  clipFor(name, target) {
    const entry = this.entries.get(name);
    if (!entry) return null;
    if (entry.asset === target) return entry.clip;
    if (!licensedFor(entry.asset.def, target.def)) return null;

    const key = `${name}|${target.def.url}`;
    if (this.adapted.has(key)) return this.adapted.get(key);

    const src = entry.asset.rig;
    const tgt = target.rig;
    const tracks = [];
    // Same skeleton family (e.g. RPM animation → RPM avatar): the clip already fits, use it as is.
    if (entry.asset.def.family && entry.asset.def.family === target.def.family) {
      for (const track of entry.clip.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        if (target.nodeNames.has(nodeName) && propertyName !== 'scale') tracks.push(track);
      }
      const clip = new THREE.AnimationClip(name, entry.clip.duration, tracks);
      this.adapted.set(key, clip);
      return clip;
    }
    for (const track of entry.clip.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
      if (!target.nodeNames.has(nodeName) || propertyName === 'scale') continue;
      if (propertyName === 'position') {
        // Only the hips carry translation; convert it into the target's space and leg length.
        if (!src || !tgt || nodeName !== tgt.hipsName || Math.abs(src.height) < 1e-6) continue;
        const m = new THREE.Matrix3()
          .multiplyMatrices(tgt.parentLinearInv, src.parentLinear)
          .multiplyScalar(tgt.height / src.height);
        tracks.push(transformVectors(track, m));
      } else if (propertyName === 'quaternion' && src?.rest.has(nodeName) && tgt?.rest.has(nodeName)) {
        // Rest-pose retarget: target = Pt⁻¹·Ps · q · Ws⁻¹·Wt, where P/W are the bone's
        // parent and own world rotations at rest. Identity when the rigs agree.
        const s = src.rest.get(nodeName);
        const t = tgt.rest.get(nodeName);
        const pre = t.parent.clone().invert().multiply(s.parent);
        const post = s.world.clone().invert().multiply(t.world);
        tracks.push(transformQuaternions(track, pre, post));
      } else {
        tracks.push(track);
      }
    }

    const clip = new THREE.AnimationClip(name, entry.clip.duration, tracks);
    this.adapted.set(key, clip);
    return clip;
  }
}

function transformVectors(track, matrix) {
  const out = track.clone();
  const v = new THREE.Vector3();
  for (let i = 0; i < out.values.length; i += 3) {
    v.fromArray(out.values, i).applyMatrix3(matrix).toArray(out.values, i);
  }
  return out;
}

function transformQuaternions(track, pre, post) {
  const identity = new THREE.Quaternion();
  if (pre.angleTo(identity) < 1e-4 && post.angleTo(identity) < 1e-4) return track;
  const out = track.clone();
  const q = new THREE.Quaternion();
  for (let i = 0; i < out.values.length; i += 4) {
    q.fromArray(out.values, i).premultiply(pre).multiply(post).toArray(out.values, i);
  }
  return out;
}
