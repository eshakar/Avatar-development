import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { canonicalBone, skeletonKind } from '../dance/CharacterRig.js';

const TARGET_HEIGHT = 1.8;
const cache = new Map();
const textures = new Map();
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function loadTexture(url, srgb) {
  const key = `${url}|${srgb}`;
  if (!textures.has(key)) {
    const p = new THREE.TextureLoader().loadAsync(url).then((t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.flipY = true;
      return t;
    });
    textures.set(key, p);
    p.catch(() => textures.delete(key));
  }
  return textures.get(key);
}

const pbrUrl = (def, file) => `${def.pbr.dir}/${file}`;

// Colour map for one outfit variant of a PBR avatar (e.g. ActorCore texture sets).
export function loadVariantMap(def, variantId) {
  const v = def.pbr.variants.find((x) => x.id === variantId) ?? def.pbr.variants[0];
  return loadTexture(pbrUrl(def, v.map), true);
}

// Builds a proper PBR material from a texture set instead of the FBX's own (Phong, broken paths).
async function buildPbrMaterial(def) {
  const p = def.pbr;
  const [map, normalMap, roughnessMap, metalnessMap, aoMap] = await Promise.all([
    loadVariantMap(def, p.defaultVariant),
    loadTexture(pbrUrl(def, p.normal), false),
    loadTexture(pbrUrl(def, p.roughness), false),
    p.metallic ? loadTexture(pbrUrl(def, p.metallic), false) : null,
    p.ao ? loadTexture(pbrUrl(def, p.ao), false) : null,
  ]);
  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap,
    roughness: 1,
    metalnessMap,
    metalness: metalnessMap ? 1 : 0,
    aoMap,
    aoMapIntensity: 0.8,
  });
}

// Loads a GLB/FBX once and returns a template asset that instances are cloned from.
export function loadAsset(def, onProgress) {
  if (cache.has(def.url)) return cache.get(def.url);

  const promise = new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    // A PBR set replaces the embedded textures, so don't fetch the FBX's (often Windows-path) images.
    if (def.pbr) manager.setURLModifier((url) => (/\.(png|jpe?g|tga|bmp|tiff?)$/i.test(url) ? BLANK_PNG : url));
    const loader = def.type === 'fbx' ? new FBXLoader(manager) : new GLTFLoader(manager);
    loader.load(
      def.url,
      (result) => {
        const root = def.type === 'fbx' ? result : result.scene;
        const asset = prepare(root, result.animations ?? [], def);
        if (!def.pbr) return resolve(asset);
        buildPbrMaterial(def)
          .then((material) => {
            root.traverse((o) => o.isMesh && (o.material = material));
            resolve(asset);
          })
          .catch(reject);
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
    if (!hips && o.isBone && canonicalBone(o.name) === 'Hips') hips = o;
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
    if (def.clipName && animations.length === 1) clip.name = def.clipName;
    else if (!clip.name || clip.name === 'mixamo.com' || /^take\s*\d*$/i.test(clip.name)) {
      clip.name = animations.length > 1 ? `${def.name} ${i + 1}` : def.name;
    }
  });

  return { def, root, animations, hasMesh, scale, offset, nodeNames, skeleton: skeletonKind(nodeNames), rig: describeRig(root, hips) };
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
