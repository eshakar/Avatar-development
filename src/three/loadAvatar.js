import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const TARGET_HEIGHT = 1.8;
const HIPS = /hips$/i;
const cache = new Map();

// Loads a GLB/FBX once and returns a template asset that instances are cloned from.
export function loadAsset(def, onProgress) {
  if (cache.has(def.url)) return cache.get(def.url);

  const promise = new Promise((resolve, reject) => {
    const loader = def.type === 'fbx' ? new FBXLoader() : new GLTFLoader();
    loader.load(
      def.url,
      (result) => {
        const root = def.type === 'fbx' ? result : result.scene;
        resolve(prepare(root, result.animations ?? [], def));
      },
      (e) => e.total && onProgress?.(e.loaded / e.total),
      reject,
    );
  });

  cache.set(def.url, promise);
  promise.catch(() => cache.delete(def.url));
  return promise;
}

function prepare(root, animations, def) {
  let hasMesh = false;
  let hips = null;
  const nodeNames = new Set();

  root.traverse((o) => {
    if (o.name) nodeNames.add(o.name);
    if (!hips && o.isBone && HIPS.test(o.name)) hips = o;
    if (o.isMesh) {
      hasMesh = true;
      o.castShadow = true;
      o.receiveShadow = true;
      // Skinned meshes animate outside their bind-pose bounds.
      o.frustumCulled = false;
    }
  });

  root.updateMatrixWorld(true);

  // Normalise every character to the same height, centred and standing on y = 0.
  let scale = 1;
  const offset = new THREE.Vector3();
  if (hasMesh) {
    const box = new THREE.Box3().setFromObject(root, true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    scale = TARGET_HEIGHT / (size.y || 1);
    offset.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  }

  // Mixamo exports name every clip "mixamo.com", so give them readable names.
  animations.forEach((clip, i) => {
    if (!clip.name || clip.name === 'mixamo.com' || /^take\s*\d*$/i.test(clip.name)) {
      clip.name = animations.length > 1 ? `${def.name} ${i + 1}` : def.name;
    }
  });

  return { def, root, animations, hasMesh, scale, offset, nodeNames, rig: describeRig(root, hips) };
}

// Exports differ in units (cm vs m), up-axis (Y-up vs Z-up armatures) and even
// per-bone axes. Recording each bone's rest orientation lets clips be converted
// between any two rigs that share bone names.
function describeRig(root, hips) {
  if (!hips?.parent) return null;
  const rest = new Map();
  root.traverse((o) => {
    if (!o.isBone) return;
    rest.set(o.name, {
      parent: o.parent.getWorldQuaternion(new THREE.Quaternion()),
      world: o.getWorldQuaternion(new THREE.Quaternion()),
    });
  });
  const parentLinear = new THREE.Matrix3().setFromMatrix4(hips.parent.matrixWorld);
  return {
    rest,
    hipsName: hips.name,
    parentLinear,
    parentLinearInv: parentLinear.clone().invert(),
    height: hips.position.clone().applyMatrix3(parentLinear).y,
  };
}
