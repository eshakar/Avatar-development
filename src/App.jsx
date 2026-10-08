import { useEffect, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { studio, useStudio } from './state/studio.js';
import TopBar from './components/TopBar.jsx';
import LeftPanel, { TABS, TabContent } from './components/LeftPanel.jsx';
import RightPanel, { BeatSection, ExportSection, MixerSection } from './components/RightPanel.jsx';
import Timeline from './components/Timeline.jsx';
import Viewport from './components/Viewport.jsx';
import { DropOverlay, ExportModal, LoadingOverlay, Toasts } from './components/Overlays.jsx';
import { Icon } from './components/ui.jsx';

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

const MOBILE_TABS = [...TABS, { id: 'audio', name: 'Audio', icon: 'mixer' }, { id: 'export', name: 'Export', icon: 'export' }];

function MobilePanel() {
  const tab = useStudio((s) => s.tab);
  return (
    <div className="mobile-panel">
      <nav className="mobile-tabs">
        {MOBILE_TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'on' : ''} onClick={() => useStudio.setState({ tab: t.id })}>
            <Icon name={t.icon} size={18} />
            <span>{t.name}</span>
          </button>
        ))}
      </nav>
      <div className="mobile-body">
        {tab === 'audio' ? (
          <>
            <BeatSection />
            <MixerSection />
          </>
        ) : tab === 'export' ? (
          <ExportSection />
        ) : (
          <TabContent tab={tab} />
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [dragging, setDragging] = useState(false);
  const isMobile = useMediaQuery('(max-width: 980px)');

  // Window-wide drag & drop.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const onEnter = (e) => hasFiles(e) && (depth++, setDragging(true));
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
      studio.handleFiles([...e.dataTransfer.files]);
    };
    const onKey = (e) => {
      if (e.code !== 'Space' || /input|textarea|select/i.test(e.target.tagName)) return;
      e.preventDefault();
      studio.togglePlay();
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <motion.div className={`app${isMobile ? ' mobile' : ''}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <TopBar onExportPanel={isMobile ? () => useStudio.setState({ tab: 'export' }) : undefined} />
      {!isMobile && <LeftPanel />}
      <Viewport />
      {!isMobile && <RightPanel />}
      <Timeline />
      {isMobile && <MobilePanel />}
      <LoadingOverlay />
      <Toasts />
      <DropOverlay visible={dragging} />
      <ExportModal />
    </motion.div>
  );
}
