import * as THREE from 'three';

// Rig-independent dance moves, written as poses in "character space" (Y up, facing +Z, +X = the
// character's left). A tiny solver turns them into bone rotations: arms/torso by direction, legs by
// two-bone IK so the feet stay planted while the hips bounce. Every move is a pure function of the
// beat position, so it's on the beat by construction.

const V = (x, y, z) => new THREE.Vector3(x, y, z).normalize();
const frac = (x) => x - Math.floor(x);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
// 1 on the beat, 0 on the off-beat; a sharper cosine.
const bounce = (u) => (0.5 + 0.5 * Math.cos(2 * Math.PI * u)) ** 1.5;
const mid = (u) => Math.sin(Math.PI * clamp01(u)) ** 2;
const lerp = (a, b, w) => a + (b - a) * w;
const easeInOut = (x) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
// Moving between key poses the way people do: hold, then accelerate/decelerate so the new pose
// ARRIVES exactly on the next beat (instead of starting on it and landing late).
// Returns the key index we're leaving and the blend weight toward the next one.
function arrive(x, d = 0.35) {
  const k = Math.floor(x);
  return { k, w: easeInOut((x - k - (1 - d)) / d) };
}
// Interpolates numeric key poses (one per beat, looping), arriving on each beat. `moving` is 0..1 during a
// transition and 0 while holding, handy for lifting the stepping foot.
function keyframes(x, keys, d = 0.45) {
  const { k, w } = arrive(x, d);
  const n = keys.length;
  const a = keys[((k % n) + n) % n];
  const b = keys[(((k + 1) % n) + n) % n];
  const out = { moving: w > 0 && w < 1 ? Math.sin(Math.PI * w) : 0 };
  for (const key of Object.keys(a)) out[key] = lerp(a[key], b[key], w);
  return out;
}

// Smooth deterministic noise for tiny "alive" motion.
const wobble = (x) => Math.sin(x * 2.1) * 0.5 + Math.sin(x * 3.7 + 1.3) * 0.3 + Math.sin(x * 5.3 + 2.4) * 0.2;

// Arm poses for the LEFT arm as [upper-arm direction, forearm direction]; mirrored for the right.
const ARM = {
  relaxed: [V(0.2, -1, 0.02), V(0.12, -1, 0.3)],
  bent: [V(0.15, -1, -0.12), V(0.12, -0.15, 1)],
  swingFwd: [V(0.15, -0.9, 0.45), V(0.05, 0.1, 1)],
  swingBack: [V(0.15, -0.9, -0.4), V(0.1, -0.5, 0.8)],
  fistUp: [V(0.3, 0.92, 0.25), V(0.02, 1, 0.12)],
  fistMid: [V(0.55, 0.25, 0.6), V(0.05, 1, 0.25)],
  chest: [V(0.4, -0.55, 0.55), V(-0.75, 0.3, 0.55)],
  clapIn: [V(-0.2, -0.62, 0.76), V(-0.3, 0.32, 0.9)],
  clapOut: [V(0.65, -0.45, 0.6), V(0.55, 0.35, 0.75)],
  pointUp: [V(0.7, 0.72, 0.15), V(0.66, 0.74, 0.12)],
  pointAcross: [V(-0.25, -0.7, 0.65), V(-0.65, -0.55, 0.45)],
  hip: [V(0.65, -0.75, -0.15), V(-0.55, -0.6, 0.2)],
  vUp: [V(0.5, 0.85, 0.12), V(0.4, 0.9, 0.08)],
  tBent: [V(1, 0.05, 0), V(0, 1, 0.1)],
  tDown: [V(1, 0.05, 0), V(0, -1, 0.1)],
  frontFlat: [V(0.25, 0, 1), V(0.1, 0, 1)],
  shrug: [V(0.3, -1, 0.1), V(0.4, -0.3, 0.85)],
};

// Spherical interpolation of a limb direction: the limb sweeps along an arc at steady angular speed
// (a straight-line blend between near-opposite directions would collapse and flip).
const _axis = new THREE.Vector3();
function slerpDir(a, b, w) {
  const dot = Math.max(-1, Math.min(1, a.dot(b)));
  const angle = Math.acos(dot);
  if (angle < 1e-4) return a.clone();
  _axis.crossVectors(a, b);
  // Opposite directions: swing out to the side (outward = +X for the left-arm convention).
  if (_axis.lengthSq() < 1e-6) _axis.crossVectors(a, Math.abs(a.x) > 0.9 ? Z : X);
  return a.clone().applyAxisAngle(_axis.normalize(), angle * w);
}

function arm(a, b, w = 1) {
  if (typeof a === 'string') a = ARM[a];
  if (typeof b === 'string') b = ARM[b];
  if (!b || w <= 0) return a;
  if (w >= 1) return b;
  return [slerpDir(a[0], b[0], w), slerpDir(a[1], b[1], w)];
}

