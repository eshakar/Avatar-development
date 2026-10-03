import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AvatarStage } from './three/AvatarStage.js';
import { BackgroundMusic, BUILTIN_TRACKS, isAudioFile, loadMusicManifest } from './audio/BackgroundMusic.js';
import { LOOK_STYLES } from './three/materials.js';
import { BUILTIN_AVATARS, TINTS, loadLocalManifest, randomAccent, typeFromName } from './data/avatars.js';
import AvatarGallery from './components/AvatarGallery.jsx';
import AnimationBar from './components/AnimationBar.jsx';
import ControlPanel from './components/ControlPanel.jsx';
import { DropOverlay, LoadingOverlay, Toasts } from './components/Overlays.jsx';

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function useMediaQuery(query) {
  return useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', notify);
      return () => mql.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
  );
}

export default function App() {
  const mountRef = useRef(null);
  const stageRef = useRef(null);
  const musicRef = useRef(null);

  const [avatars, setAvatars] = useState(BUILTIN_AVATARS);
  const [selectedId, setSelectedId] = useState(BUILTIN_AVATARS[0].id);
  const [loading, setLoading] = useState({ active: true, progress: 0, label: '' });
  const [clips, setClips] = useState([]);
  const [activeClip, setActiveClip] = useState(null);
  const [look, setLook] = useState({ style: 'original', tint: '#ffffff' });
  const [cameraPreset, setCameraPreset] = useState('front');
  const [autoRotate, setAutoRotate] = useState(false);
  const [crowdCount, setCrowdCount] = useState(24);
  const [crowdOn, setCrowdOn] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tracks, setTracks] = useState(BUILTIN_TRACKS);
  const [trackId, setTrackId] = useState(BUILTIN_TRACKS[0].id);
  const [musicOn, setMusicOn] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const isMobile = useMediaQuery('(max-width: 900px)');

  const selected = avatars.find((a) => a.id === selectedId) ?? avatars[0];

  const toast = useCallback((text, tone = 'info') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((list) => [...list, { id, text, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4200);
  }, []);

  // Mount the Three.js stage once.
  useEffect(() => {
    const stage = new AvatarStage(mountRef.current, {
      onLoading: setLoading,
      onLibrary: setClips,
      onClip: setActiveClip,
      onError: (message) => toast(message, 'error'),
    });
    stageRef.current = stage;
    return () => {
      stage.dispose();
      stageRef.current = null;
    };
  }, [toast]);

  // Background music player, created once.
  useEffect(() => {
    const music = new BackgroundMusic();
    music.setTrack(BUILTIN_TRACKS[0]);
    musicRef.current = music;
    return () => {
      music.dispose();
      musicRef.current = null;
    };
  }, []);

  // Pick up tracks listed in /public/music/manifest.json.
  useEffect(() => {
    loadMusicManifest().then((local) => {
      if (local.length) setTracks((list) => [...list, ...local.filter((l) => !list.some((t) => t.id === l.id))]);
    });
  }, []);

  useEffect(() => {
    musicRef.current?.setVolume(volume);
  }, [volume]);

  // Pick up avatars listed in /public/models/manifest.json.
  useEffect(() => {
    loadLocalManifest().then((local) => {
      if (!local.length) return;
      setAvatars((list) => [...list, ...local.filter((l) => !list.some((a) => a.id === l.id))]);
      toast(`Found ${local.length} local Mixamo avatar${local.length > 1 ? 's' : ''}`, 'success');
    });
  }, [toast]);

  useEffect(() => {
    stageRef.current?.setLook(look.style, look.tint);
  }, [look]);

  useEffect(() => {
    stageRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !selected) return;
    document.documentElement.style.setProperty('--accent', selected.accent);
    stage.setAccent(selected.accent);
    stage.showAvatar(selected).then(() => stage.preload(BUILTIN_AVATARS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const changeCamera = (preset) => {
    setCameraPreset(preset);
    stageRef.current?.flyTo(preset);
  };

  const spawnCrowd = () => {
    setCrowdOn(true);
    stageRef.current?.spawnCrowd(avatars, crowdCount);
    changeCamera('crowd');
  };

  const clearCrowd = () => {
    setCrowdOn(false);
    stageRef.current?.clearCrowd();
    changeCamera('front');
  };

  const remix = () => {
    setLook({ style: pick(LOOK_STYLES), tint: pick(TINTS) });
    const usable = clips.filter((c) => c.compatible && c.name !== activeClip);
    if (usable.length) stageRef.current?.playClip(pick(usable).name);
  };

  const startMusic = useCallback(
    async (track) => {
      const music = musicRef.current;
      if (!music) return;
      try {
        if (track) await music.setTrack(track);
        if (!music.playing) await music.play();
        setMusicOn(true);
      } catch (err) {
        console.error(err);
        setMusicOn(false);
        toast("Couldn't play that track", 'error');
      }
    },
    [toast],
  );

  const toggleMusic = () => {
    if (!musicOn) return startMusic();
    musicRef.current?.pause();
    setMusicOn(false);
  };

  const chooseTrack = (id) => {
    const track = tracks.find((t) => t.id === id);
    if (!track) return;
    setTrackId(id);
    if (musicOn) startMusic(track);
    else musicRef.current?.setTrack(track);
  };

  const addMusicFiles = useCallback(
    (files) => {
      const added = files.map((file) => ({
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name.replace(/\.[^.]+$/, ''),
        tag: 'Your upload',
        url: URL.createObjectURL(file),
      }));
      if (!added.length) return;
      setTracks((list) => [...list, ...added]);
      setTrackId(added[0].id);
      startMusic(added[0]);
      toast(`Added ${added.length} track${added.length > 1 ? 's' : ''}`, 'success');
    },
    [startMusic, toast],
  );

  const handleFiles = useCallback(
    async (files) => {
      const stage = stageRef.current;
      if (!stage) return;
      addMusicFiles(files.filter((file) => isAudioFile(file.name)));
      for (const file of files.filter((f) => !isAudioFile(f.name))) {
        const type = typeFromName(file.name);
        if (!type) {
          toast(`${file.name}: use .fbx, .glb or an audio file`, 'error');
          continue;
        }
        const def = {
          id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name.replace(/\.[^.]+$/, ''),
          tag: 'Your upload',
          url: URL.createObjectURL(file),
          type,
          accent: randomAccent(),
          emoji: '✨',
        };
        try {
          const { hasMesh, added } = await stage.registerAsset(def);
          if (hasMesh) {
            setAvatars((list) => [...list, def]);
            setSelectedId(def.id);
            toast(`Added ${def.name}${added.length ? ` + ${added.length} clip(s)` : ''}`, 'success');
          } else if (added.length) {
            toast(`Added ${added.length} animation(s) from ${def.name}. Try them on any avatar.`, 'success');
          } else {
            toast(`${def.name} has no mesh or animations`, 'error');
          }
        } catch (err) {
          console.error(err);
          toast(`Couldn't read ${file.name}`, 'error');
        }
      }
    },
    [addMusicFiles, toast],
  );

  // Window-wide drag & drop.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const onEnter = (e) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const onLeave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onOver = (e) => hasFiles(e) && e.preventDefault();
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      handleFiles([...e.dataTransfer.files]);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFiles]);

  const controlProps = {
    look,
    onLook: setLook,
    cameraPreset,
    onCamera: changeCamera,
    autoRotate,
    onAutoRotate: setAutoRotate,
    crowdCount,
    onCrowdCount: setCrowdCount,
    crowdOn,
    onSpawnCrowd: spawnCrowd,
    onClearCrowd: clearCrowd,
    onRemix: remix,
    music: {
      tracks,
      trackId,
      on: musicOn,
      volume,
      onToggle: toggleMusic,
      onTrack: chooseTrack,
      onVolume: setVolume,
      onUpload: addMusicFiles,
    },
  };

  return (
    <div className="app">
      <div className="stage" ref={mountRef} />

      <div className="hud">
        <motion.header
          className="header"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 140, damping: 18 }}
        >
          <div className="brand">
            <motion.span
              className="brand-mark"
              animate={{ rotate: [0, 90, 180, 270, 360] }}
              transition={{ repeat: Infinity, duration: 12, ease: 'linear' }}
            />
            <div>
              <h1>
                Avatar<span>Lab</span>
              </h1>
              <p>Three.js · GSAP · Framer Motion · Mixamo</p>
            </div>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={selected?.id}
              className="now-showing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <small>Now showing</small>
              <strong>{selected?.name}</strong>
            </motion.div>
          </AnimatePresence>
        </motion.header>

        <AvatarGallery avatars={avatars} selectedId={selectedId} onSelect={setSelectedId} onUpload={handleFiles} />

        {isMobile ? (
          <>
            {!panelOpen && (
              <motion.button
                className="btn primary sheet-toggle"
                onClick={() => setPanelOpen(true)}
                whileTap={{ scale: 0.94 }}
              >
                Controls
              </motion.button>
            )}
            <AnimatePresence>
              {panelOpen && (
                <ControlPanel
                  {...controlProps}
                  className="sheet"
                  onClose={() => setPanelOpen(false)}
                  initial={{ y: '110%' }}
                  animate={{ y: 0 }}
                  exit={{ y: '110%' }}
                  transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                />
              )}
            </AnimatePresence>
          </>
        ) : (
          <ControlPanel {...controlProps} />
        )}

        <AnimationBar clips={clips} activeClip={activeClip} onPlay={(name) => stageRef.current?.playClip(name)} />
      </div>

      <LoadingOverlay loading={loading} />
      <Toasts toasts={toasts} />
      <DropOverlay visible={dragging} />
    </div>
  );
}
