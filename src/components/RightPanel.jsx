import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { engine, exportSize, studio, useStudio } from '../state/studio.js';
import { Icon, Section, Segmented, Slider, Toggle, fmtDb } from './ui.jsx';

function Meter() {
  const ref = useRef(null);
  useEffect(() => {
    let raf;
    let held = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const el = ref.current;
      if (!el || !engine.audio) return;
      const peak = engine.audio.level();
      held = Math.max(peak, held * 0.92);
      const db = 20 * Math.log10(held || 1e-6);
      const w = Math.max(0, Math.min(1, (db + 48) / 48));
      el.style.setProperty('--level', `${w * 100}%`);
      el.classList.toggle('clip', held >= 0.99);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div className="meter" ref={ref} aria-hidden="true" />;
}

function TrackStrip({ track, isBeat }) {
  return (
    <motion.div layout className="track" style={{ '--track': track.color }}>
      <div className="track-head">
        <span className="track-dot" />
        <strong title={track.name}>{track.name}</strong>
        <button className={`mini${track.mute ? ' on' : ''}`} onClick={() => studio.updateTrack(track.id, { mute: !track.mute })} title="Mute">M</button>
        <button className={`mini solo${track.solo ? ' on' : ''}`} onClick={() => studio.updateTrack(track.id, { solo: !track.solo })} title="Solo">S</button>
        <button className="mini" onClick={() => studio.removeTrack(track.id)} title="Remove track" aria-label="Remove track"><Icon name="trash" size={12} /></button>
      </div>
      <Slider label="Volume" value={track.gainDb} min={-40} max={6} step={0.5} onChange={(gainDb) => studio.updateTrack(track.id, { gainDb })} format={fmtDb} />
      <div className="row2">
        <Slider label="Pan" value={track.pan} min={-1} max={1} step={0.05} onChange={(pan) => studio.updateTrack(track.id, { pan })} format={(v) => (Math.abs(v) < 0.03 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}`)} />
        <Slider label="Start at" value={track.offset} min={0} max={30} step={0.05} onChange={(offset) => studio.updateTrack(track.id, { offset })} format={(v) => `${v.toFixed(2)}s`} />
      </div>
      <button className={`beat-source${isBeat ? ' on' : ''}`} onClick={() => !isBeat && studio.setBeatTrack(track.id)}>
        {isBeat ? '♪ Dance follows this track' : 'Make the dance follow this track'}
      </button>
    </motion.div>
  );
}

export function MixerSection() {
  const { tracks, master, beatTrackId } = useStudio();
  return (
    <>
      <Section
        title={`Mixer · ${tracks.length} track${tracks.length === 1 ? '' : 's'}`}
        aside={
          <label className="btn small">
            <input type="file" accept="audio/*" multiple hidden onChange={(e) => (studio.addAudioFiles([...e.target.files]), (e.target.value = ''))} />
            <Icon name="upload" size={14} /> Add audio
          </label>
        }
      >
        <div className="tracks">
          {tracks.map((t) => <TrackStrip key={t.id} track={t} isBeat={t.id === beatTrackId} />)}
        </div>
        {tracks.length === 0 && <p className="note">Drop a song, voice-over or sound effect here.</p>}
      </Section>
      <Section title="Master" aside={<Meter />}>
        <Slider label="Output" value={master.gainDb} min={-24} max={6} step={0.5} onChange={(gainDb) => studio.setMaster({ gainDb })} format={fmtDb} />
        <div className="eq">
          {[['low', 'Low'], ['mid', 'Mid'], ['high', 'High']].map(([k, label]) => (
            <Slider key={k} label={label} value={master[k]} min={-12} max={12} step={0.5} onChange={(v) => studio.setMaster({ [k]: v })} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`} />
          ))}
        </div>
        <Toggle label="Glue compressor" hint="Evens out levels across tracks" checked={master.compressor} onChange={(compressor) => studio.setMaster({ compressor })} />
      </Section>
    </>
  );
}

export function BeatSection() {
  const { analysis, beatAdjust, click } = useStudio();
  const running = analysis.status === 'running';
  return (
    <Section title="Beat detection" aside={<span className={`status ${analysis.status}`}>{running ? 'Analysing…' : analysis.status === 'done' ? `${analysis.beats} beats` : analysis.status}</span>}>
      <div className="bpm-display">
        <strong>{analysis.bpm ? analysis.bpm.toFixed(1) : '—'}</strong>
        <span>BPM</span>
        {analysis.confidence !== undefined && <small>confidence {Math.round(analysis.confidence * 100)}%</small>}
      </div>
      <div className="button-row">
        <button className={`btn small${beatAdjust.tempoScale === 0.5 ? ' on' : ''}`} onClick={() => studio.setBeatAdjust({ tempoScale: beatAdjust.tempoScale === 0.5 ? 1 : 0.5 })}>½ tempo</button>
        <button className={`btn small${beatAdjust.tempoScale === 2 ? ' on' : ''}`} onClick={() => studio.setBeatAdjust({ tempoScale: beatAdjust.tempoScale === 2 ? 1 : 2 })}>2× tempo</button>
        <button className="btn small" onClick={() => studio.setBeatAdjust({ downbeatShift: (beatAdjust.downbeatShift + 1) % 4 })}>Shift bar · {beatAdjust.downbeatShift + 1}</button>
      </div>
      <Slider label="Sync nudge" value={beatAdjust.nudgeMs} min={-150} max={150} step={5} onChange={(nudgeMs) => studio.setBeatAdjust({ nudgeMs })} format={(v) => `${v > 0 ? '+' : ''}${v} ms`} />
      <Toggle label="Click track" hint="Hear the detected beats (preview only)" checked={click} onChange={(on) => studio.setClick(on)} />
    </Section>
  );
}

export function ExportSection() {
  const { project, range, duration, exportState } = useStudio();
  const { width, height } = exportSize(project.aspect, project.resolution);
  const len = range ? range.out - range.in : duration;
  return (
    <Section title="Export">
      <label className="field-label">Format</label>
      <Segmented layoutId="aspect" small options={[{ id: '9:16', name: '9:16 Reels' }, { id: '16:9', name: '16:9' }, { id: '1:1', name: '1:1' }, { id: '4:5', name: '4:5' }]} value={project.aspect} onChange={(aspect) => studio.setProject({ aspect })} />
      <div className="row2">
        <div>
          <label className="field-label">Quality</label>
          <Segmented layoutId="res" small options={[{ id: 720, name: '720p' }, { id: 1080, name: '1080p' }]} value={project.resolution} onChange={(resolution) => studio.setProject({ resolution })} />
        </div>
        <div>
          <label className="field-label">Frame rate</label>
          <Segmented layoutId="fps" small options={[{ id: 30, name: '30' }, { id: 60, name: '60' }]} value={project.fps} onChange={(fps) => studio.setProject({ fps })} />
        </div>
      </div>
      <p className="note">
        {width}×{height} · {len.toFixed(1)}s {range ? '(selected range)' : '(whole song; drag on the timeline ruler to pick a range)'} · MP4 H.264 + AAC
      </p>
      <motion.button className="btn primary wide" whileTap={{ scale: 0.97 }} disabled={exportState.status === 'running'} onClick={() => studio.startExport()}>
        <Icon name="export" /> Render video
      </motion.button>
    </Section>
  );
}

export default function RightPanel() {
  return (
    <aside className="panel right">
      <div className="panel-scroll">
        <BeatSection />
        <MixerSection />
        <ExportSection />
      </div>
    </aside>
  );
}