const base = () => ({
  drop: 0.02,
  shiftX: 0,
  shiftZ: 0,
  hipYaw: 0,
  hipRoll: 0,
  hipPitch: 0,
  chestYaw: 0,
  chestRoll: 0,
  chestPitch: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  shoulderL: 0,
  shoulderR: 0,
  armL: ARM.relaxed,
  armR: ARM.relaxed,
  footL: null,
  footR: null,
  // Whole-body turn around the vertical axis (spins); the feet pivot with it.
  turn: 0,
});

export const PROCEDURAL_MOVES = [
  {
    id: 'idle-sway',
    name: 'Idle sway',
    energy: 0.1,
    pose(x) {
      const p = base();
      const s = Math.sin((Math.PI * x) / 2);
      p.shiftX = 0.035 * s;
      p.hipRoll = -0.03 * s;
      p.chestRoll = 0.03 * s;
      p.drop = 0.015 + 0.01 * bounce(x / 2);
      p.headPitch = 0.04 * bounce(frac(x));
      p.headRoll = 0.03 * s;
      p.chestPitch = -0.015 * Math.sin(Math.PI * x);
      return p;
    },
  },
  {
    id: 'groove',
    name: 'Bounce groove',
    energy: 0.32,
    pose(x) {
      const p = base();
      const u = frac(x);
      const s = Math.sin(Math.PI * x);
      p.drop = 0.03 + 0.045 * bounce(u);
      p.headPitch = 0.14 * bounce(u) - 0.03;
      p.hipYaw = 0.1 * s;
      p.hipRoll = 0.04 * s;
      p.shiftX = 0.035 * s;
      p.chestRoll = -0.05 * s;
      p.chestYaw = -0.06 * s;
      p.shoulderL = p.shoulderR = 0.06 * bounce(u);
      p.armL = arm('bent', 'swingFwd', 0.5 + 0.5 * s);
      p.armR = arm('bent', 'swingFwd', 0.5 - 0.5 * s);
      return p;
    },
  },
  {
    id: 'two-step',
    name: 'Two-step',
    energy: 0.48,
    pose(x) {
      const p = base();
      const u = frac(x);
      const k = Math.floor(x);
      const side = Math.cos(Math.PI * x);
      p.drop = 0.035 + 0.04 * bounce(u);
      p.shiftX = 0.075 * side;
      p.hipRoll = -0.07 * side;
      p.chestRoll = 0.06 * side;
      p.hipYaw = 0.1 * side;
      p.headPitch = 0.1 * bounce(u);
      p.headRoll = -0.05 * side;
      // The free foot taps out to the side between beats.
      const tap = { lift: 0.07 * mid(u), side: 0.06 * mid(u), fwd: 0.02 };
      if (k % 2 === 0) p.footR = tap;
      else p.footL = tap;
      p.armL = arm('swingBack', 'swingFwd', 0.5 - 0.5 * side);
      p.armR = arm('swingBack', 'swingFwd', 0.5 + 0.5 * side);
      return p;
    },
  },
  {
    id: 'shoulder-pop',
    name: 'Shoulder pop',
    energy: 0.42,
    pose(x) {
      const p = base();
      const u = frac(x);
      const left = Math.floor(x) % 2 === 0;
      const hit = bounce(u);
      p.drop = 0.03 + 0.03 * hit;
      p.shoulderL = left ? 0.4 * hit : 0;
      p.shoulderR = left ? 0 : 0.4 * hit;
      p.chestRoll = (left ? -1 : 1) * 0.08 * hit;
      // Chest turns toward the popping shoulder, arriving on its beat.
      const turn = arrive(x, 0.4);
      const side = (k) => ((((k % 2) + 2) % 2) === 0 ? 1 : -1);
      p.chestYaw = 0.1 * lerp(side(turn.k), side(turn.k + 1), turn.w);
      p.headRoll = (left ? 1 : -1) * 0.06 * hit;
      p.headPitch = 0.06 * hit;
      p.armL = arm('bent', 'shrug', left ? hit : 0);
      p.armR = arm('bent', 'shrug', left ? 0 : hit);
      return p;
    },
  },
  {
    id: 'clap',
    name: 'Clap groove',
    energy: 0.55,
    pose(x) {
      const p = base();
      const u = frac(x);
      // Hands meet on beats 2 and 4.
      const c = (0.5 + 0.5 * Math.cos(Math.PI * (x - 1))) ** 2;
      const s = Math.sin(Math.PI * x);
      p.drop = 0.035 + 0.045 * bounce(u);
      p.headPitch = 0.12 * bounce(u);
      p.hipYaw = 0.08 * s;
      p.shiftX = 0.04 * s;
      p.chestPitch = 0.05 * c;
      p.armL = arm('clapOut', 'clapIn', c);
      p.armR = arm('clapOut', 'clapIn', c);
      p.rollL = p.rollR = -1.45 * c;
      return p;
    },
  },
  {
    id: 'wave-hands',
    name: 'Hands up wave',
    energy: 0.62,
    pose(x) {
      const p = base();
      const u = frac(x);
      const s = Math.sin((Math.PI * x) / 2);
      p.drop = 0.03 + 0.03 * bounce(u);
      p.chestRoll = 0.14 * s;
      p.hipRoll = -0.06 * s;
      p.shiftX = -0.06 * s;
      p.headRoll = 0.08 * s;
      p.headPitch = 0.06 * bounce(u) - 0.08;
      const wave = 0.25 * Math.sin(Math.PI * x);
      p.armL = [ARM.vUp[0], V(0.4 + wave, 0.9, 0.1)];
      p.armR = [ARM.vUp[0], V(0.4 - wave, 0.9, 0.1)];
      return p;
    },
  },
  {
    id: 'disco',
    name: 'Disco point',
    energy: 0.7,
    pose(x) {
      const p = base();
      const u = frac(x);
      // Arm reaches the "up" point exactly on even beats, the "across" point on odd beats.
      const { k, w: t } = arrive(x, 0.4);
      const isUp = (b) => (((b % 2) + 2) % 2 === 0 ? 1 : 0);
      const w = lerp(isUp(k), isUp(k + 1), t);
      p.drop = 0.03 + 0.04 * bounce(u);
      p.hipYaw = lerp(0.18, -0.12, w);
      p.shiftX = lerp(0.05, -0.05, w);
      p.hipRoll = lerp(-0.05, 0.06, w);
      p.chestRoll = lerp(0.04, -0.1, w);
      p.headYaw = lerp(0.25, -0.35, w);
      p.headPitch = lerp(0.18, -0.15, w);
      p.armR = arm('pointAcross', 'pointUp', w);
      p.armL = ARM.hip;
      return p;
    },
  },
  {
    id: 'robot',
    name: 'Robot',
    energy: 0.62,
    pose(x) {
      const p = base();
      const k = ((Math.floor(x) % 4) + 4) % 4;
      const u = frac(x);
      const keys = [
        ['tBent', 'tDown', 0.3],
        ['frontFlat', 'tBent', -0.3],
        ['tDown', 'frontFlat', 0.3],
        ['tBent', 'tBent', 0],
      ];
      // Robot is crisp, but still arrives on the beat with a short ease.
      const [l0, r0, h0] = keys[k];
      const [l1, r1, h1] = keys[(k + 1) % 4];
      const w = arrive(x, 0.2).w;
      p.armL = arm(l0, l1, w);
      p.armR = arm(r0, r1, w);
      p.headYaw = lerp(h0, h1, w);
      p.chestYaw = 0.5 * lerp(h0, h1, w);
      p.drop = 0.04 + 0.02 * (u > 0.8 ? (u - 0.8) / 0.2 : 0);
      return p;
    },
  },
  {
    id: 'fist-pump',
    name: 'Fist pump',
    energy: 0.82,
    pose(x) {
      const p = base();
      const u = frac(x);
      const hit = bounce(u);
      // Pumping arm switches sides every bar, crossfading over the last half beat so it never jumps.
      const g = Math.floor(x / 4);
      const lead = (n) => (((n % 2) + 2) % 2 === 0 ? 1 : 0); // 1 = right arm pumps
      const r = lerp(lead(g), lead(g + 1), easeInOut((x - 4 * g - 3.5) / 0.5));
      p.drop = 0.035 + 0.06 * hit;
      p.headPitch = 0.2 * hit - 0.05;
      p.chestPitch = -0.08 * hit;
      p.hipYaw = lerp(0.15, -0.15, r);
      const pump = arm('fistMid', 'fistUp', hit);
      p.armR = arm(ARM.chest, pump, r);
      p.armL = arm(ARM.chest, pump, 1 - r);
      p.fistR = 0.5 + 0.5 * r;
      p.fistL = 1 - 0.5 * r;
      return p;
    },
  },
  {
    id: 'jump',
    name: 'Hype jump',
    energy: 0.95,
    pose(x) {
      const p = base();
      // One continuous 2-beat cycle (c in [-1, 1), wrapping while standing still): crouch to load,
      // take off just before the beat, top of the jump ON the beat, land, absorb, stand.
      const c = ((((x + 1) % 2) + 2) % 2) - 1;
      const span = (a, b) => clamp01((c - a) / (b - a));
      const air = c > -0.2 && c < 0.25 ? Math.sin(Math.PI * span(-0.2, 0.25)) : 0;
      const load = c > -0.6 && c <= -0.2 ? mid(span(-0.6, -0.2) * 0.5) : 0; // deepens until take-off
      const absorb = c >= 0.25 && c < 0.75 ? mid(span(0.25, 0.75)) : 0;
      const loadEnd = c > -0.2 && c < -0.1 ? 1 - span(-0.2, -0.1) : 0; // legs extend out of the crouch
      const crouch = Math.max(load, loadEnd, absorb * 0.8);
      p.drop = 0.03 + 0.11 * crouch - 0.12 * air;
      const lift = 0.12 * air;
      p.footL = { lift };
      p.footR = { lift };
      p.chestPitch = 0.14 * crouch - 0.05 * air;
      p.headPitch = 0.08 * crouch - 0.12 * air;
      // Arms swing back while loading, throw up through the jump, come down while landing.
      const up = c < -0.35 ? 0 : c < 0.05 ? easeInOut(span(-0.35, 0.05)) : c < 0.6 ? 1 - easeInOut(span(0.2, 0.6)) : 0;
      // Backswing holds while the arms come up (it's invisible once they're fully up).
      const back = c < -0.35 ? easeInOut(span(-0.9, -0.35)) : c < 0.05 ? 1 : 0;
      p.armL = arm(arm('relaxed', 'swingBack', back), 'vUp', up);
      p.armR = arm(arm('relaxed', 'swingBack', back), 'vUp', up);
      return p;
    },
  },
  {
    id: 'side-step',
    name: 'Side step',
    energy: 0.38,
    pose(x) {
      const p = base();
      const u = frac(x);
      // Step out right, bring it back, step out left, bring it back — arriving on each beat.
      const f = keyframes(x, [
        { r: 0.13, l: 0, shift: -0.06 },
        { r: 0, l: 0, shift: 0 },
        { r: 0, l: 0.13, shift: 0.06 },
        { r: 0, l: 0, shift: 0 },
      ]);
      const k = ((Math.floor(x) % 4) + 4) % 4;
      const rMoving = k === 3 || k === 0;
      p.footR = { side: f.r, lift: rMoving ? 0.05 * f.moving : 0 };
      p.footL = { side: f.l, lift: rMoving ? 0 : 0.05 * f.moving };
      p.shiftX = f.shift;
      p.hipRoll = -0.8 * f.shift;
      p.chestRoll = 0.6 * f.shift;
      p.drop = 0.035 + 0.035 * bounce(u);
      p.headPitch = 0.1 * bounce(u);
      const swing = f.shift / 0.06;
      p.armL = arm('swingBack', 'swingFwd', 0.5 - 0.5 * swing);
      p.armR = arm('swingBack', 'swingFwd', 0.5 + 0.5 * swing);
      p.fistL = p.fistR = 0.3;
      return p;
    },
  },
  {
    id: 'body-roll',
    name: 'Body roll',
    energy: 0.45,
    pose(x) {
      const p = base();
      // A wave travelling down the body over two beats: head → chest → hips.
      const ph = Math.PI * x;
      p.headPitch = -0.14 * Math.sin(ph + 0.7);
      p.chestPitch = 0.2 * Math.sin(ph);
      p.hipPitch = -0.12 * Math.sin(ph - 0.9);
      p.shiftZ = 0.035 * Math.sin(ph - 0.5);
      p.drop = 0.045 + 0.03 * (0.5 + 0.5 * Math.sin(ph - 1.4));
      p.chestRoll = 0.04 * Math.sin(ph * 0.5);
      p.armL = arm('bent', 'chest', 0.35 + 0.25 * Math.sin(ph - 0.3));
      p.armR = arm('bent', 'chest', 0.35 + 0.25 * Math.sin(ph - 0.3));
      p.fistL = p.fistR = 0.2;
      return p;
    },
  },
  {
    id: 'running-man',
    name: 'Running man',
    energy: 0.88,
    pose(x) {
      const p = base();
      const u = frac(x);
      // On every beat one knee is up while the standing foot slides back; legs swap on the off-beat.
      const knee = 0.5 + 0.5 * Math.cos(2 * Math.PI * u);
      const right = ((Math.round(x) % 2) + 2) % 2 === 0;
      const up = { lift: 0.27 * knee, fwd: 0.08 * knee };
      const slide = { fwd: -0.12 * knee };
      p.footR = right ? up : slide;
      p.footL = right ? slide : up;
      p.drop = 0.05 + 0.05 * knee;
      p.chestPitch = 0.06 + 0.04 * knee;
      p.headPitch = 0.12 * knee;
      p.hipYaw = (right ? -1 : 1) * 0.06 * knee;
      const s = right ? 1 : -1;
      p.armL = arm('swingBack', 'swingFwd', 0.5 + 0.5 * s * knee);
      p.armR = arm('swingBack', 'swingFwd', 0.5 - 0.5 * s * knee);
      p.fistL = p.fistR = 0.8;
      return p;
    },
  },
  {
    id: 'arm-wave',
    name: 'Arm wave',
    energy: 0.5,
    pose(x) {
      const p = base();
      // A ripple running from the left fingertips across the shoulders to the right fingertips (2 beats),
      // then back again.
      const dir = ((Math.floor(x / 2) % 2) + 2) % 2 === 0 ? 1 : -1;
      const ph = Math.PI * (x % 2) * 1.6;
      const at = (i) => Math.sin(ph - (dir > 0 ? i : 5 - i) * 0.75);
      p.armL = [V(1, 0.3 * at(1), 0.12), V(1, 0.55 * at(0), 0.1)];
      p.armR = [V(1, 0.3 * at(4), 0.12), V(1, 0.55 * at(5), 0.1)];
      p.shoulderL = 0.22 * Math.max(0, at(2));
      p.shoulderR = 0.22 * Math.max(0, at(3));
      p.chestRoll = 0.07 * (at(3) - at(2));
      p.headRoll = 0.05 * (at(3) - at(2));
      p.drop = 0.035 + 0.025 * bounce(frac(x));
      return p;
    },
  },
  {
    id: 'cabbage-patch',
    name: 'Cabbage patch',
    energy: 0.62,
    pose(x) {
      const p = base();
      // Fists together in front of the chest, circling; the torso circles with them.
      const th = Math.PI * x;
      const circle = (mirror) => {
        const c = (mirror ? -1 : 1) * Math.cos(th);
        return [V(0.25 + 0.14 * c, -0.4 + 0.2 * Math.sin(th), 0.85), V(-0.65 + 0.1 * c, 0.2 + 0.15 * Math.sin(th), 0.75)];
      };
      p.armL = circle(false);
      p.armR = circle(true);
      p.fistL = p.fistR = 1;
      p.chestRoll = 0.08 * Math.sin(th);
      p.chestPitch = 0.05 + 0.04 * Math.cos(th);
      p.hipYaw = 0.12 * Math.cos(th);
      p.shiftX = -0.04 * Math.cos(th);
      p.drop = 0.05 + 0.04 * bounce(frac(x));
      p.headPitch = 0.1 * bounce(frac(x));
      return p;
    },
  },
  {
    id: 'sprinkler',
    name: 'Sprinkler',
    energy: 0.66,
    pose(x) {
      const p = base();
      // One hand behind the head, the other arm ticks across in 8th-notes over a bar, then sweeps back.
      const bar = ((x % 4) + 4) % 4;
      const ticks = bar < 3 ? Math.floor(bar * 2) + easeInOut((bar * 2 - Math.floor(bar * 2) - 0.6) / 0.4) : 6 * (1 - easeInOut((bar - 3) / 0.8));
      const a = 0.1 + 0.22 * ticks;
      p.armR = [V(Math.cos(a), 0.1, Math.sin(a)), V(Math.cos(a), 0.12, Math.sin(a))];
      p.armL = [V(0.55, 0.65, -0.15), V(-0.75, 0.35, -0.25)];
      p.fistR = 0.6;
      p.chestYaw = -0.25 * (a - 0.7);
      p.headYaw = -0.4 * (a - 0.7);
      p.drop = 0.04 + 0.03 * bounce(frac(x * 2));
      p.shiftX = -0.04;
      return p;
    },
  },
  {
    id: 'floss',
    name: 'Floss',
    energy: 0.8,
    pose(x) {
      const p = base();
      // Straight arms swing one way while the hips swing the other; arms swap front/back each beat.
      const s = Math.sin(Math.PI * x);
      const fb = 0.35 * Math.cos(Math.PI * x);
      const left = V(0.2 - 0.6 * s, -0.9, fb);
      const right = V(0.2 + 0.6 * s, -0.9, -fb);
      p.armL = [left, left.clone()];
      p.armR = [right, right.clone()];
      p.fistL = p.fistR = 0.7;
      p.shiftX = 0.07 * s;
      p.hipRoll = -0.08 * s;
      p.chestRoll = 0.05 * s;
      p.hipYaw = 0.06 * s;
      p.drop = 0.04 + 0.025 * bounce(frac(x));
      p.headRoll = -0.05 * s;
      return p;
    },
  },
  {
    id: 'raise-roof',
    name: 'Raise the roof',
    energy: 0.74,
    pose(x) {
      const p = base();
      const hit = bounce(frac(x));
      // Palms push upward on every beat.
      p.armL = arm([V(0.75, 0.1, 0.25), V(0.15, 0.85, 0.2)], [V(0.65, 0.45, 0.2), V(0.05, 1, 0.1)], hit);
      p.armR = p.armL;
      p.drop = 0.04 + 0.05 * (1 - hit);
      p.headPitch = -0.08 * hit + 0.06;
      p.chestPitch = -0.06 * hit;
      p.hipYaw = 0.08 * Math.sin(Math.PI * x);
      p.shoulderL = p.shoulderR = 0.12 * hit;
      return p;
    },
  },
  {
    id: 'kick-step',
    name: 'Kick step',
    energy: 0.78,
    pose(x) {
      const p = base();
      const u = frac(x);
      // A low front kick on every beat, alternating legs; the standing knee stays soft.
      const kick = (0.5 + 0.5 * Math.cos(2 * Math.PI * u)) ** 2;
      const right = ((Math.round(x) % 2) + 2) % 2 === 0;
      const k = { lift: 0.15 * kick, fwd: 0.3 * kick };
      p.footR = right ? k : null;
      p.footL = right ? null : k;
      p.shiftX = (right ? 0.05 : -0.05) * (0.4 + 0.6 * kick);
      p.chestPitch = -0.06 * kick;
      p.drop = 0.045 + 0.03 * kick;
      p.armL = arm('swingBack', 'swingFwd', right ? 0.5 - 0.4 * kick : 0.5 + 0.4 * kick);
      p.armR = arm('swingBack', 'swingFwd', right ? 0.5 + 0.4 * kick : 0.5 - 0.4 * kick);
      p.fistL = p.fistR = 0.5;
      p.headPitch = 0.08 * kick;
      return p;
    },
  },
  {
    id: 'salsa-sway',
    name: 'Salsa sway',
    energy: 0.42,
    pose(x) {
      const p = base();
      const u = frac(x);
      // Cuban hip motion with forward/back basic steps; arms held in a loose frame.
      const s = Math.sin(Math.PI * x);
      const f = keyframes(x, [{ fwd: 0.1 }, { fwd: 0 }, { fwd: -0.1 }, { fwd: 0 }], 0.5);
      const k = ((Math.floor(x) % 4) + 4) % 4;
      const leftMoves = k === 3 || k === 0;
      p.footL = { fwd: leftMoves ? f.fwd : 0, lift: leftMoves ? 0.035 * f.moving : 0 };
      p.footR = { fwd: leftMoves ? 0 : -f.fwd, lift: leftMoves ? 0 : 0.035 * f.moving };
      p.shiftX = 0.07 * s;
      p.hipRoll = -0.1 * s;
      p.hipYaw = 0.12 * Math.sin(Math.PI * x + Math.PI / 2);
      p.chestRoll = 0.04 * s;
      p.chestYaw = -0.6 * p.hipYaw;
      p.drop = 0.04 + 0.02 * bounce(u);
      p.armL = [V(0.6, -0.55, 0.35), V(0.05, 0.45, 0.9)];
      p.armR = [V(0.6, -0.5, 0.4), V(-0.1, 0.4, 0.9)];
      p.headYaw = 0.1 * s;
      return p;
    },
  },
  {
    id: 'spin',
    name: 'Groove & spin',
    energy: 0.72,
    pose(x) {
      const p = base();
      const u = frac(x);
      // Three beats of groove, then a full turn that lands facing front on the next downbeat.
      const bar = ((x % 4) + 4) % 4;
      const turnW = easeInOut((bar - 2.7) / 1.3);
      p.turn = 2 * Math.PI * turnW;
      const spinning = turnW > 0 && turnW < 1 ? Math.sin(Math.PI * turnW) : 0;
      p.drop = 0.035 + 0.04 * bounce(u) * (1 - spinning) + 0.03 * spinning;
      p.headPitch = 0.1 * bounce(u) * (1 - spinning);
      p.hipYaw = 0.1 * Math.sin(Math.PI * x) * (1 - spinning);
      p.armL = arm(arm('bent', 'swingFwd', 0.5 + 0.5 * Math.sin(Math.PI * x)), 'chest', spinning);
      p.armR = arm(arm('bent', 'swingFwd', 0.5 - 0.5 * Math.sin(Math.PI * x)), 'chest', spinning);
      p.fistL = p.fistR = 0.4 + 0.4 * spinning;
      // Weight on the balls of the feet while turning.
      p.footL = { heel: 0.6 * spinning };
      p.footR = { heel: 0.6 * spinning };
      return p;
    },
  },
];

