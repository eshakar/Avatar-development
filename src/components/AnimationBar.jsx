import { motion, LayoutGroup } from 'framer-motion';

export default function AnimationBar({ clips, activeClip, onPlay }) {
  return (
    <motion.section
      className="panel anim-bar"
      initial={{ opacity: 0, y: 60 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.45, type: 'spring', stiffness: 120, damping: 18 }}
    >
      <div className="anim-bar-head">
        <span className="panel-title">Animations</span>
        <small>Mixamo rigs share bones, so any clip plays on any avatar. ● = native clip</small>
      </div>
      <LayoutGroup id="clips">
        <div className="chips">
          {clips.length === 0 && <span className="muted">Loading clips…</span>}
          {clips.map((clip) => {
            const active = clip.name === activeClip;
            return (
              <motion.button
                key={clip.name}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className={`chip${active ? ' is-active' : ''}`}
                disabled={!clip.compatible}
                onClick={() => onPlay(clip.name)}
                whileTap={{ scale: 0.93 }}
                title={`${clip.source} · ${clip.duration.toFixed(1)}s`}
              >
                {active && (
                  <motion.span
                    layoutId="chip-active"
                    className="chip-bg"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="chip-text">
                  {clip.native && <span className="dot">●</span>}
                  {clip.name}
                </span>
              </motion.button>
            );
          })}
        </div>
      </LayoutGroup>
    </motion.section>
  );
}
