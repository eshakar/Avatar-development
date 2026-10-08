import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { engine, studio, useStudio } from '../state/studio.js';
import { SHOTS } from '../three/director.js';
import { fmtTime } from './ui.jsx';

const RULER = 22;
const WAVE = 64;
const DANCE = 30;
const CAM = 18;
const GAP = 4;
const HEIGHT = RULER + WAVE + DANCE + CAM + GAP * 3;

const hue = (id) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
const shotName = (id) => SHOTS.find((s) => s.id === id)?.name ?? id;

export default function Timeline() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const view = useRef({ start: 0, pps: 0, fit: true });
  const drag = useRef(null);
  const [menu, setMenu] = useState(null);
  const moves = useStudio((s) => s.moves);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf;
    let frame = 0;
    let accent = '#a78bfa';

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const wrap = wrapRef.current;
      if (!wrap || !engine.audio) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      const W = wrap.clientWidth;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(HEIGHT * dpr);
        canvas.style.width = `${W}px`;
        canvas.style.height = `${HEIGHT}px`;
      }
      if (frame++ % 30 === 0) accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || accent;

      const { plan, shots, range } = useStudio.getState();
      const duration = engine.audio.duration;
      const v = view.current;
      if (v.fit || !v.pps) {
        v.pps = W / duration;
        v.start = 0;
      }
      v.pps = Math.max(W / duration, v.pps);
      v.start = Math.max(0, Math.min(v.start, duration - W / v.pps));
      const x = (t) => (t - v.start) * v.pps;
      const tAt = (px) => v.start + px / v.pps;
      const now = engine.audio.audibleTime;

      // Follow the playhead while playing.
      if (engine.audio.playing && !v.fit && (x(now) > W * 0.92 || x(now) < 0)) v.start = now - (W * 0.1) / v.pps;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, HEIGHT);
      const grid = engine.grid;
      const yWave = RULER + GAP;
      const yDance = yWave + WAVE + GAP;
      const yCam = yDance + DANCE + GAP;

      // Range selection.
      if (range) {
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(x(range.in), 0, x(range.out) - x(range.in), HEIGHT);
        ctx.fillStyle = accent;
        ctx.fillRect(x(range.in), 0, x(range.out) - x(range.in), 3);
      }

      // Waveform of the beat-source track.
      const beatTrack = engine.audio.tracks.find((t) => t.id === useStudio.getState().beatTrackId);
      const result = engine.analyses.get(beatTrack?.id);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(0, yWave, W, WAVE);
      if (result && beatTrack) {
        const { peaks, peaksRate } = result;
        ctx.fillStyle = `${beatTrack.color}`;
        ctx.globalAlpha = 0.75;
        const mid = yWave + WAVE / 2;
        for (let px = 0; px < W; px++) {
          const a = Math.floor((tAt(px) - beatTrack.offset) * peaksRate);
          const b = Math.max(a + 1, Math.floor((tAt(px + 1) - beatTrack.offset) * peaksRate));
          if (b <= 0 || a >= peaks.length) continue;
          let m = 0;
          for (let k = Math.max(0, a); k < Math.min(peaks.length, b); k++) m = Math.max(m, peaks[k]);
          const h = Math.max(1, m * (WAVE / 2 - 2));
          ctx.fillRect(px, mid - h, 1, h * 2);
        }
        ctx.globalAlpha = 1;
      }

      // Beats and bars.
      if (grid) {
        const b0 = Math.floor(grid.beatAt(v.start));
        const b1 = Math.ceil(grid.beatAt(tAt(W)));
        const step = v.pps * grid.period < 5 ? 4 : 1;
        ctx.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
        for (let b = b0; b <= b1; b++) {
          const down = grid.isDownbeat(b);
          if (!down && step > 1) continue;
          const px = Math.round(x(grid.timeAt(b))) + 0.5;
          ctx.strokeStyle = down ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.1)';
          ctx.beginPath();
          ctx.moveTo(px, down ? 8 : 14);
          ctx.lineTo(px, yWave + WAVE);
          ctx.stroke();
          if (down) {
            const bar = grid.bar(b) + 1;
            if (bar > 0 && (v.pps * grid.period * 4 > 26 || bar % 4 === 1)) {
              ctx.fillStyle = 'rgba(255,255,255,0.55)';
              ctx.fillText(String(bar), px + 3, 15);
            }
          }
        }

        // Choreography blocks.
        const current = engine.stage?.currentSegment;
        for (const s of plan) {
          const xa = x(grid.timeAt(s.start));
          const xb = x(grid.timeAt(s.end));
          if (xb < 0 || xa > W) continue;
          const h = hue(s.moveId);
          const active = current && current.index === s.index;
          ctx.fillStyle = `hsla(${h}, 70%, ${active ? 62 : 52}%, ${active ? 0.95 : 0.55})`;
          roundRect(ctx, xa + 1, yDance, Math.max(2, xb - xa - 2), DANCE, 6);
          ctx.fill();
          if (s.overridden) {
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.setLineDash([3, 3]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (xb - xa > 34) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(xa + 4, yDance, xb - xa - 8, DANCE);
            ctx.clip();
            ctx.fillStyle = '#0b0b12';
            ctx.font = '600 11px "Inter", system-ui, sans-serif';
            ctx.fillText(`${s.kind === 'mocap' ? '● ' : ''}${s.name}`, xa + 7, yDance + 19);
            ctx.restore();
          }
        }

        // Camera cuts.
        for (const c of shots) {
          const xa = x(grid.timeAt(c.start));
          const xb = x(grid.timeAt(c.end));
          if (xb < 0 || xa > W) continue;
          ctx.fillStyle = 'rgba(255,255,255,0.07)';
          roundRect(ctx, xa + 1, yCam, Math.max(2, xb - xa - 2), CAM, 4);
          ctx.fill();
          if (xb - xa > 40) {
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '500 10px "Inter", system-ui, sans-serif';
            ctx.fillText(shotName(c.shot), xa + 6, yCam + 12.5);
          }
        }
      }

      // Lane labels.
      ctx.font = '600 9px "Inter", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('DANCE', 6, yDance - 1);
      ctx.fillText('CAMERA', 6, yCam - 1);

      // Playhead.
      const ph = Math.round(x(now)) + 0.5;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ph, 0);
      ctx.lineTo(ph, HEIGHT);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.moveTo(ph - 5, 0);
      ctx.lineTo(ph + 5, 0);
      ctx.lineTo(ph, 7);
      ctx.fill();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  const timeAtEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const v = view.current;
    return v.start + (e.clientX - rect.left) / v.pps;
  };

  const onPointerDown = (e) => {
    setMenu(null);
    const rect = canvasRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const t = timeAtEvent(e);
    canvasRef.current.setPointerCapture(e.pointerId);
    if (y < RULER) {
      drag.current = { kind: 'range', from: t, moved: false };
      return;
    }
    const yDance = RULER + GAP + WAVE + GAP;
    if (y >= yDance && y < yDance + DANCE && engine.grid) {
      const beat = engine.grid.beatAt(t);
      const seg = useStudio.getState().plan.find((s) => beat >= s.start && beat < s.end);
      if (seg) {
        drag.current = { kind: 'menu', seg, x: e.clientX - rect.left, startX: e.clientX };
        return;
      }
    }
    drag.current = { kind: 'scrub' };
    studio.seek(t);
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const t = timeAtEvent(e);
    if (d.kind === 'scrub') studio.seek(t);
    else if (d.kind === 'range') {
      if (Math.abs(t - d.from) * view.current.pps > 4) d.moved = true;
      if (d.moved) {
        const dur = engine.audio.duration;
        const a = Math.max(0, Math.min(d.from, t));
        const b = Math.min(dur, Math.max(d.from, t));
        studio.setRange({ in: a, out: b });
      }
    } else if (d.kind === 'menu' && Math.abs(e.clientX - d.startX) > 4) {
      drag.current = { kind: 'scrub' };
    }
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'range' && !d.moved) {
      studio.setRange(null);
      studio.seek(timeAtEvent(e));
    }
    if (d.kind === 'range' && d.moved) {
      // Snap the range to the nearest bar lines so loops and exports start on the beat.
      const { range } = useStudio.getState();
      const g = engine.grid;
      if (range && g) {
        const snap = (t) => g.timeAt(Math.round((g.beatAt(t) - g.downbeat) / 4) * 4 + g.downbeat);
        const a = Math.max(0, snap(range.in));
        const b = Math.min(engine.audio.duration, snap(range.out));
        studio.setRange(b - a > 0.5 ? { in: a, out: b } : null);
        if (b - a > 0.5) studio.seek(a);
      }
    }
    if (d.kind === 'menu') {
      studio.seek(engine.grid.timeAt(d.seg.start));
      setMenu({ x: d.x, seg: d.seg });
    }
  };

  const onWheel = (e) => {
    const v = view.current;
    const W = wrapRef.current.clientWidth;
    if (e.ctrlKey || e.metaKey) {
      const t = timeAtEvent(e);
      const pps = Math.max(W / engine.audio.duration, Math.min(800, v.pps * Math.exp(-e.deltaY * 0.01)));
      v.fit = false;
      v.start = t - (t - v.start) * (v.pps / pps);
      v.pps = pps;
    } else if (!v.fit) {
      v.start += (e.deltaX || e.deltaY) / v.pps;
    }
  };

  useEffect(() => {
    const el = canvasRef.current;
    const stop = (e) => (e.ctrlKey || e.metaKey) && e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  const zoom = (factor) => {
    const v = view.current;
    const W = wrapRef.current.clientWidth;
    const now = engine.audio.audibleTime;
    v.fit = false;
    const pps = Math.max(W / engine.audio.duration, Math.min(800, v.pps * factor));
    v.start = now - (now - v.start) * (v.pps / pps);
    v.pps = pps;
  };

  return (
    <div className="timeline">
      <div className="timeline-bar">
        <span className="timeline-title">Timeline</span>
        <span className="hint">Drag the ruler to select a range · click a dance block to change its move · ⌘/Ctrl + scroll to zoom</span>
        <div className="zoom">
          <button className="mini" onClick={() => zoom(1 / 1.5)} aria-label="Zoom out">−</button>
          <button className="mini" onClick={() => (view.current.fit = true)}>Fit</button>
          <button className="mini" onClick={() => zoom(1.5)} aria-label="Zoom in">+</button>
        </div>
      </div>
      <div className="timeline-canvas" ref={wrapRef}>
        <canvas ref={canvasRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel} />
        <AnimatePresence>
          {menu && (
            <motion.div
              className="move-menu"
              style={{ left: Math.min(menu.x, (wrapRef.current?.clientWidth ?? 400) - 230) }}
              initial={{ opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.97 }}
            >
              <header>
                Phrase {menu.seg.index + 1} · {fmtTime(engine.grid.timeAt(menu.seg.start))}
                <button className="mini" onClick={() => setMenu(null)} aria-label="Close">×</button>
              </header>
              <button className={!menu.seg.overridden ? 'on' : ''} onClick={() => (studio.overridePhrase(menu.seg.index, null), setMenu(null))}>
                ✨ Auto (matches energy)
              </button>
              {moves.map((m) => (
                <button key={m.id} className={menu.seg.overridden && menu.seg.moveId === m.id ? 'on' : ''} onClick={() => (studio.overridePhrase(menu.seg.index, m.id), setMenu(null))}>
                  <i style={{ background: `hsl(${hue(m.id)},70%,55%)` }} />
                  {m.name}
                  <small>{m.kind === 'mocap' ? 'mocap' : 'procedural'}</small>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2));
}
