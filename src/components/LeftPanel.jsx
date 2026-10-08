import { motion, AnimatePresence } from 'framer-motion';
import { useStudio, studio } from '../state/studio.js';
import { LOOK_STYLES } from '../three/materials.js';
import { TINTS } from '../data/avatars.js';
import { ENVIRONMENTS } from '../three/environments.js';
import { GRADES } from '../three/Stage.js';
import { CAMERA_MODES, SHOTS } from '../three/director.js';
import { Icon, Section, Segmented, Slider, Swatches, Toggle } from './ui.jsx';

export const TABS = [
  { id: 'character', name: 'Character', icon: 'user' },
  { id: 'dance', name: 'Dance', icon: 'dance' },
  { id: 'scene', name: 'Scene', icon: 'scene' },
  { id: 'camera', name: 'Camera', icon: 'camera' },
];

const pct = (v) => `${Math.round(v * 100)}%`;

function CharacterTab() {
  const { avatars, avatarId, look, parts, smile, variant } = useStudio();
  const current = avatars.find((a) => a.id === avatarId);
  return (
    <>
      <Section title="Avatar">
        <div className="avatar-grid">
          {avatars.map((a) => (
            <motion.button
              key={a.id}
              className={`avatar-card${a.id === avatarId ? ' on' : ''}`}
              style={{ '--card': a.accent }}
              onClick={() => studio.selectAvatar(a.id)}
              whileTap={{ scale: 0.96 }}
            >
              <span className="avatar-emoji">{a.emoji}</span>
              <strong>{a.name}</strong>
              <small>{a.tag}</small>
            </motion.button>
          ))}
          <label className="avatar-card add">
            <input type="file" accept=".fbx,.glb,.gltf" hidden onChange={(e) => (studio.handleFiles([...e.target.files]), (e.target.value = ''))} />
            <Icon name="upload" />
            <strong>Add avatar</strong>
            <small>Mixamo .fbx / .glb</small>
          </label>
        </div>
        {current?.family === 'rpm' && (
          <p className="note">Mocap dances from Ready Player Me's library are licensed for RPM avatars only, so they appear just for RPM characters.</p>
        )}
        {current && current.family !== 'rpm' && (
          <p className="note">Dances with procedural moves, Mixamo's samba, and any Mixamo dance you drop in (retargeted automatically).</p>
        )}
      </Section>

      {current?.pbr && (
        <Section title="Outfit">
          <div className="variants">
            {current.pbr.variants.map((v) => (
              <button key={v.id} className={`variant${v.id === variant ? ' on' : ''}`} onClick={() => studio.setVariant(v.id)}>
                <i style={{ background: v.color }} />
                {v.name}
              </button>
            ))}
          </div>
        </Section>
      )}

      <Section title="Material">
        <Segmented layoutId="look" options={LOOK_STYLES} value={look.style} onChange={(style) => studio.setLook({ style })} small />
        <Swatches colors={TINTS} value={look.tint} onChange={(tint) => studio.setLook({ tint })} label="Tint" />
      </Section>

      {look.style === 'original' && parts.length > 1 && (
        <Section title="Outfit colours">
          <div className="parts">
            {parts.map((p) => (
              <label key={p.id} className="part">
                <span>{p.label}</span>
                <span className="part-swatch" style={{ background: look.parts[p.id] ?? '#ffffff' }}>
                  <input type="color" value={look.parts[p.id] ?? '#ffffff'} onChange={(e) => studio.setPartTint(p.id, e.target.value)} />
                </span>
              </label>
            ))}
          </div>
          <button className="btn ghost small" onClick={() => studio.setLook({ parts: {} })}>Reset outfit</button>
        </Section>
      )}

      {current?.family === 'rpm' && (
        <Section title="Expression">
          <Slider label="Smile" value={smile} onChange={(v) => studio.setSmile(v)} format={pct} />
        </Section>
      )}
    </>
  );
}

