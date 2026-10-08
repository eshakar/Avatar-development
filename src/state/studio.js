import { create } from 'zustand';
import { Stage, DEFAULT_FX } from '../three/Stage.js';
import { DEFAULT_CAMERA } from '../three/director.js';
import { AnimationLibrary, licensedFor } from '../three/animationLibrary.js';
import { loadAsset, loadVariantMap } from '../three/loadAvatar.js';
import { CharacterRig } from '../dance/CharacterRig.js';
import { AudioEngine, DEFAULT_MASTER, analyzeInWorker } from '../audio/AudioEngine.js';
import { BeatGrid } from '../audio/BeatGrid.js';
import { renderDemoTrack } from '../audio/demoTrack.js';
import { DEFAULT_DANCE } from '../dance/Choreographer.js';
import { ClipMove } from '../dance/ClipMove.js';
import { PROCEDURAL_MOVES, ProceduralBody, ProceduralMove } from '../dance/proceduralMoves.js';
import { BUILTIN_AVATARS, loadDanceManifest, loadLocalManifest, randomAccent, rpmAnimationDefs, typeFromName } from '../data/avatars.js';
import { exportVideo } from '../export/exportVideo.js';
import { createImageBackground, createVideoBackground, isImageFile, isPanorama, isVideoFile } from '../three/videoBackground.js';
import { panoramaDef } from '../three/environments.js';

export const ASPECTS = { '9:16': 9 / 16, '16:9': 16 / 9, '1:1': 1, '4:5': 4 / 5 };
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'webm'];
const isAudio = (name) => AUDIO_EXT.includes(name.split('.').pop().toLowerCase());

export function exportSize(aspect, short) {
  const a = ASPECTS[aspect];
  const even = (v) => Math.round(v / 2) * 2;
  return a < 1 ? { width: short, height: even(short / a) } : { width: even(short * a), height: short };
}

export const useStudio = create(() => ({
  ready: false,
  loading: { active: true, label: 'Starting studio' },
  toasts: [],
  tab: 'character',

  avatars: BUILTIN_AVATARS,
  avatarId: BUILTIN_AVATARS[0].id,
  parts: [],
  variant: null,
  look: { style: 'original', tint: '#ffffff', parts: {} },
  smile: 0.25,

  moves: [],
  dance: { ...DEFAULT_DANCE },
  plan: [],
  shots: [],

  envId: 'street',
  videoBg: null,
  panoBg: null,
  fx: { ...DEFAULT_FX },
  camera: { ...DEFAULT_CAMERA },

  tracks: [],
  master: { ...DEFAULT_MASTER },
  beatTrackId: null,
  analysis: { status: 'idle' },
  beatAdjust: { nudgeMs: 0, downbeatShift: 0, tempoScale: 1, manualBpm: null },
  duration: 1,

  playing: false,
  click: false,
  loop: true,
  range: null,

  project: { aspect: '9:16', resolution: 1080, fps: 30 },
  exportState: { status: 'idle' },
}));

const set = useStudio.setState;
const get = useStudio.getState;

// Engine objects live outside React.
export const engine = {
  stage: null,
  audio: null,
  library: new AnimationLibrary(),
  analyses: new Map(),
  grid: null,
  clipMoves: new Map(),
  sourceRigs: new WeakMap(),
  exportAbort: null,
};

// A rig for the skeleton a clip was authored on, for cross-skeleton (world-space) retargeting.
function sourceRigFor(asset) {
  if (!engine.sourceRigs.has(asset)) engine.sourceRigs.set(asset, new CharacterRig(asset.root, { rotationY: asset.def.rotationY ?? 0 }));
  return engine.sourceRigs.get(asset);
}

async function imageThumb(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = 180;
  c.height = Math.round((180 * bmp.height) / bmp.width);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL('image/jpeg', 0.8);
}

let toastId = 0;
export function toast(text, tone = 'info') {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4500);
}

function publishTracks() {
  const { audio } = engine;
  set({
    tracks: audio.tracks.map(({ id, name, color, gainDb, pan, mute, solo, offset, buffer }) => ({
      id, name, color, gainDb, pan, mute, solo, offset, length: buffer.duration,
    })),
    duration: audio.duration,
  });
}

