import * as THREE from 'three';

// Reallusion CC3/ActorCore → Mixamo-style names. Twist/share/pelvis bones have no Mixamo
// equivalent and keep their own names (they just follow their parents).
const CC3 = {
  Hip: 'Hips', Waist: 'Spine', Spine01: 'Spine1', Spine02: 'Spine2', NeckTwist01: 'Neck', Head: 'Head',
  Clavicle: 'Shoulder', Upperarm: 'Arm', Forearm: 'ForeArm', Hand: 'Hand',
  Thigh: 'UpLeg', Calf: 'Leg', Foot: 'Foot', ToeBase: 'ToeBase',
  Thumb: 'HandThumb', Index: 'HandIndex', Mid: 'HandMiddle', Ring: 'HandRing', Pinky: 'HandPinky',
};

function cc3Canonical(name) {
  const m = name.match(/^CC_Base_(?:([LR])_)?([A-Za-z]+?)(0\d|\d)?$/);
  if (!m) return name;
  const [, side, base, num = ''] = m;
  const key = CC3[base + num] ? base + num : base;
  const mapped = CC3[key];
  if (!mapped) return name;
  const digits = CC3[base + num] ? '' : num;
  const prefix = side === 'L' ? 'Left' : side === 'R' ? 'Right' : '';
  // Clavicle → LeftShoulder, Thigh → LeftUpLeg, Index1 → LeftHandIndex1 …
  return `${prefix}${mapped}${digits}`;
}

// Mixamo bones are "mixamorig:Hips" / "mixamorigHips"; Ready Player Me uses plain "Hips";
// Reallusion CC3 uses "CC_Base_Hip", "CC_Base_L_Upperarm" …
export const canonicalBone = (name) =>
  name.startsWith('CC_Base_') ? cc3Canonical(name) : name.replace(/^mixamorig[:_]?/i, '').replace(/^.*[:|]/, '');

// Which skeleton convention a model uses, so clips are only copied track-for-track between equal rigs.
export function skeletonKind(names) {
  for (const n of names) {
    if (n.startsWith('CC_Base_')) return 'cc3';
    if (/^mixamorig/i.test(n)) return 'mixamo';
  }
  for (const n of names) if (n === 'Hips') return 'rpm';
  return 'other';
}

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

// A skeleton as flat pose buffers (local quaternion per bone + hips position), so moves can be
// sampled, blended and applied without touching the scene graph until the final write.
export class CharacterRig {
  constructor(model, { rotationY = 0 } = {}) {
    model.updateMatrixWorld(true);
    const modelInv = model.matrixWorld.clone().invert();
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);

    const bones = [];
    model.traverse((o) => o.isBone && bones.push(o));
    this.bones = bones;
    const n = bones.length;
    this.index = new Map(bones.map((b, i) => [b.name, i]));
    this.sanitized = new Map(bones.map((b, i) => [THREE.PropertyBinding.sanitizeNodeName(b.name), i]));
    this.byCanon = new Map();
    bones.forEach((b, i) => {
      const c = canonicalBone(b.name);
      if (!this.byCanon.has(c)) this.byCanon.set(c, i);
    });

    this.parent = new Int16Array(n);
    this.restQ = new Float32Array(n * 4);
    this.restWorldQ = [];
    this.restWorldP = [];
    this.anchorQ = [];
    bones.forEach((b, i) => {
      this.parent[i] = b.parent?.isBone ? this.index.get(b.parent.name) ?? -1 : -1;
      b.quaternion.toArray(this.restQ, i * 4);
      _m.multiplyMatrices(modelInv, b.matrixWorld).decompose(_p, _q, _s);
      this.restWorldQ.push(yaw.clone().multiply(_q));
      this.restWorldP.push(_p.clone().applyQuaternion(yaw));
      // Root bones keep their (non-bone) parent's rest rotation.
      this.anchorQ.push(this.restWorldQ[i].clone().multiply(b.quaternion.clone().invert()));
    });