function DanceTab() {
  const { dance, moves, analysis } = useStudio();
  const mocap = moves.filter((m) => m.kind === 'mocap');
  const proc = moves.filter((m) => m.kind === 'procedural');
  const MoveRow = ({ m }) => {
    const on = !dance.disabled.includes(m.id);
    return (
      <button className={`move-row${on ? '' : ' off'}`} onClick={() => studio.toggleMove(m.id)} aria-pressed={on}>
        <span className="check">{on ? '✓' : ''}</span>
        <span className="move-name">{m.name}</span>
        {m.bpm && <span className="chip">{Math.round(m.bpm)} bpm</span>}
        <span className="energy" title={`Energy ${pct(m.energy)}`}>
          <i style={{ width: pct(m.energy) }} />
        </span>
      </button>
    );
  };
  return (
    <>
      <Section title="Choreography" aside={<button className="btn small" onClick={() => studio.shuffle()}><Icon name="shuffle" size={14} /> Shuffle</button>}>
        <p className="note">
          Moves are time-warped beat by beat onto the {analysis.bpm ? `${analysis.bpm.toFixed(1)} BPM` : ''} grid and change on phrase boundaries. Click a block in the timeline to pick its move.
        </p>
        <label className="field-label">Change move every</label>
        <Segmented
          layoutId="phrase"
          small
          options={[{ id: 4, name: '1 bar' }, { id: 8, name: '2 bars' }, { id: 16, name: '4 bars' }]}
          value={dance.phraseBeats}
          onChange={(phraseBeats) => studio.setDance({ phraseBeats, overrides: {} })}
        />
        <Slider label="Follow song energy" value={dance.energyFollow} onChange={(energyFollow) => studio.setDance({ energyFollow })} format={pct} />
        <Slider label="Variety" value={dance.variety} onChange={(variety) => studio.setDance({ variety })} format={pct} />
        <Slider label="Beat accent (hip bounce)" value={dance.accent} onChange={(accent) => studio.setDance({ accent })} format={pct} />
        <Slider label="Transition" value={dance.blendBeats} min={0.25} max={2} step={0.25} onChange={(blendBeats) => studio.setDance({ blendBeats })} format={(v) => `${v} beat${v === 1 ? '' : 's'}`} />
        <Toggle label="Prefer mocap" hint="Use motion-captured clips before procedural moves" checked={dance.mocapFirst} onChange={(mocapFirst) => studio.setDance({ mocapFirst })} />
        <Slider label="Motion smoothness" value={dance.smoothness} onChange={(smoothness) => studio.setDance({ smoothness })} format={(v) => (v === 0 ? 'off' : `±${Math.round(v * 50)} ms`)} />
        <Toggle label="Natural speed" hint="Pick clips whose own tempo suits the song, so mocap isn't sped up or slowed down" checked={dance.naturalSpeed} onChange={(naturalSpeed) => studio.setDance({ naturalSpeed })} />
      </Section>

      {mocap.length > 0 && (
        <Section title={`Mocap clips · ${mocap.length}`}>
          <div className="move-list">{mocap.map((m) => <MoveRow key={m.id} m={m} />)}</div>
        </Section>
      )}
      <Section title={`Procedural moves · ${proc.length}`}>
        <div className="move-list">{proc.map((m) => <MoveRow key={m.id} m={m} />)}</div>
        <label className="btn ghost small upload-inline">
          <input type="file" accept=".fbx,.glb" multiple hidden onChange={(e) => (studio.handleFiles([...e.target.files]), (e.target.value = ''))} />
          <Icon name="upload" size={14} /> Add Mixamo dance (.fbx, without skin)
        </label>
      </Section>
    </>
  );
}

