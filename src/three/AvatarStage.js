import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import gsap from 'gsap';
import { loadAsset } from './loadAvatar.js';
import { AnimationLibrary } from './animationLibrary.js';
import { applyLook, disposeLook, LOOK_STYLES } from './materials.js';

export const CAMERA_PRESETS = {
  front: { position: [0, 1.45, 4.4], target: [0, 1, 0] },
  closeup: { position: [0.35, 1.6, 1.7], target: [0, 1.45, 0] },
  side: { position: [4.2, 1.3, 0.8], target: [0, 0.95, 0] },
  top: { position: [0.01, 6.5, 2.4], target: [0, 0.5, 0] },
  crowd: { position: [0, 5.2, 12.5], target: [0, 0.7, 0] },
};

const CROWD_TINTS = ['#ffffff', '#ff4d8d', '#7c5cff', '#22d3ee', '#22c55e', '#f59e0b', '#f1f5f9'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export class AvatarStage {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.cb = callbacks;
    this.library = new AnimationLibrary();
    this.timer = new THREE.Timer();
    this.look = { style: 'original', tint: '#ffffff' };
    this.hero = null;
    this.crowd = [];
    this.loadToken = 0;
    this.crowdToken = 0;
    this.disposed = false;

    this.initRenderer();
    this.initScene();
    this.initControls();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    // Intro: sweep in from far away.
    this.camera.position.set(0, 4.5, 14);
    this.flyTo('front', 2.4);

    this.renderer.setAnimationLoop(() => this.tick());
  }

  initRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'stage-canvas';
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;
  }

  initScene() {
    const scene = new THREE.Scene();
    this.scene = scene;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xc7d6ff, 0x1a1024, 0.9));

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 7, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 25 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    scene.add(key);

    this.rim = new THREE.DirectionalLight(0x7c5cff, 3);
    this.rim.position.set(-4, 3, -5);
    scene.add(this.rim);

    // Floor: soft radial glow, shadow catcher and a polar grid.
    const floorGlow = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshBasicMaterial({
        color: 0x1d1b3a,
        alphaMap: makeRadialTexture(),
        transparent: true,
        depthWrite: false,
      }),
    );
    floorGlow.rotation.x = -Math.PI / 2;
    scene.add(floorGlow);

    const shadowCatcher = new THREE.Mesh(
      new THREE.CircleGeometry(12, 64),
      new THREE.ShadowMaterial({ opacity: 0.38 }),
    );
    shadowCatcher.rotation.x = -Math.PI / 2;
    shadowCatcher.position.y = 0.001;
    shadowCatcher.receiveShadow = true;
    scene.add(shadowCatcher);

    const grid = new THREE.PolarGridHelper(12, 16, 10, 64, 0x3b3570, 0x24213f);
    grid.material.transparent = true;
    grid.material.opacity = 0.35;
    grid.position.y = 0.002;
    scene.add(grid);

    // Hero pedestal ring + shockwave used on avatar swaps.
    this.ringMaterial = new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.85 });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.68, 96), this.ringMaterial);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.004;
    scene.add(this.ring);

    this.shockMaterial = new THREE.MeshBasicMaterial({
      color: 0x7c5cff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.shock = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.75, 96), this.shockMaterial);
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.position.y = 0.005;
    scene.add(this.shock);

    // Ambient floating particles.
    const count = 500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 2 + Math.random() * 10;
      const a = Math.random() * Math.PI * 2;
      positions.set([Math.cos(a) * r, Math.random() * 7, Math.sin(a) * r], i * 3);
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particleMaterial = new THREE.PointsMaterial({
      color: 0x7c5cff,
      size: 0.035,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.particles = new THREE.Points(particleGeometry, this.particleMaterial);
    scene.add(this.particles);
  }

  initControls() {
    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.2;
    controls.maxDistance = 22;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.autoRotateSpeed = 1.6;
    controls.target.set(0, 1, 0);
    this.controls = controls;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Pull back a little on portrait screens so the avatar fits.
    this.camera.fov = w / h < 0.8 ? 48 : 35;
    this.camera.updateProjectionMatrix();
  }

  tick() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.05);
    this.hero?.mixer.update(dt);
    for (const member of this.crowd) member.mixer.update(dt);
    this.particles.rotation.y += dt * 0.03;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- avatars

  instantiate(asset, look = this.look) {
    const model = cloneSkinned(asset.root);
    const fit = new THREE.Group();
    fit.scale.setScalar(asset.scale);
    fit.position.copy(asset.offset);
    fit.rotation.y = asset.def.rotationY ?? 0;
    fit.add(model);
    const holder = new THREE.Group();
    holder.add(fit);
    applyLook(model, look.style, look.tint);
    return { holder, model, asset, mixer: new THREE.AnimationMixer(model), action: null, clipName: null };
  }

  retire(instance, delay = 0) {
    const { holder } = instance;
    gsap.killTweensOf([holder.scale, holder.rotation, holder.position]);
    gsap.to(holder.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.35, delay, ease: 'back.in(2)' });
    gsap.to(holder.rotation, {
      y: holder.rotation.y + Math.PI,
      duration: 0.35,
      delay,
      ease: 'power2.in',
      onComplete: () => {
        this.scene.remove(holder);
        instance.mixer.stopAllAction();
        disposeLook(instance.model);
      },
    });
  }

  registerAnimations(asset) {
    const added = this.library.register(asset);
    if (added.length) this.emitLibrary();
    return added;
  }

  emitLibrary() {
    if (!this.disposed) this.cb.onLibrary?.(this.library.list(this.hero?.asset));
  }

  async showAvatar(def) {
    const token = ++this.loadToken;
    const report = (state) => token === this.loadToken && this.cb.onLoading?.(state);
    report({ active: true, progress: 0, label: def.name });

    let asset;
    try {
      asset = await loadAsset(def, (progress) => report({ active: true, progress, label: def.name }));
    } catch (err) {
      console.error(err);
      report({ active: false });
      if (token === this.loadToken) this.cb.onError?.(`Couldn't load ${def.name}`);
      return;
    }
    if (token !== this.loadToken || this.disposed) return;

    this.registerAnimations(asset);
    const previous = this.hero;
    if (previous) this.retire(previous);

    const hero = this.instantiate(asset);
    this.hero = hero;
    this.scene.add(hero.holder);

    // GSAP entrance: spin up out of the pedestal.
    hero.holder.scale.setScalar(0.001);
    hero.holder.rotation.y = -Math.PI * 1.5;
    const delay = previous ? 0.25 : 0;
    gsap.to(hero.holder.scale, { x: 1, y: 1, z: 1, duration: 1.2, delay, ease: 'elastic.out(1, 0.55)' });
    gsap.to(hero.holder.rotation, { y: 0, duration: 1.3, delay, ease: 'power3.out' });
    this.pulseRing(delay);

    this.playClip(this.defaultClipFor(asset));
    this.emitLibrary();
    report({ active: false });
  }

  defaultClipFor(asset) {
    const native = asset.animations.map((c) => c.name);
    const usable = this.library.list(asset).filter((c) => c.compatible).map((c) => c.name);
    return (
      native.find((n) => /idle/i.test(n)) ??
      native[0] ??
      usable.find((n) => /idle/i.test(n)) ??
      usable[0] ??
      null
    );
  }

  // Loads a file without showing it, e.g. to inspect a user upload.
  async registerAsset(def) {
    const asset = await loadAsset(def);
    const added = this.registerAnimations(asset);
    return { hasMesh: asset.hasMesh, added };
  }

  // Background-load other avatars so their clips join the shared library.
  async preload(defs) {
    if (this.preloadStarted) return;
    this.preloadStarted = true;
    for (const def of defs) {
      if (this.disposed) return;
      try {
        this.registerAnimations(await loadAsset(def));
      } catch {
        /* surfaced when the user actually selects it */
      }
    }
  }

  playClip(name) {
    const hero = this.hero;
    if (!hero || !name) return;
    const clip = this.library.clipFor(name, hero.asset);
    if (!clip?.tracks.length) return;
    const action = hero.mixer.clipAction(clip);
    if (hero.action === action) return;
    action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(0.45).play();
    hero.action?.fadeOut(0.45);
    hero.action = action;
    hero.clipName = name;
    this.cb.onClip?.(name);
  }

  setLook(style, tint) {
    this.look = { style, tint };
    if (!this.hero) return;
    applyLook(this.hero.model, style, tint);
    gsap.fromTo(
      this.hero.holder.scale,
      { x: 1.08, y: 0.9, z: 1.08 },
      { x: 1, y: 1, z: 1, duration: 0.8, ease: 'elastic.out(1, 0.35)', overwrite: true },
    );
    this.pulseRing();
  }

  pulseRing(delay = 0) {
    gsap.fromTo(this.ring.scale, { x: 0.2, y: 0.2 }, { x: 1, y: 1, duration: 0.9, delay, ease: 'expo.out' });
    gsap.fromTo(this.shock.scale, { x: 1, y: 1 }, { x: 4.5, y: 4.5, duration: 1.1, delay, ease: 'power2.out' });
    gsap.fromTo(this.shockMaterial, { opacity: 0.9 }, { opacity: 0, duration: 1.1, delay, ease: 'power2.out' });
  }

  setAccent(hex) {
    const c = new THREE.Color(hex);
    for (const color of [this.rim.color, this.ringMaterial.color, this.shockMaterial.color, this.particleMaterial.color]) {
      gsap.to(color, { r: c.r, g: c.g, b: c.b, duration: 0.9, ease: 'power2.out' });
    }
  }

  // ---------------------------------------------------------------- camera

  flyTo(presetName, duration = 1.4) {
    const preset = CAMERA_PRESETS[presetName];
    if (!preset) return;
    const [px, py, pz] = preset.position;
    const [tx, ty, tz] = preset.target;
    gsap.to(this.camera.position, { x: px, y: py, z: pz, duration, ease: 'power3.inOut', overwrite: true });
    gsap.to(this.controls.target, { x: tx, y: ty, z: tz, duration, ease: 'power3.inOut', overwrite: true });
  }

  setAutoRotate(enabled) {
    this.controls.autoRotate = enabled;
  }

  // ---------------------------------------------------------------- crowd

  async spawnCrowd(defs, count) {
    const token = ++this.crowdToken;
    this.clearCrowd();
    this.cb.onLoading?.({ active: true, progress: 0, label: 'Assembling crowd' });

    const results = await Promise.allSettled(defs.map((d) => loadAsset(d)));
    if (token !== this.crowdToken || this.disposed) return;
    const assets = results.filter((r) => r.status === 'fulfilled' && r.value.hasMesh).map((r) => r.value);
    assets.forEach((a) => this.registerAnimations(a));
    this.cb.onLoading?.({ active: false });
    if (!assets.length) return;

    // Concentric rings around the hero, each slot gets a random rig, look and clip.
    const slots = [];
    for (let ring = 0; slots.length < count; ring++) {
      const radius = 1.9 + ring * 1.25;
      const capacity = Math.floor((Math.PI * 2 * radius) / 1.05);
      const phase = Math.random() * Math.PI;
      for (let i = 0; i < capacity && slots.length < count; i++) {
        const a = phase + (i / capacity) * Math.PI * 2;
        slots.push([Math.cos(a) * radius, Math.sin(a) * radius]);
      }
    }

    slots.forEach(([x, z], i) => {
      const asset = pick(assets);
      const member = this.instantiate(asset, { style: pick(LOOK_STYLES), tint: pick(CROWD_TINTS) });
      member.holder.position.set(x, 0, z);
      member.holder.rotation.y = Math.atan2(x, z) * 0.15 + (Math.random() - 0.5) * 0.6;

      const clips = this.library.list(asset).filter((c) => c.compatible && !/t-?pose/i.test(c.name));
      if (clips.length) {
        const clip = this.library.clipFor(pick(clips).name, asset);
        const action = member.mixer.clipAction(clip);
        action.time = Math.random() * clip.duration;
        action.setEffectiveTimeScale(0.85 + Math.random() * 0.3).play();
        member.action = action;
      }

      member.holder.scale.setScalar(0.001);
      member.holder.position.y = -1.2;
      const delay = 0.1 + i * 0.035;
      gsap.to(member.holder.scale, { x: 1, y: 1, z: 1, duration: 0.8, delay, ease: 'back.out(1.8)' });
      gsap.to(member.holder.position, { y: 0, duration: 0.8, delay, ease: 'power3.out' });

      this.scene.add(member.holder);
      this.crowd.push(member);
    });
  }

  clearCrowd() {
    this.crowd.forEach((member, i) => this.retire(member, i * 0.012));
    this.crowd = [];
  }

  dispose() {
    this.disposed = true;
    this.crowdToken++;
    this.loadToken++;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    gsap.killTweensOf([this.camera.position, this.controls.target]);
    this.scene.traverse((o) => {
      if (o.isMesh && o.userData.baseMaterial) disposeLook(o);
    });
    this.envMap.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function makeRadialTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.45, '#777777');
  gradient.addColorStop(1, '#000000');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
