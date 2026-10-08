import * as THREE from 'three';

export const LOOK_STYLES = ['original', 'clay', 'toon', 'chrome', 'hologram'];

let toonGradient;
function getToonGradient() {
  if (!toonGradient) {
    toonGradient = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
    toonGradient.minFilter = toonGradient.magFilter = THREE.NearestFilter;
    toonGradient.needsUpdate = true;
  }
  return toonGradient;
}

function makeMaterial(base, style, tint) {
  switch (style) {
    case 'clay':
      return new THREE.MeshStandardMaterial({ color: tint, roughness: 0.9, metalness: 0 });
    case 'toon':
      return new THREE.MeshToonMaterial({ color: tint, gradientMap: getToonGradient() });
    case 'chrome':
      return new THREE.MeshStandardMaterial({ color: tint, roughness: 0.15, metalness: 1 });
    case 'hologram':
      return new THREE.MeshBasicMaterial({
        color: tint,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    default: {
      const m = base.clone();
      if (m.color) m.color.multiply(tint);
      return m;
    }
  }
}

function disposeMaterial(material) {
  (Array.isArray(material) ? material : [material]).forEach((m) => m.dispose());
}

// Outfit parts are the character's meshes, e.g. RPM's "Wolf3D_Outfit_Top" → "Top".
export const partLabel = (name) =>
  name.replace(/^Wolf3D_/, '').replace(/^Outfit_/, '').replace(/[_-]+/g, ' ').trim() || 'Body';

export function listParts(root) {
  const parts = new Map();
  root.traverse((o) => {
    if (o.isMesh && o.name && !/eye|teeth/i.test(o.name)) parts.set(o.name, partLabel(o.name));
  });
  return [...parts].map(([id, label]) => ({ id, label }));
}

// Clones share the template's materials, so every look gets its own copies.
// `parts` maps a mesh name to an extra tint (multiplied into its texture) in the original style.
export function applyLook(root, style, tintHex, parts = {}) {
  const tint = new THREE.Color(tintHex);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.baseMaterial ??= o.material;
    const base = o.userData.baseMaterial;
    const previous = o.material;
    const meshTint = parts[o.name] && style === 'original' ? tint.clone().multiply(new THREE.Color(parts[o.name])) : tint;
    o.material = Array.isArray(base)
      ? base.map((m) => makeMaterial(m, style, meshTint))
      : makeMaterial(base, style, meshTint);
    if (previous !== base) disposeMaterial(previous);
    o.castShadow = style !== 'hologram';
  });
}

export function disposeLook(root) {
  root.traverse((o) => {
    if (o.isMesh && o.userData.baseMaterial && o.material !== o.userData.baseMaterial) {
      disposeMaterial(o.material);
    }
  });
}