function SceneTab() {
  const { envId, fx, videoBg, panoBg } = useStudio();
  const envs = [
    ...(panoBg ? [{ id: 'pano', name: `360° ${panoBg.name}`, thumb: panoBg.thumb, gradient: 'linear-gradient(135deg,#334155,#0f172a)' }] : []),
    ...ENVIRONMENTS.filter((e) => e.kind !== 'video' || videoBg),
  ];
  const thumb = (e) => (e.kind === 'video' ? videoBg.thumb : e.thumb);
  const label = (e) => (e.kind === 'video' ? `${videoBg.kind === 'video' ? '▶ ' : ''}${videoBg.name}` : e.name);
  const plate = envId === 'video' && videoBg;
  return (
    <>
      <Section title="Background">
        <div className="env-grid">
          <label className="env-card add" title="A video (moving background), a photo, or a 360° panorama (.hdr, .exr or a 2:1 image)">
            <input type="file" accept="video/*,image/*,.mp4,.mov,.m4v,.webm,.hdr,.exr" hidden onChange={(e) => (e.target.files[0] && studio.setBackgroundFile(e.target.files[0]), (e.target.value = ''))} />
            <Icon name="upload" size={16} />
            <span>Upload background</span>
            <small>video · photo · 360°</small>
          </label>
          {envs.map((e) => (
            <motion.button
              key={e.id}
              className={`env-card${e.id === envId ? ' on' : ''}`}
              style={{ backgroundImage: thumb(e) ? `url(${thumb(e)})` : e.gradient }}
              onClick={() => studio.setEnvironment(e.id)}
              whileTap={{ scale: 0.96 }}
            >
              <span>{label(e)}</span>
            </motion.button>
          ))}
        </div>
        {envId === 'studio' && <Swatches colors={['#e9e3da', '#f2f2f2', '#c9d6df', '#f6d6c8', '#1f2937', '#2b193d']} value={fx.studioColor} onChange={(studioColor) => studio.setFx({ studioColor })} label="Backdrop" />}
        <Slider label="Exposure" value={fx.exposure} min={0.4} max={2} onChange={(exposure) => studio.setFx({ exposure })} />
        <Slider label="Sun / key light" value={fx.sun} min={0} max={2} onChange={(sun) => studio.setFx({ sun })} />
        <Slider label="Rotate background" value={fx.envRotation} min={-Math.PI} max={Math.PI} onChange={(envRotation) => studio.setFx({ envRotation })} format={(v) => `${Math.round((v * 180) / Math.PI)}°`} />
      </Section>
      {plate && (
        <Section title={videoBg.kind === 'video' ? 'Match the footage' : 'Match the photo'}>
          <p className="note">
            Line the dancer up with the real camera: set its height and tilt until the shadow sits on the ground, then place the dancer. Tripod (static) shots work best.
          </p>
          <Slider label="Camera height" value={fx.plateHeight} min={0.3} max={4} step={0.05} onChange={(plateHeight) => studio.setFx({ plateHeight })} format={(v) => `${v.toFixed(2)} m`} />
          <Slider label="Camera tilt" value={fx.plateTilt} min={-30} max={15} step={0.5} onChange={(plateTilt) => studio.setFx({ plateTilt })} format={(v) => `${v.toFixed(1)}°`} />
          <Slider label="Dancer distance" value={fx.plateDistance} min={1.5} max={15} step={0.1} onChange={(plateDistance) => studio.setFx({ plateDistance })} format={(v) => `${v.toFixed(1)} m`} />
          <Slider label="Dancer left / right" value={fx.plateX} min={-3} max={3} step={0.05} onChange={(plateX) => studio.setFx({ plateX })} format={(v) => `${v.toFixed(2)} m`} />
          {videoBg.kind === 'video' && (
            <button className="btn small" onClick={() => studio.addVideoSound()}>
              <Icon name="wave" size={14} /> Add the video's sound to the mixer
            </button>
          )}
        </Section>
      )}
      <Section title="Colour grade">
        <Segmented layoutId="grade" small options={Object.keys(GRADES)} value={fx.grade} onChange={(grade) => studio.setFx({ grade })} />
        <Slider label="Bloom" value={fx.bloom} max={1.5} onChange={(bloom) => studio.setFx({ bloom })} />
        <Slider label="Film grain" value={fx.grain} onChange={(grain) => studio.setFx({ grain })} format={pct} />
        <Slider label="Vignette" value={fx.vignette} onChange={(vignette) => studio.setFx({ vignette })} format={pct} />
        <Slider label="Lens fringing" value={fx.chroma} onChange={(chroma) => studio.setFx({ chroma })} format={pct} />
        <Toggle label="Ambient occlusion" hint="Soft contact shadows (GTAO)" checked={fx.ao} onChange={(ao) => studio.setFx({ ao })} />
      </Section>
      <Section title="Beat-reactive">
        <Slider label="Lights & bloom pulse" value={fx.lights} onChange={(lights) => studio.setFx({ lights })} format={pct} />
        <Slider label="Downbeat flash" value={fx.flash} onChange={(flash) => studio.setFx({ flash })} format={pct} />
      </Section>
    </>
  );
}

