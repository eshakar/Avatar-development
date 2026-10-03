import { motion, AnimatePresence } from 'framer-motion';

export function LoadingOverlay({ loading }) {
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
          <motion.span
            className="loader-orbit"
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
          />
          <div className="loader-body">
            <span>{loading.label || 'Loading'}</span>
            <div className="progress">
              <motion.div
                className="progress-fill"
                animate={{ width: `${Math.round((loading.progress ?? 0) * 100)}%` }}
                transition={{ ease: 'easeOut' }}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toasts({ toasts }) {
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
          <motion.div
            className="drop-box"
            initial={{ scale: 0.85 }}
            animate={{ scale: [1, 1.03, 1] }}
            transition={{ repeat: Infinity, duration: 1.4 }}
          >
            <strong>Drop Mixamo or music files</strong>
            <span>
              Characters (.fbx / .glb) join the gallery. Animation-only FBX joins the clip library. Audio files become
              background music.
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
