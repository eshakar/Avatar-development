import { useId } from 'react';
import { motion } from 'framer-motion';

export function Section({ title, aside, children }) {
  return (
    <section className="section">
      {(title || aside) && (
        <header className="section-head">
          <h3>{title}</h3>
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Slider({ label, value, min = 0, max = 1, step = 0.01, onChange, format = (v) => v.toFixed(2) }) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider-row">
      <label htmlFor={id}>
        <span>{label}</span>
        <output>{format(value)}</output>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--pct': `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Segmented({ options, value, onChange, layoutId, small }) {
  return (
    <div className={`segmented${small ? ' small' : ''}`} role="radiogroup">
      {options.map((o) => {
        const opt = typeof o === 'object' ? o : { id: o, name: o };
        const active = opt.id === value;
        return (
          <button key={opt.id} role="radio" aria-checked={active} className={active ? 'on' : ''} onClick={() => onChange(opt.id)}>
            {active && <motion.span layoutId={layoutId} className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span>{opt.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ label, hint, checked, onChange }) {
  return (
    <button className="toggle-row" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className={`switch${checked ? ' on' : ''}`}>
        <motion.span layout className="knob" transition={{ type: 'spring', stiffness: 600, damping: 34 }} />
      </span>
    </button>
  );
}

export function Swatches({ colors, value, onChange, label }) {
  return (
    <div className="swatches" aria-label={label}>
      {colors.map((c) => (
        <button
          key={c}
          className={`swatch${c.toLowerCase() === value?.toLowerCase() ? ' on' : ''}`}
          style={{ background: c }}
          aria-label={c}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="swatch custom" title="Custom colour">
        <input type="color" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

const PATHS = {
  play: 'M7 4.5v15l12.5-7.5z',
  pause: 'M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z',
  stop: 'M6 6h12v12H6z',
  back: 'M6 5h2v14H6zM20 5v14L9 12z',
  user: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm-8 9a8 8 0 0 1 16 0',
  dance: 'M13 4.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM9 8l-3 5 3 1-1 7m5-13 2 4 4 1m-6-5-1 6 4 4 1 4',
  scene: 'M3 18l5-6 4 4 3-3 6 5M3 5h18v14H3z',
  camera: 'M3 7h4l2-2h6l2 2h4v12H3zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  mixer: 'M6 3v18M12 3v18M18 3v18M4 15h4M10 8h4M16 13h4',
  export: 'M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v3h16v-3',
  metronome: 'M9 3h6l3.5 18h-13zM12 15l5-9M8 21h8',
  loop: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3m13-3v2a4 4 0 0 1-4 4H4',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  upload: 'M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v4h16v-4',
  close: 'M6 6l12 12M18 6 6 18',
  trash: 'M5 7h14M10 7V4h4v3m-7 0 1 13h8l1-13',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  wave: 'M2 12h2l2-6 3 12 3-9 3 6 2-3h5',
};

export function Icon({ name, size = 18 }) {
  const fill = name === 'play' || name === 'pause' || name === 'stop' || name === 'back' || name === 'sparkle';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

export const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
};

export const fmtDb = (db) => (db <= -60 ? '−∞ dB' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`);
