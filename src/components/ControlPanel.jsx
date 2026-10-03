import { motion } from 'framer-motion';
import { LOOK_STYLES } from '../three/materials.js';
import { CAMERA_PRESETS } from '../three/AvatarStage.js';
import { TINTS } from '../data/avatars.js';


function Segmented({ id, options, value, onChange }) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button
          key={option}
          className={option === value ? 'is-active' : ''}
          onClick={() => onChange(option)}
          aria-pressed={option === value}
        >
          {option === value && (
            <motion.span
              layoutId={`${id}-pill`}
              className="segmented-pill"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          )}
          <span>{option}</span>
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button className="toggle-row" onClick={() => onChange(!checked)} aria-pressed={checked}>
      <span>{label}</span>
      <span className={`toggle${checked ? ' on' : ''}`}>
        <motion.span layout className="toggle-knob" transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
      </span>
    </button>
  );
}

function MusicControls({ tracks, trackId, on, volume, onToggle, onTrack, onVolume, onUpload }) {
  return (
    <>
      <div className="music-row">
        <motion.button
          className={`btn music-play${on ? ' primary' : ''}`}
          onClick={onToggle}
          whileTap={{ scale: 0.92 }}
          aria-label={on ? 'Pause music' : 'Play music'}
        >
          {on ? '❚❚' : '▶'}
        </motion.button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          className="slider"
          aria-label="Music volume"
        />
      </div>
      <ul className="track-list">
        {tracks.map((track) => {
          const active = track.id === trackId;
          return (
            <li key={track.id}>
              <button className={`track${active ? ' is-active' : ''}`} onClick={() => onTrack(track.id)} aria-pressed={active}>
                <span className="track-icon" aria-hidden>
                  {active && on ? (
                    <span className="eq">
                      {[0, 1, 2].map((i) => (
                        <motion.i
                          key={i}
                          animate={{ scaleY: [0.3, 1, 0.5, 0.9, 0.3] }}
                          transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.18 }}
                        />
                      ))}
                    </span>
                  ) : (
                    '♪'
                  )}
                </span>
                <span className="track-meta">
                  <strong>{track.name}</strong>
                  <small>{track.tag}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <label className="btn upload-music">
        <input
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => {
            onUpload([...e.target.files]);
            e.target.value = '';
          }}
        />
        + Add music file
      </label>
    </>
  );
}

const section = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0 },
};

export default function ControlPanel({
  look,
  onLook,
  cameraPreset,
  onCamera,
  autoRotate,
  onAutoRotate,
  crowdCount,
  onCrowdCount,
  crowdOn,
  onSpawnCrowd,
  onClearCrowd,
  onRemix,
  music,
  onClose,
  className = '',
  ...motionProps
}) {
  return (
    <motion.aside
      className={`panel controls ${className}`}
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.25, type: 'spring', stiffness: 120, damping: 18, staggerChildren: 0.06 }}
      {...motionProps}
    >
      {onClose && (
        <button className="sheet-close" onClick={onClose} aria-label="Close controls">
          ×
        </button>
      )}
      <motion.div variants={section} initial="hidden" animate="show" className="control-group">
        <div className="panel-title">Look</div>
        <Segmented id="style" options={LOOK_STYLES} value={look.style} onChange={(style) => onLook({ ...look, style })} />
        <div className="swatches">
          {TINTS.map((tint) => (
            <motion.button
              key={tint}
              className={`swatch${tint === look.tint ? ' is-active' : ''}`}
              style={{ background: tint }}
              onClick={() => onLook({ ...look, tint })}
              whileHover={{ scale: 1.15 }}
              whileTap={{ scale: 0.9 }}
              aria-label={`Tint ${tint}`}
            />
          ))}
          <label className="swatch custom" aria-label="Custom tint">
            <input type="color" value={look.tint} onChange={(e) => onLook({ ...look, tint: e.target.value })} />
          </label>
        </div>
      </motion.div>

      <motion.div variants={section} initial="hidden" animate="show" className="control-group">
        <div className="panel-title">Camera</div>
        <Segmented id="camera" options={Object.keys(CAMERA_PRESETS)} value={cameraPreset} onChange={onCamera} />
        <Toggle label="Auto-rotate" checked={autoRotate} onChange={onAutoRotate} />
      </motion.div>

      <motion.div variants={section} initial="hidden" animate="show" className="control-group">
        <div className="panel-title">Music</div>
        <MusicControls {...music} />
      </motion.div>

      <motion.div variants={section} initial="hidden" animate="show" className="control-group">
        <div className="panel-title">
          Crowd <span className="count">{crowdCount}</span>
        </div>
        <input
          type="range"
          min="6"
          max="60"
          step="1"
          value={crowdCount}
          onChange={(e) => onCrowdCount(Number(e.target.value))}
          className="slider"
          aria-label="Crowd size"
        />
        <div className="button-row">
          <motion.button className="btn primary" onClick={onSpawnCrowd} whileTap={{ scale: 0.95 }}>
            {crowdOn ? 'Respawn crowd' : 'Spawn crowd'}
          </motion.button>
          {crowdOn && (
            <motion.button
              className="btn"
              onClick={onClearCrowd}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              whileTap={{ scale: 0.95 }}
            >
              Clear
            </motion.button>
          )}
        </div>
        <small className="muted">Mixes every loaded rig with random looks and clips.</small>
      </motion.div>

      <motion.button
        className="btn remix"
        onClick={onRemix}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.95, rotate: -2 }}
      >
        🎲 Remix avatar
      </motion.button>
    </motion.aside>
  );
}