const REQUIRED = ['Hips', 'Spine', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];

const Y = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// Turns the pose parameters above into bone rotations for one rig.
export class ProceduralBody {
  static supports(rig) {
    return REQUIRED.every((n) => rig.byCanon.has(n));
  }

  constructor(rig) {
    this.rig = rig;
    const idx = (n) => rig.byCanon.get(n);
    const P = (n) => rig.restWorldP[idx(n)];
    const dir = (a, b) => P(b).clone().sub(P(a)).normalize();
    this.b = Object.fromEntries(
      ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm',
        'LeftForeArm', 'RightForeArm', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot']
        .map((n) => [n, idx(n)]),
    );
    const side = (s) => ({
      upper: idx(`${s}Arm`),
      fore: idx(`${s}ForeArm`),
      upperDir: dir(`${s}Arm`, `${s}ForeArm`),
      foreDir: dir(`${s}ForeArm`, `${s}Hand`),
      thigh: idx(`${s}UpLeg`),
      shin: idx(`${s}Leg`),
      foot: idx(`${s}Foot`),
      thighDir: dir(`${s}UpLeg`, `${s}Leg`),
      shinDir: dir(`${s}Leg`, `${s}Foot`),
      l1: P(`${s}UpLeg`).distanceTo(P(`${s}Leg`)),
      l2: P(`${s}Leg`).distanceTo(P(`${s}Foot`)),
      hipJoint: P(`${s}UpLeg`).clone().sub(P('Hips')),
      ankle: P(`${s}Foot`).clone(),
    });
    this.L = side('Left');
    this.R = side('Right');
    this.hipsP = P('Hips').clone();
    this.legLength = this.L.l1 + this.L.l2;
    this.targets = new Map();
    this.pool = Array.from({ length: 24 }, () => new THREE.Quaternion());
    this.fingersL = this.#fingerChain('Left', -1);
    this.fingersR = this.#fingerChain('Right', 1);
  }

