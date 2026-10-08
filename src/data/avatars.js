// Characters hosted by the three.js project (CORS-enabled).
// Add your own Mixamo downloads to /public/models and list them in manifest.json.
const THREE_MODELS = 'https://threejs.org/examples/models';
const RPM_ANIMS = 'https://raw.githubusercontent.com/readyplayerme/animation-library/master';

export const BUILTIN_AVATARS = [
  {
    id: 'rpm',
    name: 'Leo',
    tag: 'Ready Player Me · 15 mocap dances',
    url: `${THREE_MODELS}/gltf/readyplayer.me.glb`,
    type: 'glb',
    family: 'rpm',
    rpmBody: 'masculine',
    accent: '#a78bfa',
    emoji: '🧑‍🎤',
  },
  {
    id: 'michelle',
    name: 'Michelle',
    tag: 'Mixamo · Samba',
    url: `${THREE_MODELS}/gltf/Michelle.glb`,
    type: 'glb',
    family: 'mixamo',
    accent: '#f472b6',
    emoji: '💃',
  },
  {
    id: 'xbot',
    name: 'X Bot',
    tag: 'Mixamo · procedural moves',
    url: `${THREE_MODELS}/gltf/Xbot.glb`,
    type: 'glb',
    family: 'mixamo',
    accent: '#38bdf8',
    emoji: '🤖',
  },
  {
    id: 'soldier',
    name: 'Soldier',
    tag: 'Mixamo · procedural moves',
    url: `${THREE_MODELS}/gltf/Soldier.glb`,
    type: 'glb',
    family: 'mixamo',
    accent: '#34d399',
    emoji: '🪖',
    // This export faces -Z; turn it toward the camera.
    rotationY: Math.PI,
  },
];

// Ready Player Me's mocap library: free to use, but only with Ready Player Me avatars (see its LICENSE),
// so these clips are offered for RPM characters only and fetched from the official repository.
const RPM_DANCES = ['M_Dances_001', 'M_Dances_002', 'M_Dances_003', 'M_Dances_004', 'M_Dances_005', 'M_Dances_006',
  'M_Dances_007', 'M_Dances_008', 'M_Dances_009', 'M_Dances_011', 'F_Dances_001', 'F_Dances_004', 'F_Dances_005',
  'F_Dances_006', 'F_Dances_007'];

export function rpmAnimationDefs(body = 'masculine') {
  return RPM_DANCES.map((file) => {
    const [, sex, num] = file.match(/^(\w)_Dances_0*(\d+)/);
    return {
      id: `rpm-${body}-${file}`,
      name: `Mocap ${sex}${num}`,
      clipName: `Mocap dance ${sex}${num}`,
      url: `${RPM_ANIMS}/${body}/glb/dance/${file}.glb`,
      type: 'glb',
      family: 'rpm',
      rpmOnly: true,
      dance: true,
    };
  });
}

export const TINTS = ['#ffffff', '#f472b6', '#a78bfa', '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#1f2937'];

export const ACCENTS = ['#a78bfa', '#38bdf8', '#f472b6', '#34d399', '#fbbf24', '#f87171', '#a3e635'];

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
      .map((entry, i) => {
        const dir = `${base}models/${encodeURI(entry.file.split('/').slice(0, -1).join('/'))}`.replace(/\/$/, '');
        return {
          id: `local-${entry.file}`,
          name: entry.name ?? entry.file.replace(/\.[^.]+$/, ''),
          tag: entry.tag ?? 'Local Mixamo',
          url: `${base}models/${encodeURI(entry.file)}`,
          type: typeFromName(entry.file),
          family: entry.family ?? 'mixamo',
          accent: entry.accent ?? ACCENTS[i % ACCENTS.length],
          emoji: entry.emoji ?? '🧍',
          rotationY: entry.rotationY,
          // Optional PBR texture set with outfit variants (see README).
          pbr: entry.pbr ? { ...entry.pbr, dir } : undefined,
        };
      });
  } catch {
    return [];
  }
}

// Reads /public/dances/manifest.json, e.g. [{ "name": "Hip Hop", "file": "hip-hop.fbx" }]: Mixamo dances
// downloaded as "FBX Binary, Without Skin" that should always be available.
export async function loadDanceManifest() {
  try {
    const base = import.meta.env.BASE_URL;
    const res = await fetch(`${base}dances/manifest.json`, { cache: 'no-store' });
    if (!res.ok) return [];
    const list = await res.json();
    return list
      .filter((entry) => entry.file && typeFromName(entry.file))
      .map((entry) => ({
        id: `dance-${entry.file}`,
        name: entry.name ?? entry.file.replace(/\.[^.]+$/, ''),
        clipName: entry.name ?? entry.file.replace(/\.[^.]+$/, ''),
        url: `${base}dances/${encodeURI(entry.file)}`,
        type: typeFromName(entry.file),
        family: entry.family ?? 'mixamo',
        dance: true,
      }));
  } catch {
    return [];
  }
}
