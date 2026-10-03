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

// Clones share the template's materials, so every look gets its own copies.
export function applyLook(root, style, tintHex) {
  const tint = new THREE.Color(tintHex);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.baseMaterial ??= o.material;
    const base = o.userData.baseMaterial;
    const previous = o.material;
    o.material = Array.isArray(base)
      ? base.map((m) => makeMaterial(m, style, tint))
      : makeMaterial(base, style, tint);
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
