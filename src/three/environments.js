import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';

// Poly Haven HDRIs are CC0; the three.js ones ship with its examples.
const PH = (id) => `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/${id}_1k.hdr`;
const PH_THUMB = (id) => `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=320&height=180`;

export const ENVIRONMENTS = [
  { id: 'street', name: 'City Street', kind: 'hdri', hdr: PH('urban_street_01'), thumb: PH_THUMB('urban_street_01'), ground: 1.6, sun: 1.6, exposure: 0.9, rotation: 0.6, bloom: 0.6 },
  { id: 'plaza', name: 'City Plaza', kind: 'hdri', hdr: PH('potsdamer_platz'), thumb: PH_THUMB('potsdamer_platz'), ground: 1.7, sun: 2.2, exposure: 0.55, rotation: 0, bloom: 0.4 },
  { id: 'sunset', name: 'Golden Hour', kind: 'hdri', hdr: PH('industrial_sunset_02'), thumb: PH_THUMB('industrial_sunset_02'), ground: 1.7, sun: 2.4, exposure: 0.85, rotation: 0 },
  { id: 'park', name: 'Autumn Park', kind: 'hdri', hdr: PH('autumn_park'), thumb: PH_THUMB('autumn_park'), ground: 1.7, sun: 2.0, exposure: 0.9, rotation: 0 },
  { id: 'rooftop', name: 'Rooftop Night', kind: 'hdri', hdr: PH('rooftop_night'), thumb: PH_THUMB('rooftop_night'), ground: 1.8, sun: 0.4, exposure: 1.3, rotation: 0 },
  // Your own footage (added from a video file); lit by the street HDRI.
  { id: 'video', name: 'Your video', kind: 'video', hdr: PH('urban_street_01'), exposure: 1, bloom: 0.5 },
  { id: 'studio', name: 'Photo Studio', kind: 'studio', hdr: PH('studio_small_09'), gradient: 'linear-gradient(160deg,#f5f0e8,#cfc6b8)', exposure: 1 },
  { id: 'club', name: 'Neon Club', kind: 'club', hdr: PH('neon_photostudio'), gradient: 'radial-gradient(circle at 30% 30%,#ff2fb3,#3b0a63 45%,#07030f)', exposure: 1 },
  { id: 'synth', name: 'Synthwave', kind: 'synth', hdr: PH('studio_small_09'), gradient: 'linear-gradient(180deg,#1a0536,#7b1fa2 55%,#ff6ec7 70%,#120320)', exposure: 1, bloom: 0.6 },
];

const hdrCache = new Map();
// Equirectangular map: .hdr / .exr (HDR) or an ordinary 2:1 JPG/PNG panorama (LDR).
function loadHDR(url, format = 'hdr') {
  if (!hdrCache.has(url)) {
    const loader = format === 'exr' ? new EXRLoader() : format === 'ldr' ? new THREE.TextureLoader() : new HDRLoader();
    const p = loader.loadAsync(url).then((tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      if (format === 'ldr') tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    });
    hdrCache.set(url, p);
    p.catch(() => hdrCache.delete(url));
  }
  return hdrCache.get(url);
}

// Direction of the brightest region of an equirect HDR (upper hemisphere): where the sun is.
function findSun(tex) {
  let { data, width, height } = tex.image;
  if (!data) {
    // LDR panorama (an <img>): read a downscaled copy.
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.drawImage(tex.image, 0, 0, 256, 128);
    data = ctx.getImageData(0, 0, 256, 128).data;
    width = 256;
    height = 128;
  }
  const half = tex.type === THREE.HalfFloatType;
  const read = (i) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const stride = data.length / (width * height);
  let best = -1;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < height * 0.48; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * stride;
      const lum = 0.2126 * read(i) + 0.7152 * read(i + 1) + 0.0722 * read(i + 2);
      if (lum > best) (best = lum), (bx = x), (by = y);
    }
  }
  // Row 0 is the top of the image; three's equirect: u = atan2(z, x)/2π + ½, v = asin(y)/π + ½.
  const u = (bx + 0.5) / width;
  const v = 1 - (by + 0.5) / height;
  const lat = (v - 0.5) * Math.PI;
  const lon = (u - 0.5) * 2 * Math.PI;
  const dir = new THREE.Vector3(Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat));
  if (dir.y < 0.25) dir.y = 0.25;
  return dir.normalize();
}

