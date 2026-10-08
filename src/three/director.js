import * as THREE from 'three';

// Shots are described by how much of the scene is visible vertically (frame, in metres), where the
// camera looks (focusY), and the camera's azimuth/elevation around the dancer.
export const SHOTS = [
  { id: 'full', name: 'Full body', frame: 2.35, focusY: 0.95, az: 0, el: 0.06, weight: 3 },
  { id: 'wide', name: 'Wide', frame: 4.2, focusY: 1.1, az: 0.12, el: 0.12, weight: 1.5 },
  { id: 'medium', name: 'Medium', frame: 1.3, focusY: 1.3, az: -0.12, el: 0.04, weight: 2 },
  { id: 'close', name: 'Close-up', frame: 0.72, focusY: 1.58, az: 0.08, el: 0.02, weight: 1 },
  { id: 'left', name: '3/4 left', frame: 2.2, focusY: 0.95, az: 0.7, el: 0.08, weight: 2 },
  { id: 'right', name: '3/4 right', frame: 2.2, focusY: 0.95, az: -0.7, el: 0.08, weight: 2 },
  { id: 'low', name: 'Low hero', frame: 2.5, focusY: 1.15, az: 0.25, el: -0.22, weight: 1.5 },
  { id: 'high', name: 'High angle', frame: 2.9, focusY: 0.8, az: -0.3, el: 0.5, weight: 1 },
];

export const CAMERA_MODES = [
  { id: 'auto', name: 'Auto-cut' },
  { id: 'locked', name: 'Locked' },
  { id: 'orbit', name: 'Orbit' },
  { id: 'free', name: 'Free' },
];

export const DEFAULT_CAMERA = {
  mode: 'auto',
  shot: 'full',
  cutBars: 2,
  smooth: false,
  punch: 0.45,
  shake: 0.25,
  orbitBars: 16,
  seed: 3,
};

const shotById = (id) => SHOTS.find((s) => s.id === id) ?? SHOTS[0];

export const verticalFov = (aspect) => (aspect < 1 ? 46 : 30);

// Which shot plays when, for auto-cut mode. Cuts land on downbeats.
export function planShots(grid, opts) {
  if (!grid) return [];
  const blocks = [{ start: -Infinity, end: grid.downbeat, shot: 'wide' }];
  let s = ((opts.seed * 7919) % 2147483647) || 1;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const len = opts.cutBars * 4;
  let prev = 'wide';
  for (let start = grid.downbeat; start <= grid.lastBeat; start += len) {
    const options = SHOTS.filter((sh) => sh.id !== prev);
    const total = options.reduce((a, sh) => a + sh.weight, 0);
    let r = rand() * total;
    let pick = options[0];
    for (const sh of options) if ((r -= sh.weight) <= 0) (pick = sh), (r = Infinity);
    blocks.push({ start, end: start + len, shot: pick.id });
    prev = pick.id;
  }
  blocks.push({ start: blocks[blocks.length - 1].end, end: Infinity, shot: 'wide' });
  return blocks;
}

const _target = new THREE.Vector3();
const _pos = new THREE.Vector3();

function placeShot(shot, aspect, drift, out) {
  const fov = verticalFov(aspect);
  // In landscape the dancer is framed by height; in portrait keep a little extra headroom.
  const dist = shot.frame / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const d = dist * (1 + drift.zoom);
  const az = shot.az + drift.az;
  out.target.set(0, shot.focusY, 0);
  out.pos.set(Math.sin(az) * Math.cos(shot.el) * d, shot.focusY + Math.sin(shot.el) * d, Math.cos(az) * Math.cos(shot.el) * d);
  out.fov = fov;
}

const noise = (t, a, b, c) => Math.sin(t * a) * 0.5 + Math.sin(t * b + 1.3) * 0.3 + Math.sin(t * c + 2.1) * 0.2;
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

// Deterministic camera for time t → { pos, target, fov, roll }.
export function cameraAt(t, grid, opts, aspect, plan, out, follow = null) {
  const beat = grid ? grid.beatAt(t) : t * 2;
  const tmp = { pos: _pos, target: _target, fov: 40 };

  if (opts.mode === 'auto' && plan.length) {
    let i = plan.findIndex((b) => beat >= b.start && beat < b.end);
    if (i < 0) i = plan.length - 1;
    const block = plan[i];
    const span = Number.isFinite(block.start) && Number.isFinite(block.end) ? block.end - block.start : 16;
    const p = Number.isFinite(block.start) ? (beat - block.start) / span : 0.5 + beat / 64;
    const dir = i % 2 ? 1 : -1;
    placeShot(shotById(block.shot), aspect, { zoom: 0.05 - 0.09 * p, az: dir * (0.08 * p - 0.04) }, out);
    // Optional smooth move into the next shot over the last beat.
    const next = plan[i + 1];
    if (opts.smooth && next && Number.isFinite(block.end) && block.end - beat < 1) {
      placeShot(shotById(next.shot), aspect, { zoom: 0.05, az: -dir * 0.04 }, tmp);
      const w = smooth(1 - (block.end - beat));
      out.pos.lerp(tmp.pos, w);
      out.target.lerp(tmp.target, w);
    }
  } else if (opts.mode === 'orbit') {
    const az = (2 * Math.PI * beat) / (opts.orbitBars * 4);
    placeShot(shotById(opts.shot), aspect, { zoom: 0, az }, out);
  } else {
    placeShot(shotById(opts.shot), aspect, { zoom: 0.015 * Math.sin(t * 0.4), az: 0.03 * Math.sin(t * 0.23) }, out);
  }

  // Keep the dancer framed when a move travels: shift the whole camera with the hips (and aim at the head when tight).
  if (follow) {
    const tight = smooth((2.4 - out.pos.distanceTo(out.target) / (1 / Math.tan(THREE.MathUtils.degToRad(out.fov / 2)))) / 1.4);
    const dx = follow.hips.x * 0.85;
    const dz = follow.hips.z * 0.85;
    out.pos.x += dx;
    out.pos.z += dz;
    out.target.x += dx;
    out.target.z += dz;
    if (tight > 0) {
      out.target.x += (follow.head.x - dx) * tight * 0.8;
      out.target.y += (follow.head.y - out.target.y) * tight * 0.8;
    }
  }

  // Zoom punch on each beat, harder on downbeats.
  if (grid && opts.punch > 0 && beat >= 0 && beat <= grid.lastBeat + 1) {
    const u = beat - Math.floor(beat);
    const strength = grid.isDownbeat(Math.floor(beat)) ? 1 : 0.5;
    out.fov *= 1 - opts.punch * 0.07 * Math.exp(-7 * u) * strength * (0.4 + 0.6 * grid.accent(beat));
  }

  // Handheld drift.
  out.roll = 0;
  if (opts.shake > 0) {
    const d = out.pos.distanceTo(out.target);
    const k = opts.shake * 0.018 * d;
    out.pos.x += noise(t, 1.1, 2.3, 4.1) * k;
    out.pos.y += noise(t, 1.7, 3.1, 5.3) * k * 0.7;
    out.target.x += noise(t, 0.9, 2.9, 4.7) * k * 0.5;
    out.roll = noise(t, 0.7, 1.9, 3.7) * opts.shake * 0.012;
  }
  return out;
}
