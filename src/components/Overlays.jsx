import { motion, AnimatePresence } from 'framer-motion';
import { studio, useStudio } from '../state/studio.js';
import { Icon } from './ui.jsx';

export function LoadingOverlay() {
  const loading = useStudio((s) => s.loading);
  return (
    <AnimatePresence>
      {loading.active && (
        <motion.div
          className="loader"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        >
          <motion.span className="loader-orbit" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }} />
          <div className="loader-body">
            <span>{loading.label || 'Loading'}</span>
            <div className="progress">
              <motion.div className="progress-fill" animate={{ width: `${Math.round((loading.progress ?? 0.15) * 100)}%` }} />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toasts() {
  const toasts = useStudio((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            className={`toast ${toast.tone}`}
            initial={{ opacity: 0, y: -16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
          >
            {toast.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function DropOverlay({ visible }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="drop-box" animate={{ scale: [1, 1.03, 1] }} transition={{ repeat: Infinity, duration: 1.4 }}>
            <Icon name="upload" size={28} />
            <strong>Drop files to add them</strong>
            <span>Songs and sounds (.mp3, .wav, .m4a…) become mixer tracks. Characters (.fbx / .glb) join the avatars. Animation-only Mixamo FBX files become dance moves.</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`);

export function ExportModal() {
  const ex = useStudio((s) => s.exportState);
  const open = ex.status === 'running' || ex.status === 'done' || ex.status === 'error';
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="modal" initial={{ y: 24, scale: 0.97 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.97 }}>
            {ex.status === 'running' && (
              <>
                <h2>Rendering your video</h2>
                <p className="muted">
                  {ex.phase}
                  {ex.frames ? ` · frame ${ex.frame} / ${ex.frames}` : ''}
                  {ex.eta !== undefined ? ` · ~${Math.ceil(ex.eta)}s left` : ''}
                </p>
                <div className="progress big">
                  <motion.div className="progress-fill" animate={{ width: `${Math.round((ex.progress ?? 0) * 100)}%` }} transition={{ ease: 'linear', duration: 0.2 }} />
                </div>
                <p className="note">
                  Every frame is rendered at its exact timestamp and encoded with the mixed audio, so the dance stays locked to the beat no matter how fast your machine is.
                </p>
                <div className="button-row end">
                  <button className="btn" onClick={() => studio.cancelExport()}>Cancel</button>
                </div>
              </>
            )}
            {ex.status === 'done' && (
              <>
                <h2>Your video is ready</h2>
                <video className={`result${ex.height > ex.width ? ' portrait' : ''}`} src={ex.url} controls autoPlay loop playsInline />
                <p className="muted">
                  {ex.width}×{ex.height} · {fmtSize(ex.size)} · {ex.codec?.toUpperCase()}
                </p>
                <div className="button-row end">
                  <button className="btn" onClick={() => studio.closeExport()}>Close</button>
                  <a className="btn primary" href={ex.url} download={ex.filename}>
                    <Icon name="export" size={16} /> Download MP4
                  </a>
                </div>
              </>
            )}
            {ex.status === 'error' && (
              <>
                <h2>Export failed</h2>
                <p className="muted">{ex.message}</p>
                <div className="button-row end">
                  <button className="btn" onClick={() => studio.closeExport()}>Close</button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