    const hipsIdx = this.byCanon.get('Hips') ?? bones.findIndex((b) => /hips$/i.test(b.name));
    this.hips = hipsIdx >= 0 ? hipsIdx : 0;
    const hipsBone = bones[this.hips];
    this.restHipsP = hipsBone ? hipsBone.position.toArray() : [0, 0, 0];
    // Converts a translation in character space (Y up, facing +Z) into the hips' parent space.
    const parentWorld = new THREE.Matrix4().multiplyMatrices(modelInv, hipsBone?.parent?.matrixWorld ?? new THREE.Matrix4());
    this.charToHipsParent = new THREE.Matrix3()
      .setFromMatrix4(parentWorld)
      .invert()
      .multiply(new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(yaw.clone().invert())));

    const pos = (name) => this.restWorldP[this.byCanon.get(name)];
    const upLeg = pos('LeftUpLeg');
    const leg = pos('LeftLeg');
    const foot = pos('LeftFoot');
    this.legLength = upLeg && leg && foot ? upLeg.distanceTo(leg) + leg.distanceTo(foot) : 1;

    this.pose = this.createPose();
    this._world = Array.from({ length: n }, () => new THREE.Quaternion());
    this._local = new THREE.Quaternion();
    this.model = model;
    const legChain = (s) => ['UpLeg', 'Leg', 'Foot'].map((b) => bones[this.byCanon.get(`${s}${b}`)]);
    this.legs = [legChain('Left'), legChain('Right')].filter((l) => l.every(Boolean));
    this._plant = this.legs.map(() => ({ ankle: new THREE.Vector3(), foot: new THREE.Quaternion() }));
  }

  // Applies a pose, then lowers/raises the hips by `offset` (character space) while two-bone IK keeps
  // the feet exactly where they were: the knees bend instead of the feet sinking into the floor.
  applyPlanted(pose, offset) {
    this.apply(pose);
    if (!this.legs.length || offset.lengthSq() === 0) return;
    this.model.updateMatrixWorld(true);
    this.legs.forEach(([, , foot], i) => {
      foot.getWorldPosition(this._plant[i].ankle);
      foot.getWorldQuaternion(this._plant[i].foot);
    });
    _p.copy(offset).applyMatrix3(this.charToHipsParent);
    const hips = this.bones[this.hips];
    hips.position.add(_p);
    hips.updateMatrixWorld(true);
    this.legs.forEach(([upper, lower, foot], i) => {
      twoBoneIK(upper, lower, foot, this._plant[i].ankle);
      setWorldQuaternion(foot, this._plant[i].foot);
    });
  }

  createPose() {
    return { q: Float32Array.from(this.restQ), p: Float32Array.from(this.restHipsP) };
  }

  resetPose(pose) {
    pose.q.set(this.restQ);
    pose.p.set(this.restHipsP);
  }

  boneIndex(name) {
    return this.index.get(name) ?? this.sanitized.get(name) ?? this.byCanon.get(canonicalBone(name));
  }

  // Overrides chosen bones with character-space world rotations; everything else keeps the
  // local rotation already in `pose` and inherits from its parent.
  solve(targets, pose) {
    const world = this._world;
    const local = this._local;
    for (let i = 0; i < this.bones.length; i++) {
      const p = this.parent[i];
      const parentWorld = p >= 0 ? world[p] : this.anchorQ[i];
      const target = targets.get(i);
      if (target) {
        world[i].copy(target);
        local.copy(parentWorld).invert().multiply(target).toArray(pose.q, i * 4);
      } else {
        local.fromArray(pose.q, i * 4);
        world[i].multiplyQuaternions(parentWorld, local);
      }
    }
  }

  // Character-space translation of the hips → local hips position.
  setHipsOffset(pose, offset) {
    _p.copy(offset).applyMatrix3(this.charToHipsParent);
    pose.p[0] = this.restHipsP[0] + _p.x;
    pose.p[1] = this.restHipsP[1] + _p.y;
    pose.p[2] = this.restHipsP[2] + _p.z;
  }

  apply(pose) {
    const bones = this.bones;
    for (let i = 0; i < bones.length; i++) bones[i].quaternion.fromArray(pose.q, i * 4);
    bones[this.hips]?.position.fromArray(pose.p);
  }
}

// out = slerp(a, b, w) for every bone, lerp for the hips position.
export function blendPose(out, a, b, w) {
  if (w <= 0) {
    if (out !== a) (out.q.set(a.q), out.p.set(a.p));
    return out;
  }
  if (w >= 1) {
    if (out !== b) (out.q.set(b.q), out.p.set(b.p));
    return out;
  }
  for (let i = 0; i < a.q.length; i += 4) THREE.Quaternion.slerpFlat(out.q, i, a.q, i, b.q, i, w);
  for (let i = 0; i < 3; i++) out.p[i] = a.p[i] + (b.p[i] - a.p[i]) * w;
  return out;
}

export const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

function setWorldQuaternion(bone, world) {
  bone.parent.getWorldQuaternion(_q1);
  bone.quaternion.copy(_q1.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

// Rotates `bone` (in world space) so that the direction `from` points along `to`.
function swingBone(bone, from, to) {
  _q2.setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(_q1);
  setWorldQuaternion(bone, _q2.multiply(_q1).clone());
}

// Analytic two-bone IK on live bones (hip→knee→ankle), bending in the leg's current plane.
export function twoBoneIK(upper, lower, end, target) {
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  const l1 = _a.distanceTo(_b);
  const l2 = _b.distanceTo(_c);
  _d.subVectors(target, _a);
  const d = Math.min(Math.max(_d.length(), 1e-4), (l1 + l2) * 0.9999);
  _d.normalize();
  // Bend direction: where the knee currently points, away from the hip→target line.
  _n.subVectors(_b, _a).addScaledVector(_d, -_d.dot(_n.subVectors(_b, _a)));
  if (_n.lengthSq() < 1e-10) _n.set(0, 0, 1);
  _n.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const knee = _a.clone().addScaledVector(_d, a).addScaledVector(_n, h);
  swingBone(upper, _b.clone().sub(_a), knee.clone().sub(_a));
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  swingBone(lower, _c.clone().sub(_b), target.clone().sub(_b));
}