const PALETTE = ['#ff2fb3', '#7c3aed', '#22d3ee', '#f59e0b', '#34d399', '#f43f5e'];

export async function buildEnvironment(def, ctx) {
  const tex = def.hdr ? await loadHDR(def.hdr, def.format) : null;
  const group = new THREE.Group();
  const env = { def, group, tex, update: () => {}, dispose: () => {} };

  if (def.kind === 'hdri') {
    const sky = new GroundedSkybox(tex, def.ground, 80, 96);
    sky.position.y = def.ground - 0.01;
    sky.userData.noAO = true;
    // Cap the visible sky's brightness so overcast skies don't flood the frame with bloom haze
    // (lighting still comes from the full-range environment map).
    sky.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        'outgoingLight = min(outgoingLight, vec3(1.15));\n#include <opaque_fragment>',
      );
    };
    group.add(sky);
    env.sky = sky;
    env.sunDir = findSun(tex);
    env.sunIntensity = def.sun;
    env.envIntensity = 1;
    env.background = null;
    env.dispose = () => sky.geometry.dispose();
    return env;
  }

  if (def.kind === 'video') {
    if (!ctx.video) throw new Error('No video background loaded');
    env.video = ctx.video;
    env.background = ctx.video.texture;
    env.sunDir = findSun(tex);
    env.sunIntensity = 1.6;
    env.envIntensity = 1;
    return env;
  }

  if (def.kind === 'studio') {
    env.envIntensity = 0.7;
    env.sunDir = new THREE.Vector3(0.6, 1.2, 0.9).normalize();
    env.sunIntensity = 2.2;
    const mat = new THREE.MeshStandardMaterial({ color: ctx.studioColor ?? '#e9e3da', roughness: 0.95 });
    const cyc = new THREE.Mesh(cycloramaGeometry(14, 7, 2.5), mat);
    cyc.position.z = -3.5;
    cyc.receiveShadow = true;
    group.add(cyc);
    env.background = new THREE.Color(ctx.studioColor ?? '#e9e3da');
    env.setColor = (c) => {
      mat.color.set(c);
      env.background.set(c);
    };
    const rimL = new THREE.SpotLight('#ffd3a8', 30, 12, 0.5, 0.6);
    rimL.position.set(-2.5, 3, -2.5);
    const rimR = new THREE.SpotLight('#a8d8ff', 30, 12, 0.5, 0.6);
    rimR.position.set(2.5, 3, -2.5);
    group.add(rimL, rimR);
    env.dispose = () => (cyc.geometry.dispose(), mat.dispose());
    return env;
  }

  if (def.kind === 'club') return buildClub(env);
  return buildSynthwave(env);
}

function cycloramaGeometry(width, height, radius) {
  // Floor → quarter-circle cove → wall, as one seamless surface.
  const shape = [];
  const steps = 16;
  shape.push(new THREE.Vector2(10, 0));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    shape.push(new THREE.Vector2(radius - Math.sin(a) * radius, radius - Math.cos(a) * radius));
  }
  shape.push(new THREE.Vector2(0, height));
  const pts = shape.map((p) => new THREE.Vector3(0, p.y, p.x));
  const geo = new THREE.BufferGeometry();
  const pos = [];
  const idx = [];
  const cols = 2;
  pts.forEach((p) => {
    for (let c = 0; c < cols; c++) pos.push((c - 0.5) * width, p.y, p.z);
  });
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Normals face the dancer.
  const n = geo.getAttribute('normal');
  for (let i = 0; i < n.count; i++) if (n.getZ(i) < 0 || n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return geo;
}

