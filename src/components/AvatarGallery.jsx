import { motion, AnimatePresence } from 'framer-motion';

const list = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.35 } },
};
const item = {
  hidden: { opacity: 0, x: -24 },
  show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 260, damping: 24 } },
};

export default function AvatarGallery({ avatars, selectedId, onSelect, onUpload }) {
  return (
    <motion.aside
      className="panel gallery"
      initial={{ opacity: 0, x: -40 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.15, type: 'spring', stiffness: 120, damping: 18 }}
    >
      <div className="panel-title">
        Avatars <span className="count">{avatars.length}</span>
      </div>
      <motion.ul className="gallery-list" variants={list} initial="hidden" animate="show">
        <AnimatePresence initial={false}>
          {avatars.map((avatar) => {
            const active = avatar.id === selectedId;
            return (
              <motion.li key={avatar.id} layout variants={item} exit={{ opacity: 0, scale: 0.8 }}>
                <motion.button
                  className={`avatar-card${active ? ' is-active' : ''}`}
                  style={{ '--card-accent': avatar.accent }}
                  onClick={() => onSelect(avatar.id)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  aria-pressed={active}
                >
                  {active && (
                    <motion.span
                      layoutId="card-glow"
                      className="card-glow"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="avatar-thumb" aria-hidden>
                    {avatar.emoji}
                  </span>
                  <span className="avatar-meta">
                    <strong>{avatar.name}</strong>
                    <small>{avatar.tag}</small>
                  </span>
                </motion.button>
              </motion.li>
            );
          })}
        </AnimatePresence>
        <motion.li variants={item} layout>
          <motion.label className="avatar-card upload-card" whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
            <input
              type="file"
              accept=".fbx,.glb,.gltf"
              multiple
              hidden
              onChange={(e) => {
                onUpload([...e.target.files]);
                e.target.value = '';
              }}
            />
            <span className="avatar-thumb" aria-hidden>
              +
            </span>
            <span className="avatar-meta">
              <strong>Add Mixamo file</strong>
              <small>.fbx / .glb, or drop anywhere</small>
            </span>
          </motion.label>
        </motion.li>
      </motion.ul>
    </motion.aside>
  );
}
