// Mixamo characters hosted by the three.js project (CORS-enabled).
// Add your own Mixamo downloads to /public/models and list them in manifest.json.
const THREE_MODELS = 'https://threejs.org/examples/models';

export const BUILTIN_AVATARS = [
  {
    id: 'xbot',
    name: 'X Bot',
    tag: 'Mixamo · 7 clips',
    url: `${THREE_MODELS}/gltf/Xbot.glb`,
    type: 'glb',
    accent: '#7c5cff',
    emoji: '🤖',
  },
  {
    id: 'soldier',
    name: 'Soldier',
    tag: 'Mixamo · 4 clips',
    url: `${THREE_MODELS}/gltf/Soldier.glb`,
    type: 'glb',
    accent: '#22c55e',
    emoji: '🪖',
    // This export faces -Z; turn it toward the camera.
    rotationY: Math.PI,
  },
  {
    id: 'michelle',
    name: 'Michelle',
    tag: 'Mixamo · Samba',
    url: `${THREE_MODELS}/gltf/Michelle.glb`,
    type: 'glb',
    accent: '#ff4d8d',
    emoji: '💃',
  },
  {
    id: 'samba',
    name: 'Samba Dancer',
    tag: 'Mixamo · FBX',
    url: `${THREE_MODELS}/fbx/Samba%20Dancing.fbx`,
    type: 'fbx',
    accent: '#f59e0b',
    emoji: '🕺',
  },
];

export const TINTS = ['#ffffff', '#ff4d8d', '#7c5cff', '#22d3ee', '#22c55e', '#f59e0b', '#ef4444', '#94a3b8'];

export const ACCENTS = ['#7c5cff', '#22d3ee', '#ff4d8d', '#22c55e', '#f59e0b', '#ef4444', '#a3e635'];

export const randomAccent = () => ACCENTS[Math.floor(Math.random() * ACCENTS.length)];

export function typeFromName(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'fbx') return 'fbx';
  if (ext === 'glb' || ext === 'gltf') return 'glb';
  return null;
}

// Reads /public/models/manifest.json, e.g.
// [{ "name": "Y Bot", "file": "ybot.fbx", "accent": "#22d3ee", "emoji": "🧍" }]
export async function loadLocalManifest() {
  try {
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}models/manifest.json`, { cache: 'no-store' });
    if (!res.ok) return [];
    const list = await res.json();
    return list
      .filter((entry) => entry.file && typeFromName(entry.file))
      .map((entry, i) => ({
        id: `local-${entry.file}`,
        name: entry.name ?? entry.file.replace(/\.[^.]+$/, ''),
        tag: entry.tag ?? 'Local Mixamo',
        url: `${base}models/${encodeURI(entry.file)}`,
        type: typeFromName(entry.file),
        accent: entry.accent ?? ACCENTS[i % ACCENTS.length],
        emoji: entry.emoji ?? '🧍',
      }));
  } catch {
    return [];
  }
}