function buildClub(env) {
  const { group } = env;
  env.envIntensity = 0.25;
  env.sunDir = new THREE.Vector3(0.3, 1, 0.6).normalize();
  env.sunIntensity = 0.6;
  env.background = new THREE.Color('#05030a');
  env.fog = new THREE.FogExp2('#07040f', 0.05);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 64),
    new THREE.MeshStandardMaterial({ color: '#0b0a12', roughness: 0.22, metalness: 0.6 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // LED dance floor.
  const n = 9;
  const tile = 0.7;
  const tiles = new THREE.InstancedMesh(
    new THREE.BoxGeometry(tile * 0.94, 0.02, tile * 0.94),
    new THREE.MeshBasicMaterial({ toneMapped: false }),
    n * n,
  );
  const m = new THREE.Matrix4();
  for (let i = 0; i < n * n; i++) {
    m.makeTranslation(((i % n) - (n - 1) / 2) * tile, -0.009, (Math.floor(i / n) - (n - 1) / 2) * tile);
    tiles.setMatrixAt(i, m);
    tiles.setColorAt(i, new THREE.Color(0));
  }
  group.add(tiles);

  // Back wall of EQ bars.
  const bars = 18;
  const eq = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, 1, 0.08), new THREE.MeshBasicMaterial({ toneMapped: false }), bars);
  for (let i = 0; i < bars; i++) eq.setColorAt(i, new THREE.Color(0));
  group.add(eq);

  // Moving heads with fake volumetric beams.
  const heads = [-3, -1, 1, 3].map((x, i) => {
    const light = new THREE.SpotLight('#ffffff', 60, 18, 0.32, 0.5, 1.4);
    light.position.set(x, 5.5, -1.5 + (i % 2) * 1.5);
    const target = new THREE.Object3D();
    group.add(light, target);
    light.target = target;
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 6, 32, 1, true).translate(0, -3, 0),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.03, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    beam.position.copy(light.position);
    group.add(beam);
    return { light, target, beam };
  });

  const color = new THREE.Color();
  env.update = (t, beat, grid, fx) => {
    const k = Math.floor(beat);
    const u = beat - k;
    const bar = Math.floor((beat - (grid?.downbeat ?? 0)) / 4);
    const hit = Math.exp(-5 * Math.max(0, u)) * fx.lights;
    const pulse = grid ? grid.pulseAt(t) : 0;
    const pal = (j) => PALETTE[((j % PALETTE.length) + PALETTE.length) % PALETTE.length];
    for (let i = 0; i < n * n; i++) {
      const x = i % n;
      const z = Math.floor(i / n);
      const on = (x + z + k) % 3 === 0 || (bar % 2 === 0 && (x === z || x === n - 1 - z));
      color.set(pal(bar + ((x + z) % 2))).multiplyScalar(on ? 0.25 + 1.6 * hit : 0.03);
      tiles.setColorAt(i, color);
    }
    tiles.instanceColor.needsUpdate = true;
    for (let i = 0; i < bars; i++) {
      const h = 0.4 + 3.2 * (0.35 + 0.65 * pulse) * (0.5 + 0.5 * Math.sin(i * 1.7 + k * 2.3)) * fx.lights;
      m.compose(new THREE.Vector3((i - (bars - 1) / 2) * 0.55, h / 2, -6), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
      eq.setMatrixAt(i, m);
      color.set(pal(bar + 2)).lerp(new THREE.Color('#ffffff'), i % 5 === 0 ? 0.4 : 0).multiplyScalar(0.6 + pulse);
      eq.setColorAt(i, color);
    }
    eq.instanceMatrix.needsUpdate = true;
    eq.instanceColor.needsUpdate = true;
    heads.forEach((h, i) => {
      const a = beat * 0.25 * Math.PI + (i * Math.PI) / 2;
      h.target.position.set(Math.sin(a) * 2.5, 0, Math.cos(a * 0.7) * 2);
      h.light.color.set(pal(bar + i));
      h.light.intensity = 40 + 120 * hit;
      h.beam.material.color.set(pal(bar + i));
      h.beam.material.opacity = 0.02 + 0.04 * hit;
      h.beam.lookAt(h.target.position);
      h.beam.rotateX(-Math.PI / 2);
    });
  };
  env.dispose = () => group.traverse((o) => (o.geometry?.dispose(), o.material?.dispose?.()));
  return env;
}

