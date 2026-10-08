import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { engine, studio, useStudio } from '../state/studio.js';
import { Icon, fmtTime } from './ui.jsx';

// Time / bar.beat readouts update every frame straight into the DOM, not through React state.
function Clock() {
  const timeRef = useRef(null);
  const beatRef = useRef(null);
  const duration = useStudio((s) => s.duration);
  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!engine.audio || !timeRef.current) return;
      const t = engine.audio.audibleTime;
      timeRef.current.textContent = fmtTime(t);
      const g = engine.grid;
      if (g) {
        const b = g.beatAt(t);
        const bar = g.bar(b) + 1;
        beatRef.current.textContent = bar >= 1 ? `${bar}.${g.beatInBar(b) + 1}` : '—';
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="clock">
      <span ref={timeRef} className="mono">0:00.00</span>
      <small className="mono">/ {fmtTime(duration)}</small>
      <span className="bar-beat">
        <small>BAR</small>
        <span ref={beatRef} className="mono">—</span>
      </span>
    </div>
  );
}

export default function TopBar({ onExportPanel }) {
  const { playing, click, loop, analysis, range } = useStudio();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        <div>
          <h1>
            Avatar<span>Lab</span>
          </h1>
          <p>Beat-synced dance studio</p>
        </div>
      </div>

      <div className="transport">
        <button className="round" onClick={() => studio.seek(range?.in ?? 0)} aria-label="Back to start">
          <Icon name="back" size={16} />
        </button>
        <motion.button className="round play" onClick={() => studio.togglePlay()} whileTap={{ scale: 0.9 }} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={20} />
        </motion.button>
        <Clock />
        <span className="bpm-chip" title="Detected tempo">
          {analysis.status === 'running' ? '…' : analysis.bpm ? analysis.bpm.toFixed(1) : '—'} <small>BPM</small>
        </span>
        <button className={`round ghost${click ? ' on' : ''}`} onClick={() => studio.setClick(!click)} title="Click track" aria-pressed={click}>
          <Icon name="metronome" size={16} />
        </button>
        <button className={`round ghost${loop ? ' on' : ''}`} onClick={() => studio.setLoop(!loop)} title="Loop" aria-pressed={loop}>
          <Icon name="loop" size={16} />
        </button>
      </div>

      <div className="top-actions">
        <button className="btn ghost small" onClick={() => studio.shuffle()} title="New choreography and camera plan">
          <Icon name="shuffle" size={14} /> Remix
        </button>
        <motion.button className="btn primary" whileTap={{ scale: 0.96 }} onClick={onExportPanel ?? (() => studio.startExport())}>
          <Icon name="export" size={16} /> Export
        </motion.button>
      </div>
    </header>
  );
}