function publishPlan() {
  const hero = engine.stage?.hero;
  const segs = hero?.choreo.segments ?? [];
  set({
    plan: segs
      .filter((s) => s.index >= 0)
      .map((s) => ({ index: s.index, start: s.start, end: s.end, moveId: s.move.id, name: s.move.name, kind: s.move.kind, overridden: !!s.overridden })),
    shots: engine.stage?.shotPlan.filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end)) ?? [],
  });
}

function playbackRange() {
  const { range } = get();
  const d = engine.audio.duration;
  return range ? [range.in, range.out] : [0, d];
}

export const studio = {
  async init(container) {
    const audio = new AudioEngine();
    engine.audio = audio;
    const stage = new Stage(container, {
      onLoading: (loading) => set({ loading }),
      onError: (m) => toast(m, 'error'),
      onFrame: () => {
        const [a, b] = playbackRange();
        const was = audio.playing;
        audio.update(b, a);
        if (was !== audio.playing) set({ playing: audio.playing });
      },
    });
    stage.getTime = () => audio.audibleTime;
    stage.isPlaying = () => audio.playing;
    engine.stage = stage;
    const s = get();
    stage.setAspect(ASPECTS[s.project.aspect]);
    stage.setCamera(s.camera);
    stage.setFx(s.fx);
    stage.setSmile(s.smile);
    // Dance to a 120 BPM placeholder grid until the real analysis arrives.
    engine.grid = BeatGrid.manual({ bpm: 120, duration: 600 });
    stage.setGrid(engine.grid);

    // Your own characters (public/models/manifest.json) come first and the first one is the default.
    const local = await loadLocalManifest();
    if (local.length) set((st) => ({ avatars: [...local, ...st.avatars.filter((a) => !local.some((l) => l.id === a.id))] }));
    const first = local[0]?.id ?? s.avatarId;

    await Promise.all([
      stage.setEnvironment(s.envId),
      this.selectAvatar(first),
      this.loadDemo(),
      this.loadDances(),
    ]);
    set({ ready: true });
  },

  // Dance clips listed in public/dances/manifest.json (e.g. Mixamo FBX "without skin").
  async loadDances() {
    const defs = await loadDanceManifest();
    if (!defs.length) return;
    const results = await Promise.allSettled(defs.map((d) => loadAsset(d)));
    let added = 0;
    results.forEach((r) => r.status === 'fulfilled' && (added += engine.library.register(r.value).length));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) toast(`${failed} dance file(s) in public/dances couldn't be loaded`, 'error');
    if (added) {
      toast(`Loaded ${added} dance clip${added > 1 ? 's' : ''} from public/dances`, 'success');
      this.rebuildMoves();
    }
  },

  dispose() {
    engine.stage?.dispose();
    engine.audio?.dispose();
    engine.stage = null;
  },

  // ---------------------------------------------------------------- avatar & moves

  async selectAvatar(id) {
    const def = get().avatars.find((a) => a.id === id);
    if (!def || !engine.stage) return;
    set({ avatarId: id });
    document.documentElement.style.setProperty('--accent', def.accent);
    const res = await engine.stage.setAvatar(def);
    if (!res) return;
    engine.library.register(res.asset);
    const look = { ...get().look, parts: {} };
    set({ parts: res.parts, look, variant: def.pbr?.defaultVariant ?? null });
    engine.stage.setLook(look);
    this.rebuildMoves();

    // Extra clip sources: RPM's mocap library for RPM avatars, Michelle's samba for Mixamo rigs.
    const extra =
      def.family === 'rpm'
        ? rpmAnimationDefs(def.rpmBody)
        : def.id !== 'michelle'
          ? [BUILTIN_AVATARS.find((a) => a.id === 'michelle')]
          : [];
    if (!extra.length) return;
    set({ loading: { active: true, label: 'Loading mocap dances' } });
    let done = 0;
    const results = await Promise.allSettled(
      extra.map((d) =>
        loadAsset(d).then((a) => {
          set({ loading: { active: true, label: 'Loading mocap dances', progress: ++done / extra.length } });
          return a;
        }),
      ),
    );
    results.forEach((r) => r.status === 'fulfilled' && engine.library.register(r.value));
    if (results.some((r) => r.status === 'rejected')) toast('Some mocap clips failed to load', 'error');
    set({ loading: { active: false } });
    if (get().avatarId === id) this.rebuildMoves();
  },

  rebuildMoves() {
    const hero = engine.stage?.hero;
    if (!hero) return;
    const { asset, rig, def } = hero;
    const moves = [];
    for (const c of engine.library.list(asset)) {
      if (!c.dance) continue;
      const entry = engine.library.entry(c.name);
      if (!licensedFor(entry.asset.def, def)) continue;
      // Same skeleton convention: copy tracks. Different (e.g. Mixamo clip on a CC3 avatar): world-space retarget.
      const sameRig = entry.asset === asset || (entry.asset.skeleton === asset.skeleton && asset.skeleton !== 'other');
      if (sameRig && !c.compatible) continue;
      const key = `${def.id}|${c.name}`;
      let move = engine.clipMoves.get(key);
      if (!move || move.rig !== rig) {
        const meta = { id: `clip:${c.name}`, name: c.name, source: c.source };
        move = sameRig
          ? new ClipMove(engine.library.clipFor(c.name, asset), rig, meta)
          : new ClipMove(entry.clip, rig, meta, sourceRigFor(entry.asset));
        engine.clipMoves.set(key, move);
      }
      if (move.valid) moves.push(move);
    }
    if (ProceduralBody.supports(rig)) {
      const body = new ProceduralBody(rig);
      for (const d of PROCEDURAL_MOVES) moves.push(new ProceduralMove(d, body));
    }
    hero.choreo.options = { ...get().dance };
    hero.choreo.setMoves(moves);
    set({
      moves: moves.map((m) => ({
        id: m.id, name: m.name, kind: m.kind, source: m.source, energy: m.energyLevel, bpm: m.bpm ?? null,
      })),
    });
    publishPlan();
  },

  setLook(patch) {
    const look = { ...get().look, ...patch };
    set({ look });
    engine.stage?.setLook(look);
  },

  async setVariant(id) {
    const def = engine.stage?.hero?.def;
    if (!def?.pbr) return;
    set({ variant: id });
    try {
      const map = await loadVariantMap(def, id);
      if (get().variant === id) engine.stage.setVariantMap(map, get().look);
    } catch (err) {
      console.error(err);
      toast("Couldn't load that outfit", 'error');
    }
  },

  setPartTint(partId, color) {
    this.setLook({ parts: { ...get().look.parts, [partId]: color } });
  },

  setSmile(v) {
    set({ smile: v });
    engine.stage?.setSmile(v);
  },

  setDance(patch) {
    const dance = { ...get().dance, ...patch };
    set({ dance });
    engine.stage?.hero?.choreo.setOptions(patch);
    publishPlan();
  },

  overridePhrase(index, moveId) {
    const overrides = { ...get().dance.overrides };
    if (moveId) overrides[index] = moveId;
    else delete overrides[index];
    this.setDance({ overrides });
  },

  toggleMove(id) {
    const disabled = get().dance.disabled.includes(id)
      ? get().dance.disabled.filter((d) => d !== id)
      : [...get().dance.disabled, id];
    this.setDance({ disabled });
  },

  shuffle() {
    this.setDance({ seed: Math.floor(Math.random() * 1e6), overrides: {} });
    this.setCamera({ seed: Math.floor(Math.random() * 1e6) });
  },

  // ---------------------------------------------------------------- scene & camera

  async setEnvironment(id) {
    set({ envId: id });
    await engine.stage?.setEnvironment(id);
  },

  // Real moving footage as the background (stock video, your own phone clip…).
  async setVideoBackground(file) {
    set({ loading: { active: true, label: `Loading ${file.name}` } });
    try {
      const video = await createVideoBackground(file);
      engine.video?.dispose();
      engine.video = video;
      engine.stage.setVideo(video);
      set({ videoBg: { kind: 'video', name: video.name, thumb: video.thumb, width: video.width, height: video.height, duration: video.duration } });
      await this.setEnvironment('video');
      toast(`Background: ${video.name} (${video.width}×${video.height}, ${video.duration.toFixed(1)}s)`, 'success');
    } catch (err) {
      console.error(err);
      toast(err.message || `Couldn't use ${file.name} as a background`, 'error');
    } finally {
      set({ loading: { active: false } });
    }
  },

  // A background image: a normal photo becomes a plate behind the dancer (like a video, but still);
  // a 360° panorama (2:1 image, .hdr, .exr) wraps around the scene and lights the dancer.
  async setImageBackground(file) {
    set({ loading: { active: true, label: `Loading ${file.name}` } });
    try {
      if (await isPanorama(file)) {
        const prev = engine.panoUrl;
        engine.panoUrl = URL.createObjectURL(file);
        const def = panoramaDef(file, engine.panoUrl);
        engine.stage.registerEnvironment(def);
        const thumb = def.format === 'ldr' ? await imageThumb(file) : null;
        set({ panoBg: { name: def.name, thumb, format: def.format } });
        await this.setEnvironment('pano');
        if (prev) URL.revokeObjectURL(prev);
        toast(`360° background: ${def.name}`, 'success');
      } else {
        const photo = await createImageBackground(file);
        engine.video?.dispose();
        engine.video = photo;
        engine.stage.setVideo(photo);
        set({ videoBg: { kind: 'photo', name: photo.name, thumb: photo.thumb, width: photo.width, height: photo.height } });
        await this.setEnvironment('video');
        toast(`Background photo: ${photo.name} (${photo.width}×${photo.height})`, 'success');
      }
    } catch (err) {
      console.error(err);
      toast(`Couldn't use ${file.name} as a background`, 'error');
    } finally {
      set({ loading: { active: false } });
    }
  },

  // Any background file: video, photo or panorama.
  async setBackgroundFile(file) {
    if (isVideoFile(file)) return this.setVideoBackground(file);
    if (isImageFile(file)) return this.setImageBackground(file);
    toast(`${file.name}: use a video (.mp4/.mov) or an image (.jpg/.png/.hdr)`, 'error');
  },

  // Adds the background video's own sound (e.g. street ambience) to the mixer.
  async addVideoSound() {
    if (!engine.video) return;
    await this.addAudioFiles([engine.video.file]);
  },

  setFx(patch) {
    set({ fx: { ...get().fx, ...patch } });
    engine.stage?.setFx(patch);
  },

  setCamera(patch) {
    set({ camera: { ...get().camera, ...patch } });
    engine.stage?.setCamera(patch);
    publishPlan();
  },

  setProject(patch) {
    const project = { ...get().project, ...patch };
    set({ project });
    if (patch.aspect) engine.stage?.setAspect(ASPECTS[patch.aspect]);
  },

  // ---------------------------------------------------------------- audio

  async loadDemo() {
    try {
      const buffer = await renderDemoTrack(44100);
      this.addTrack(buffer, 'Night Drive (demo) · 118 BPM');
    } catch (err) {
      console.error(err);
      toast("Couldn't generate the demo track", 'error');
    }
  },

  addTrack(buffer, name) {
    const track = engine.audio.addTrack({ name, buffer });
    publishTracks();
    if (!get().beatTrackId) this.setBeatTrack(track.id);
    return track;
  },

  async addAudioFiles(files) {
    for (const file of files) {
      try {
        const buffer = await engine.audio.decode(await file.arrayBuffer());
        const hadDemo = engine.audio.tracks.find((t) => t.name.includes('(demo)'));
        const track = this.addTrack(buffer, file.name.replace(/\.[^.]+$/, ''));
        // First real song replaces the demo as the beat source and mutes it.
        if (hadDemo && get().beatTrackId === hadDemo.id) {
          this.updateTrack(hadDemo.id, { mute: true });
          this.setBeatTrack(track.id);
        }
        toast(`Added ${file.name}`, 'success');
      } catch (err) {
        console.error(err);
        toast(`Couldn't decode ${file.name}`, 'error');
      }
    }
  },

  updateTrack(id, patch) {
    engine.audio.updateTrack(id, patch);
    publishTracks();
    const { range, duration } = get();
    if (range && range.out > duration) set({ range: null });
    if ((patch.offset !== undefined && id === get().beatTrackId) || patch.mute !== undefined || patch.solo !== undefined) this.applyGrid();
  },

  removeTrack(id) {
    engine.audio.removeTrack(id);
    engine.analyses.delete(id);
    publishTracks();
    if (get().beatTrackId === id) {
      const next = engine.audio.tracks[0]?.id ?? null;
      set({ beatTrackId: null });
      if (next) this.setBeatTrack(next);
    }
  },

  setMaster(patch) {
    set({ master: { ...get().master, ...patch } });
    engine.audio.setMaster(patch);
  },

  async setBeatTrack(id) {
    set({ beatTrackId: id, beatAdjust: { nudgeMs: 0, downbeatShift: 0, tempoScale: 1, manualBpm: null } });
    if (!engine.analyses.has(id)) await this.analyze(id);
    else this.applyGrid();
  },

  async analyze(id = get().beatTrackId) {
    const track = engine.audio.tracks.find((t) => t.id === id);
    if (!track) return;
    set({ analysis: { status: 'running' } });
    try {
      const result = await analyzeInWorker(track.buffer);
      engine.analyses.set(id, result);
      if (get().beatTrackId === id) this.applyGrid();
    } catch (err) {
      console.error(err);
      set({ analysis: { status: 'error', message: String(err.message ?? err) } });
      toast('Beat analysis failed', 'error');
    }
  },

  setBeatAdjust(patch) {
    set({ beatAdjust: { ...get().beatAdjust, ...patch } });
    this.applyGrid();
  },

  applyGrid() {
    const id = get().beatTrackId;
    const result = engine.analyses.get(id);
    const track = engine.audio.tracks.find((t) => t.id === id);
    if (!result || !track) return;
    const adj = get().beatAdjust;
    const common = {
      pulse: result.pulse,
      pulseRate: result.pulseRate,
      peaks: result.peaks,
      peaksRate: result.peaksRate,
      offset: track.offset + adj.nudgeMs / 1000,
      duration: engine.audio.duration,
    };
    let grid;
    if (adj.manualBpm) {
      grid = BeatGrid.manual({ bpm: adj.manualBpm, firstBeat: result.beats[0] ?? 0, downbeat: result.downbeat + adj.downbeatShift, ...common });
    } else {
      let beats = Array.from(result.beats);
      let energy = Array.from(result.beatEnergy);
      let accent = Array.from(result.beatAccent);
      let downbeat = result.downbeat;
      if (adj.tempoScale === 2) {
        const b2 = [];
        const e2 = [];
        const a2 = [];
        beats.forEach((t, i) => {
          b2.push(t);
          e2.push(energy[i]);
          a2.push(accent[i]);
          if (i < beats.length - 1) b2.push((t + beats[i + 1]) / 2), e2.push(energy[i]), a2.push(accent[i] * 0.5);
        });
        [beats, energy, accent, downbeat] = [b2, e2, a2, downbeat * 2];
      } else if (adj.tempoScale === 0.5) {
        const p = downbeat % 2;
        const pick = (arr, f = (i) => arr[i]) => arr.map((_, i) => i).filter((i) => i % 2 === p).map(f);
        energy = pick(energy, (i) => (energy[i] + (energy[i + 1] ?? energy[i])) / 2);
        accent = pick(accent);
        beats = pick(beats);
        downbeat = (downbeat - p) / 2;
      }
      grid = new BeatGrid({
        beats,
        downbeat: downbeat + adj.downbeatShift,
        beatEnergy: Float32Array.from(energy),
        beatAccent: Float32Array.from(accent),
        ...common,
      });
    }
    engine.grid = grid;
    engine.stage?.setGrid(grid);
    engine.audio.setClick(get().click, grid);
    set({
      analysis: { status: 'done', bpm: grid.bpm, detectedBpm: result.bpm, confidence: result.confidence, beats: grid.count },
      duration: engine.audio.duration,
    });
    publishPlan();
  },

  // ---------------------------------------------------------------- transport

  async togglePlay() {
    const { audio } = engine;
    if (audio.playing) audio.pause();
    else {
      const [a, b] = playbackRange();
      const t = audio.time;
      await audio.play(t < a || t >= b - 0.05 ? a : t);
    }
    set({ playing: audio.playing });
  },

  seek(t) {
    engine.audio.seek(t);
  },

  setClick(on) {
    set({ click: on });
    engine.audio.setClick(on, engine.grid);
  },

  setLoop(on) {
    set({ loop: on });
    engine.audio.loop = on;
  },

  setRange(range) {
    set({ range });
  },

  // ---------------------------------------------------------------- files

  async handleFiles(files) {
    const backgrounds = files.filter((f) => isVideoFile(f) || isImageFile(f));
    const audioFiles = files.filter((f) => isAudio(f.name) && !isVideoFile(f));
    if (backgrounds.length) await this.setBackgroundFile(backgrounds[backgrounds.length - 1]);
    if (audioFiles.length) await this.addAudioFiles(audioFiles);
    for (const file of files.filter((f) => !isAudio(f.name) && !isVideoFile(f) && !isImageFile(f))) {
      const type = typeFromName(file.name);
      if (!type) {
        toast(`${file.name}: use .fbx, .glb or an audio file`, 'error');
        continue;
      }
      const def = {
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        tag: 'Your upload',
        url: URL.createObjectURL(file),
        type,
        upload: true,
        accent: randomAccent(),
        emoji: '✨',
      };
      try {
        const asset = await loadAsset(def);
        const added = engine.library.register(asset);
        if (asset.hasMesh) {
          set((s) => ({ avatars: [...s.avatars, { ...def, family: asset.skeleton }] }));
          await this.selectAvatar(def.id);
          toast(`Added ${def.name}${added.length ? ` + ${added.length} clip(s)` : ''}`, 'success');
        } else if (added.length) {
          this.rebuildMoves();
          toast(`Added ${added.length} dance clip(s) from ${def.name}`, 'success');
        } else {
          toast(`${def.name} has no mesh or animations`, 'error');
        }
      } catch (err) {
        console.error(err);
        toast(`Couldn't read ${file.name}`, 'error');
      }
    }
  },

  // ---------------------------------------------------------------- export

  async startExport() {
    const { project } = get();
    const { width, height } = exportSize(project.aspect, project.resolution);
    const [start, end] = playbackRange();
    if (engine.audio.playing) await this.togglePlay();
    const abort = new AbortController();
    engine.exportAbort = abort;
    set({ exportState: { status: 'running', progress: 0, phase: 'Preparing', width, height } });
    try {
      const { blob, videoCodec } = await exportVideo({
        stage: engine.stage,
        audio: engine.audio,
        start,
        end,
        width,
        height,
        fps: project.fps,
        signal: abort.signal,
        onProgress: (p) => set((s) => ({ exportState: { ...s.exportState, ...p, progress: p.value } })),
      });
      const prev = get().exportState.url;
      if (prev) URL.revokeObjectURL(prev);
      set({
        exportState: {
          status: 'done',
          url: URL.createObjectURL(blob),
          size: blob.size,
          width,
          height,
          codec: videoCodec,
          filename: `avatar-dance-${project.aspect.replace(':', 'x')}-${Date.now()}.mp4`,
        },
      });
    } catch (err) {
      if (err.name === 'AbortError') set({ exportState: { status: 'idle' } });
      else {
        console.error(err);
        set({ exportState: { status: 'error', message: String(err.message ?? err) } });
      }
    } finally {
      engine.exportAbort = null;
    }
  },

  cancelExport() {
    engine.exportAbort?.abort();
  },

  closeExport() {
    set({ exportState: { status: 'idle', url: get().exportState.url } });
  },
};

// Handy for debugging in the browser console during development.
if (import.meta.env.DEV) window.__studio = { engine, studio, useStudio };
