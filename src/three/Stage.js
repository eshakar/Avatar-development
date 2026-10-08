import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { loadAsset } from './loadAvatar.js';
import { applyLook, disposeLook, listParts } from './materials.js';
import { buildEnvironment, ENVIRONMENTS } from './environments.js';
import { cameraAt, DEFAULT_CAMERA, planShots, verticalFov } from './director.js';
import { coverFit } from './videoBackground.js';
import { CharacterRig } from '../dance/CharacterRig.js';
import { Choreographer } from '../dance/Choreographer.js';

export const GRADES = {
  natural: { contrast: 1.03, saturation: 1.05, warmth: 0.05, split: 0 },
  film: { contrast: 1.08, saturation: 0.92, warmth: 0.55, split: 0.25 },
  teal: { contrast: 1.12, saturation: 1.12, warmth: 0.2, split: 0.7 },
  vivid: { contrast: 1.12, saturation: 1.32, warmth: 0.1, split: 0 },
  mono: { contrast: 1.18, saturation: 0, warmth: 0, split: 0 },
};

export const DEFAULT_FX = {
  grade: 'natural',
  bloom: 0.35,
  grain: 0.3,
  vignette: 0.4,
  chroma: 0.25,
  flash: 0.15,
  lights: 0.8,
  ao: true,
  exposure: 1,
  sun: 1,
  envRotation: 0,
  studioColor: '#e9e3da',
  // Matching the 3D camera to video footage.
  plateHeight: 1.5,
  plateTilt: -6,
  plateDistance: 4.5,
  plateX: 0,
};