function buildSynthwave(env) {
  const { group } = env;
  env.envIntensity = 0.35;
  env.sunDir = new THREE.Vector3(-0.4, 0.8, -1).normalize();
  env.sunIntensity = 1.2;
  env.background = new THREE.Color('#12031f');
  env.fog = new THREE.Fog('#2a0845', 12, 60);

  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.ShaderMaterial({
      uniforms: { scroll: { value: 0 }, glow: { value: 1 } },
      fog: false,
      vertexShader: 'varying vec2 vUv; varying vec3 vPos; void main(){ vUv = uv; vPos = (modelMatrix*vec4(position,1.)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vPos,1.); }',
      fragmentShader: `uniform float scroll; uniform float glow; varying vec3 vPos;
        void main(){
          vec2 p = vPos.xz * 0.6 + vec2(0., scroll);
          vec2 g = abs(fract(p) - .5) / fwidth(p);
          float line = 1. - min(min(g.x, g.y), 1.);
          float fade = exp(-length(vPos.xz) * 0.035);
          vec3 base = vec3(0.04, 0.0, 0.08);
          vec3 col = mix(base, vec3(1.0, 0.2, 0.85) * (1.5 + glow), line * fade);
          gl_FragColor = vec4(col, 1.);
        }`,
    }),
  );
  grid.rotation.x = -Math.PI / 2;
  group.add(grid);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.ShadowMaterial({ opacity: 0.6 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.003;
  shadow.receiveShadow = true;
  group.add(shadow);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 top = vec3(0.05, 0.0, 0.12), mid = vec3(0.45, 0.05, 0.55), hor = vec3(1.0, 0.35, 0.6);
          vec3 col = mix(hor, mid, smoothstep(0.0, 0.18, h));
          col = mix(col, top, smoothstep(0.18, 0.6, h));
          gl_FragColor = vec4(col, 1.);
        }`,
    }),
  );
  sky.userData.noAO = true;
  group.add(sky);

  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(12, 64),
    new THREE.ShaderMaterial({
      transparent: true,
      fog: false,
      uniforms: { shift: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform float shift; varying vec2 vUv;
        void main(){
          vec3 col = mix(vec3(1.0, 0.25, 0.55), vec3(1.0, 0.85, 0.3), vUv.y);
          float stripes = step(0.5, fract(vUv.y * 14.0 - shift)) + step(0.55, vUv.y);
          gl_FragColor = vec4(col * 1.3, clamp(stripes, 0., 1.));
        }`,
    }),
  );
  sun.position.set(0, 7, -70);
  sun.userData.noAO = true;
  group.add(sun);

  const rim1 = new THREE.DirectionalLight('#ff3fd1', 2.5);
  rim1.position.set(-3, 2, -3);
  const rim2 = new THREE.DirectionalLight('#38e8ff', 2.5);
  rim2.position.set(3, 2, -3);
  group.add(rim1, rim2);

  env.update = (t, beat, gridData, fx) => {
    grid.material.uniforms.scroll.value = beat * 0.5;
    const pulse = gridData ? gridData.pulseAt(t) : 0;
    grid.material.uniforms.glow.value = pulse * 2 * fx.lights;
    sun.material.uniforms.shift.value = t * 0.15;
    rim1.intensity = 2 + 4 * pulse * fx.lights;
    rim2.intensity = 2 + 4 * pulse * fx.lights;
  };
  env.dispose = () => group.traverse((o) => (o.geometry?.dispose(), o.material?.dispose?.()));
  return env;
}

// Environment definition for a 360° panorama the user uploaded.
export function panoramaDef(file, url) {
  const ext = file.name.split('.').pop().toLowerCase();
  const format = ext === 'exr' ? 'exr' : ext === 'hdr' ? 'hdr' : 'ldr';
  return {
    id: 'pano',
    name: file.name.replace(/\.[^.]+$/, ''),
    kind: 'hdri',
    hdr: url,
    format,
    ldr: format === 'ldr',
    ground: 1.7,
    sun: format === 'ldr' ? 1.4 : 2,
    exposure: format === 'ldr' ? 1 : 0.9,
    rotation: 0,
    bloom: 0.6,
    custom: true,
  };
}