  // Finger curl as local rotations: a rotation about the character's Z axis at rest (palms face down in
  // T-pose, inwards-down in A-pose; Z is the knuckle hinge axis in both).
  #fingerChain(side, sign) {
    const rig = this.rig;
    const out = [];
    const fingers = [['Index', 0], ['Middle', 0.08], ['Ring', 0.15], ['Pinky', 0.22], ['Thumb', -0.15]];
    for (const [name, extra] of fingers) {
      for (let j = 1; j <= 3; j++) {
        const bone = rig.byCanon.get(`${side}Hand${name}${j}`);
        if (bone === undefined) continue;
        const thumb = name === 'Thumb';
        const relaxed = (thumb ? 0.12 : [0.28, 0.42, 0.32][j - 1]) + extra * (thumb ? 0 : 1);
        const fist = thumb ? 0.45 : [1.25, 1.45, 1.05][j - 1];
        const local = (angle) => {
          const W = rig.restWorldQ[bone];
          const delta = W.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(Z, sign * angle)).multiply(W);
          return new THREE.Quaternion().fromArray(rig.restQ, bone * 4).multiply(delta);
        };
        out.push({ bone, relaxed: local(relaxed), fist: local(fist) });
      }
    }
    return out;
  }

  #q(i) {
    return this.pool[i];
  }

  #set(bone, q) {
    if (bone === undefined) return;
    this.targets.set(bone, q.clone().multiply(this.rig.restWorldQ[bone]));
  }

  #euler(pitch, yaw, roll, out) {
    return out.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
  }

  build(params, pose) {
    const rig = this.rig;
    const L = this.legLength;
    this.targets.clear();
    rig.resetPose(pose);

    const turnQ = this.#q(22).setFromAxisAngle(Y, params.turn ?? 0);
    const hipsQ = this.#euler(params.hipPitch, params.hipYaw, params.hipRoll, this.#q(0)).premultiply(turnQ);
    const chestRel = this.#euler(params.chestPitch, params.chestYaw, params.chestRoll, this.#q(1));
    const chestQ = this.#q(2).copy(hipsQ).multiply(chestRel);
    const headQ = this.#q(3).copy(chestQ).multiply(this.#euler(params.headPitch, params.headYaw, params.headRoll, this.#q(4)));
    const yawQ = this.#q(5).setFromAxisAngle(Y, params.hipYaw).premultiply(turnQ);

    const offset = _v.set(params.shiftX * L, -params.drop * L, params.shiftZ * L);
    rig.setHipsOffset(pose, offset);
    const hipsPos = this.hipsP.clone().add(offset);

    this.#set(this.b.Hips, hipsQ);
    this.#set(this.b.Spine, this.#q(7).slerpQuaternions(hipsQ, chestQ, 0.34));
    this.#set(this.b.Spine1, this.#q(8).slerpQuaternions(hipsQ, chestQ, 0.67));
    this.#set(this.b.Spine2, chestQ);
    this.#set(this.b.Neck, this.#q(9).slerpQuaternions(chestQ, headQ, 0.5));
    this.#set(this.b.Head, headQ);
    this.#set(this.b.LeftShoulder, this.#q(10).copy(chestQ).multiply(this.#q(11).setFromAxisAngle(Z, params.shoulderL)));
    this.#set(this.b.RightShoulder, this.#q(12).copy(chestQ).multiply(this.#q(13).setFromAxisAngle(Z, -params.shoulderR)));

    const mirror = (v) => _w.set(-v.x, v.y, v.z);
    for (const [s, a, flip] of [[this.L, params.armL, false], [this.R, params.armR, true]]) {
      const up = flip ? mirror(a[0]).clone() : a[0];
      const fore = flip ? mirror(a[1]).clone() : a[1];
      const upperQ = this.#q(14).copy(chestQ).multiply(this.#q(15).setFromUnitVectors(s.upperDir, up));
      this.#set(s.upper, upperQ);
      // The forearm swings from wherever the upper arm carried it, so elbow/wrist twist stays natural.
      const carried = s.foreDir.clone().applyQuaternion(upperQ);
      const wanted = fore.clone().applyQuaternion(chestQ);
      const foreQ = this.#q(19).setFromUnitVectors(carried, wanted).multiply(upperQ);
      // Forearm roll (pronation/supination) turns the palm, e.g. palms facing each other for a clap.
      const roll = (flip ? -1 : 1) * ((flip ? params.rollR : params.rollL) ?? 0);
      if (roll) foreQ.premultiply(this.#q(21).setFromAxisAngle(wanted, roll));
      this.#set(s.fore, foreQ);
    }

    // Relaxed hands (or fists) instead of flat T-pose fingers.
    for (const [chain, f] of [[this.fingersL, params.fistL ?? 0], [this.fingersR, params.fistR ?? 0]]) {
      for (const j of chain) this.#q(20).slerpQuaternions(j.relaxed, j.fist, f).toArray(pose.q, j.bone * 4);
    }

    // Legs: two-bone IK from the moved hip joint to the (planted or lifted) ankle.
    const kneeHint = Z.clone().applyQuaternion(yawQ);
    for (const [s, foot, sign] of [[this.L, params.footL, 1], [this.R, params.footR, -1]]) {
      const hip = s.hipJoint.clone().applyQuaternion(hipsQ).add(hipsPos);
      // Planted ankle (rotated with the body turn about the hips' vertical axis) plus the move's foot offset.
      const ankle = s.ankle.clone().sub(this.hipsP).setY(0).applyQuaternion(turnQ).add(this.hipsP).setY(s.ankle.y);
      if (foot) {
        const up = ((foot.lift ?? 0) + (foot.heel ?? 0) * 0.035) * L;
        ankle.add(_v.set(sign * (foot.side ?? 0) * L, 0, (foot.fwd ?? 0) * L).applyQuaternion(turnQ)).y += up;
      }
      const v = ankle.clone().sub(hip);
      const d = Math.min(Math.max(v.length(), 1e-4), (s.l1 + s.l2) * 0.9995);
      v.normalize();
      const a = (s.l1 * s.l1 - s.l2 * s.l2 + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, s.l1 * s.l1 - a * a));
      const n = kneeHint.clone().addScaledVector(v, -kneeHint.dot(v)).normalize();
      const knee = hip.clone().addScaledVector(v, a).addScaledVector(n, h);
      const anklePos = hip.clone().addScaledVector(v, d);
      const thighDir = knee.clone().sub(hip).normalize();
      const shinDir = anklePos.sub(knee).normalize();
      const twistedThigh = s.thighDir.clone().applyQuaternion(yawQ);
      const thighQ = this.#q(16).setFromUnitVectors(twistedThigh, thighDir).multiply(yawQ);
      this.#set(s.thigh, thighQ);
      // Shin swings from where the thigh carried it (knee bends in its own plane, no twist).
      const carriedShin = s.shinDir.clone().applyQuaternion(thighQ);
      this.#set(s.shin, this.#q(17).setFromUnitVectors(carriedShin, shinDir).multiply(thighQ));
      // Toes point down when the foot is lifted; the heel peels up when the leg carries no weight.
      const pitch = clamp01((foot?.lift ?? 0) / 0.06) * 0.25 + (foot?.heel ?? 0) * 0.55;
      this.#set(s.foot, pitch ? this.#q(18).setFromAxisAngle(X, pitch).premultiply(yawQ) : yawQ);
    }

    rig.solve(this.targets, pose);
    return pose;
  }
}