// How much each shot punches into real footage (video backgrounds can't change camera angle).
const PLATE_ZOOM = { full: 1, wide: 1, medium: 1.4, close: 1.9, left: 1.15, right: 1.15, low: 1.1, high: 1.2 };

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grain: { value: 0.3 },
    vignette: { value: 0.4 },
    chroma: { value: 0.25 },
    contrast: { value: 1 },
    saturation: { value: 1 },
    warmth: { value: 0 },
    split: { value: 0 },
    flash: { value: 0 },
    aspect: { value: 1 },
    crop: { value: new THREE.Vector3(0.5, 0.5, 1) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time, grain, vignette, chroma, contrast, saturation, warmth, split, flash, aspect;
    uniform vec3 crop;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      // Punch-in crop (video backgrounds): zoom the whole frame around crop.xy.
      vec2 uv = crop.xy + c / crop.z;
      float r2 = dot(c, c);
      float ca = chroma * 0.012 * r2;
      vec3 col = vec3(texture2D(tDiffuse, uv + c * ca).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - c * ca).b);
      col *= vec3(1.0 + warmth * 0.07, 1.0, 1.0 - warmth * 0.07);
      col = (col - 0.5) * contrast + 0.5;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      col += split * 0.06 * mix(vec3(-0.4, 0.15, 0.35), vec3(0.45, 0.1, -0.35), smoothstep(0.15, 0.85, l));
      col += flash;
      vec2 vc = c * vec2(aspect, 1.0) / max(aspect, 1.0);
      col *= mix(1.0, smoothstep(0.95, 0.25, length(vc) * 1.35), vignette);
      col += (hash(vUv * 1931.0 + fract(time * 7.13)) - 0.5) * grain * 0.09;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export class Stage {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.cb = callbacks;
    this.aspect = 9 / 16;
    this.fx = { ...DEFAULT_FX };
    this.cameraOpts = { ...DEFAULT_CAMERA };
    this.shotPlan = [];
    this.grid = null;
    this.hero = null;
    this.env = null;
    this.exporting = false;
    this.getTime = () => 0;
    this.isPlaying = () => false;
    this.video = null;
    this.customEnvs = new Map();
    this.smile = 0.25;
    this.camState = { pos: new THREE.Vector3(), target: new THREE.Vector3(), fov: 40, roll: 0 };

    this.#initRenderer();
    this.#initScene();
    this.#initPost();

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 1, 0);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.enabled = false;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.#loop());
  }

  #initRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'stage-canvas';
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;
  }

  #initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0b0b12');
    this.camera = new THREE.PerspectiveCamera(40, this.aspect, 0.05, 200);
    this.camera.position.set(0, 1.4, 4);

    this.sun = new THREE.DirectionalLight('#fff4e5', 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -2.5, right: 2.5, top: 3, bottom: -1.5, near: 0.5, far: 20 });
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target);

    // A soft shadow catcher for the HDRI ground (the projected skybox doesn't receive shadows).
    this.shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.ShadowMaterial({ opacity: 0.45 }));
    this.shadowCatcher.rotation.x = -Math.PI / 2;
    this.shadowCatcher.position.y = 0.002;
    this.shadowCatcher.receiveShadow = true;
    this.scene.add(this.shadowCatcher);

    // Bounce light from below/front so faces don't go dark under a high sun.
    this.fill = new THREE.HemisphereLight('#ffffff', '#806a58', 0.25);
    this.scene.add(this.fill);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
  }

  #initPost() {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.gtao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 16 });
    this.gtao.blendIntensity = 0.9;
    // Keep sky domes out of the AO depth pass, otherwise the whole background gets "occluded".
    const hide = this.gtao._overrideVisibility.bind(this.gtao);
    this.gtao._overrideVisibility = () => {
      hide();
      this.scene.traverse((o) => {
        if (o.userData.noAO && o.visible) {
          o.visible = false;
          this.gtao._visibilityCache.push(o);
        }
      });
    };
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.55, 0.9);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);
  }

  // ------------------------------------------------------------------ layout

  setAspect(aspect) {
    this.aspect = aspect;
    this.resize();
  }

  resize() {
    if (this.exporting) return;
    const { clientWidth: cw, clientHeight: ch } = this.container;
    if (!cw || !ch) return;
    let w = cw;
    let h = cw / this.aspect;
    if (h > ch) (h = ch), (w = ch * this.aspect);
    w = Math.floor(w);
    h = Math.floor(h);
    const canvas = this.renderer.domElement;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.#setSize(w, h, Math.min(window.devicePixelRatio, 1.5));
    this.cb.onFrameSize?.({ width: w, height: h });
  }

  #setSize(w, h, ratio) {
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.grade.uniforms.aspect.value = w / h;
    this.#fitVideo();
  }

  #fitVideo() {
    const v = this.env?.video;
    if (v && this.scene.background === v.texture) coverFit(v.texture, v.width / v.height, this.aspect);
  }

  // User-supplied 360° panoramas.
  registerEnvironment(def) {
    this.customEnvs.set(def.id, def);
  }

  setVideo(video) {
    this.video = video;
  }

  // ------------------------------------------------------------------ environment

  async setEnvironment(id) {
    const def = ENVIRONMENTS.find((e) => e.id === id) ?? this.customEnvs.get(id) ?? ENVIRONMENTS[0];
    const token = (this.envToken = (this.envToken ?? 0) + 1);
    this.cb.onLoading?.({ active: true, label: def.name });
    let env;
    try {
      env = await buildEnvironment(def, { studioColor: this.fx.studioColor, video: this.video });
    } catch (err) {
      console.error(err);
      this.cb.onError?.(`Couldn't load the ${def.name} background`);
      this.cb.onLoading?.({ active: false });
      return;
    }
    if (token !== this.envToken) return env.dispose();

    if (this.env) {
      this.scene.remove(this.env.group);
      this.env.dispose();
      this.envTexture?.dispose();
    }
    this.env = env;
    this.scene.add(env.group);
    this.envTexture = env.tex ? this.pmrem.fromEquirectangular(env.tex).texture : null;
    this.scene.environment = this.envTexture;
    this.scene.background = env.background ?? null;
    this.scene.fog = env.fog ?? null;
    this.shadowCatcher.visible = def.kind === 'hdri' || def.kind === 'video';
    this.#fitVideo();
    this.#applyFx();
    this.cb.onLoading?.({ active: false });
  }

  // ------------------------------------------------------------------ avatar

  async setAvatar(def) {
    const token = (this.avatarToken = (this.avatarToken ?? 0) + 1);
    this.cb.onLoading?.({ active: true, label: def.name });
    let asset;
    try {
      asset = await loadAsset(def, (p) => this.cb.onLoading?.({ active: true, label: def.name, progress: p }));
    } catch (err) {
      console.error(err);
      this.cb.onError?.(`Couldn't load ${def.name}`);
      this.cb.onLoading?.({ active: false });
      return null;
    }
    if (token !== this.avatarToken) return null;
    if (this.hero) {
      this.scene.remove(this.hero.holder);
      disposeLook(this.hero.model);
    }

    const model = cloneSkinned(asset.root);
    const fit = new THREE.Group();
    fit.scale.setScalar(asset.scale);
    fit.position.copy(asset.offset);
    fit.rotation.y = def.rotationY ?? 0;
    fit.add(model);
    const holder = new THREE.Group();
    holder.add(fit);
    this.scene.add(holder);

    const rig = new CharacterRig(model, { rotationY: def.rotationY ?? 0 });
    const choreo = new Choreographer(rig);
    if (this.hero?.choreo) choreo.options = { ...this.hero.choreo.options, overrides: {} };
    choreo.setGrid(this.grid);
    const morphs = [];
    model.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary?.mouthSmile !== undefined) morphs.push(o);
    });
    this.hero = { def, asset, model, holder, rig, choreo, morphs };
    this.cb.onLoading?.({ active: false });
    return { asset, rig, parts: listParts(model) };
  }

  setLook(look) {
    if (this.hero) applyLook(this.hero.model, look.style, look.tint, look.parts);
  }

  // Swap the colour map of a PBR avatar's outfit variant, then re-apply the current look on top.
  setVariantMap(map, look) {
    if (!this.hero) return;
    this.hero.model.traverse((o) => {
      if (!o.isMesh) return;
      const base = o.userData.baseMaterial ?? o.material;
      (Array.isArray(base) ? base : [base]).forEach((m) => {
        m.map = map;
        m.needsUpdate = true;
      });
    });
    this.setLook(look);
  }

  setSmile(v) {
    this.smile = v;
  }

  // ------------------------------------------------------------------ music / dance / camera / fx

  setGrid(grid) {
    this.grid = grid;
    this.hero?.choreo.setGrid(grid);
    this.shotPlan = planShots(grid, this.cameraOpts);
  }

  setCamera(patch) {
    Object.assign(this.cameraOpts, patch);
    this.shotPlan = planShots(this.grid, this.cameraOpts);
    const free = this.cameraOpts.mode === 'free';
    if (free && !this.controls.enabled) this.controls.target.copy(this.camState.target);
    this.controls.enabled = free;
  }

  setFx(patch) {
    Object.assign(this.fx, patch);
    this.#applyFx();
  }

  #applyFx() {
    const fx = this.fx;
    const g = GRADES[fx.grade] ?? GRADES.natural;
    const u = this.grade.uniforms;
    u.grain.value = fx.grain;
    u.vignette.value = fx.vignette;
    u.chroma.value = fx.chroma;
    u.contrast.value = g.contrast;
    u.saturation.value = g.saturation;
    u.warmth.value = g.warmth;
    u.split.value = g.split;
    this.gtao.enabled = fx.ao;
    const env = this.env;
    this.renderer.toneMappingExposure = fx.exposure * (env?.def.exposure ?? 1);
    // Neutral keeps real footage looking like itself; ACES suits HDR scenes.
    this.renderer.toneMapping = env?.def.kind === 'video' || env?.def.ldr ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    if (!env) return;
    const rot = fx.envRotation + (env.def.rotation ?? 0);
    this.scene.environmentRotation.y = rot;
    this.scene.environmentIntensity = env.envIntensity;
    if (env.sky) env.sky.rotation.y = rot;
    const sunDir = env.sunDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this.sun.position.copy(sunDir.multiplyScalar(8));
    this.sun.intensity = env.sunIntensity * fx.sun;
    this.fill.intensity = env.def.kind === 'hdri' ? 0.25 : 0.1;
    env.setColor?.(fx.studioColor);
  }

  // ------------------------------------------------------------------ rendering

  #loop() {
    if (this.exporting) return;
    const t = this.getTime();
    this.cb.onFrame?.(t);
    this.renderAt(t);
  }

  // Everything on screen is a function of t, so preview and export are identical.
  renderAt(t) {
    const grid = this.grid;
    const beat = grid ? grid.beatAt(t) : t * 2;
    const seg = this.hero?.choreo.evaluate(t);
    this.currentSegment = seg;

    for (const m of this.hero?.morphs ?? []) {
      m.morphTargetInfluences[m.morphTargetDictionary.mouthSmile] = this.smile;
    }

    const plate = this.env?.def.kind === 'video';
    if (plate) {
      if (!this.exporting) this.env.video.sync(t, this.isPlaying());
      this.#plateCamera(t, beat);
    } else if (this.cameraOpts.mode === 'free' && !this.exporting) {
      this.grade.uniforms.crop.value.set(0.5, 0.5, 1);
      this.controls.update();
    } else {
      this.grade.uniforms.crop.value.set(0.5, 0.5, 1);
      const cam = cameraAt(t, grid, this.cameraOpts, this.aspect, this.shotPlan, this.camState, this.#followPoint());
      this.camera.position.copy(cam.pos);
      this.camera.up.set(Math.sin(cam.roll), Math.cos(cam.roll), 0);
      this.camera.lookAt(cam.target);
      this.camera.fov = cam.fov;
      this.camera.updateProjectionMatrix();
    }

    const pulse = grid ? grid.pulseAt(t) : 0;
    this.bloom.strength = this.fx.bloom * (this.env?.def.bloom ?? 1) * (1 + 0.5 * pulse * this.fx.lights);
    const u = beat - Math.floor(beat);
    const down = grid && beat >= 0 && beat <= grid.lastBeat && grid.isDownbeat(Math.floor(beat));
    this.grade.uniforms.flash.value = down ? this.fx.flash * 0.12 * Math.exp(-9 * u) : 0;
    this.grade.uniforms.time.value = t;
    this.env?.update(t, beat, grid, this.fx);

    this.composer.render();
  }

  // Video backgrounds: the 3D camera stays matched to the footage; shots become punch-in crops of the
  // whole frame (footage + dancer together), cut on downbeats like an editor would.
  #plateCamera(t, beat) {
    const fx = this.fx;
    const cam = this.camera;
    cam.fov = verticalFov(this.aspect);
    cam.position.set(-fx.plateX, fx.plateHeight, fx.plateDistance);
    cam.up.set(0, 1, 0);
    cam.lookAt(-fx.plateX, fx.plateHeight + Math.tan(THREE.MathUtils.degToRad(fx.plateTilt)) * fx.plateDistance, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    const o = this.cameraOpts;
    let shot = o.shot;
    if (o.mode === 'auto') shot = (this.shotPlan.find((b) => beat >= b.start && beat < b.end) ?? {}).shot ?? 'full';
    let zoom = PLATE_ZOOM[shot] ?? 1;
    const grid = this.grid;
    if (grid && o.punch > 0 && beat >= 0 && beat <= grid.lastBeat + 1) {
      const u = beat - Math.floor(beat);
      zoom *= 1 + o.punch * 0.06 * Math.exp(-7 * u) * (grid.isDownbeat(Math.floor(beat)) ? 1 : 0.5);
    }
    let cx = 0.5;
    let cy = 0.5;
    const f = this.#followPoint();
    if (f && zoom > 1.001) {
      const p = (zoom > 1.5 ? f.head : f.hips).clone().project(cam);
      cx = 0.5 + p.x * 0.5;
      cy = 0.5 + p.y * 0.5;
    }
    const k = 0.5 / zoom;
    const shake = o.shake * 0.004;
    cx = Math.min(1 - k, Math.max(k, cx + Math.sin(t * 1.3) * shake));
    cy = Math.min(1 - k, Math.max(k, cy + Math.sin(t * 1.7 + 1) * shake));
    this.grade.uniforms.crop.value.set(cx, cy, zoom);
  }

  // Where the dancer is right now (pose is already applied for this t), for the camera to track.
  #followPoint() {
    const hero = this.hero;
    if (!hero) return null;
    hero.holder.updateMatrixWorld(true);
    const { rig } = hero;
    const head = rig.bones[rig.byCanon.get('Head') ?? rig.hips];
    this._follow ??= { hips: new THREE.Vector3(), head: new THREE.Vector3() };
    rig.bones[rig.hips].getWorldPosition(this._follow.hips);
    head.getWorldPosition(this._follow.head);
    return this._follow;
  }

  // ------------------------------------------------------------------ export

  beginExport(width, height, times = []) {
    this.exporting = true;
    this.savedRatio = this.renderer.getPixelRatio();
    this.#setSize(width, height, 1);
    const v = this.env?.def.kind === 'video' ? this.env.video : null;
    if (v) {
      // The video decoder already crops each frame to the export size; a photo is cropped like in preview.
      this.scene.background = v.beginExport(times, width, height);
      if (v.static) coverFit(this.scene.background, v.width / v.height, width / height);
      else coverFit(this.scene.background, 1, 1, true);
    }
    return this.renderer.domElement;
  }

  // Must be awaited before renderAt() for each exported frame (decodes the matching video frame).
  async prepareFrame() {
    const v = this.env?.def.kind === 'video' ? this.env.video : null;
    if (v) await v.nextExportFrame();
  }

  endExport() {
    const v = this.env?.def.kind === 'video' ? this.env.video : null;
    if (v) {
      v.endExport();
      this.scene.background = v.texture;
    }
    this.exporting = false;
    this.resize();
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.env?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export { ENVIRONMENTS, verticalFov };