function CameraTab() {
  const { camera, envId } = useStudio();
  return (
    <>
      <Section title="Director">
        {envId === 'video' && <p className="note">With a video or photo background the camera stays matched to it. Shots become punch-in crops (cut on downbeats); Orbit and Free behave like Locked.</p>}
        <Segmented layoutId="cam-mode" options={CAMERA_MODES} value={camera.mode} onChange={(mode) => studio.setCamera({ mode })} />
        {camera.mode === 'auto' && (
          <>
            <label className="field-label">Cut every</label>
            <Segmented layoutId="cut" small options={[{ id: 1, name: '1 bar' }, { id: 2, name: '2 bars' }, { id: 4, name: '4 bars' }, { id: 8, name: '8 bars' }]} value={camera.cutBars} onChange={(cutBars) => studio.setCamera({ cutBars })} />
            <Toggle label="Smooth moves" hint="Glide into the next shot instead of a hard cut" checked={camera.smooth} onChange={(smooth) => studio.setCamera({ smooth })} />
          </>
        )}
        {camera.mode === 'orbit' && (
          <Slider label="Orbit length" value={camera.orbitBars} min={4} max={32} step={4} onChange={(orbitBars) => studio.setCamera({ orbitBars })} format={(v) => `${v} bars`} />
        )}
        {camera.mode === 'free' && <p className="note">Drag to orbit, scroll to zoom. Export uses this exact view.</p>}
      </Section>
      {(camera.mode === 'locked' || camera.mode === 'orbit') && (
        <Section title="Shot">
          <div className="shot-grid">
            {SHOTS.map((s) => (
              <button key={s.id} className={`shot${camera.shot === s.id ? ' on' : ''}`} onClick={() => studio.setCamera({ shot: s.id })}>
                {s.name}
              </button>
            ))}
          </div>
        </Section>
      )}
      <Section title="Feel">
        <Slider label="Beat zoom punch" value={camera.punch} onChange={(punch) => studio.setCamera({ punch })} format={pct} />
        <Slider label="Handheld shake" value={camera.shake} onChange={(shake) => studio.setCamera({ shake })} format={pct} />
      </Section>
    </>
  );
}

const CONTENT = { character: CharacterTab, dance: DanceTab, scene: SceneTab, camera: CameraTab };

export function TabContent({ tab }) {
  const Content = CONTENT[tab];
  return (
    <AnimatePresence mode="wait">
      <motion.div key={tab} className="tab-body" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.16 }}>
        <Content />
      </motion.div>
    </AnimatePresence>
  );
}

export default function LeftPanel() {
  const tab = useStudio((s) => s.tab);
  const current = TABS.some((t) => t.id === tab) ? tab : 'character';
  return (
    <aside className="panel left">
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === current ? 'on' : ''} onClick={() => useStudio.setState({ tab: t.id })}>
            <Icon name={t.icon} size={16} />
            <span>{t.name}</span>
            {t.id === current && <motion.span layoutId="tab-underline" className="tab-underline" />}
          </button>
        ))}
      </nav>
      <TabContent tab={current} />
    </aside>
  );
}