const LEAD = 0.05;
const LAG = 0.07;

// A procedural move bound to a rig, with the same interface as ClipMove.
export class ProceduralMove {
  constructor(def, body) {
    this.id = `proc:${def.id}`;
    this.name = def.name;
    this.source = 'Procedural';
    this.kind = 'procedural';
    this.energyLevel = def.energy;
    this.def = def;
    this.body = body;
    this.period = null;
    this.valid = true;
  }

  // Overlapping action: hips/legs lead by a hair, arms land exactly on the beat, the head follows a
  // touch later. Plus breathing, small head drift, a level gaze and heel peel on weight shifts.
  sample(beat, pose) {
    const def = this.def;
    const p = def.pose(beat + LEAD);
    const arms = def.pose(beat);
    const head = def.pose(beat - LAG);
    for (const key of ['armL', 'armR', 'shoulderL', 'shoulderR', 'fistL', 'fistR', 'rollL', 'rollR']) p[key] = arms[key];
    p.headPitch = head.headPitch;
    p.headYaw = head.headYaw;
    p.headRoll = head.headRoll;

    p.chestPitch += -0.014 * Math.sin((Math.PI * beat) / 2);
    p.headYaw += 0.035 * wobble(beat * 0.29);
    p.headPitch += 0.02 * wobble(beat * 0.23 + 3);
    p.chestRoll += 0.01 * wobble(beat * 0.17 + 7);
    p.hipYaw += 0.015 * wobble(beat * 0.13 + 11);
    // People keep their eyes level: the head counters most of the body's sideways tilt.
    p.headRoll -= 0.6 * (p.chestRoll + p.hipRoll);
    // Weight on one leg → the other heel peels up.
    const heel = clamp01((Math.abs(p.shiftX) - 0.03) * 12) * 0.7;
    if (heel > 0) {
      const free = p.shiftX > 0 ? 'footR' : 'footL';
      p[free] = { ...(p[free] ?? {}), heel: Math.max(heel, p[free]?.heel ?? 0) };
    }
    return this.body.build(p, pose);
  }
}
