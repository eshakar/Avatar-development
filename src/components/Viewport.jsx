import { useEffect, useRef } from 'react';
import { engine, studio, useStudio } from '../state/studio.js';

// Hosts the WebGL canvas plus a small HUD (current move, beat pulse).
export default function Viewport() {
  const mountRef = useRef(null);
  const hudRef = useRef(null);
  const moveRef = useRef(null);
  const dotRefs = useRef([]);
  const aspect = useStudio((s) => s.project.aspect);

  useEffect(() => {
    studio.init(mountRef.current);
    return () => studio.dispose();
  }, []);

  useEffect(() => {
    let raf;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const g = engine.grid;
      const stage = engine.stage;
      if (!g || !stage || !hudRef.current) return;
      const canvas = stage.renderer.domElement;
      hudRef.current.style.width = canvas.style.width;
      hudRef.current.style.height = canvas.style.height;
      const t = engine.audio.audibleTime;
      const b = g.beatAt(t);
      const inBar = g.beatInBar(b);
      const u = b - Math.floor(b);
      dotRefs.current.forEach((el, i) => {
        if (!el) return;
        el.classList.toggle('on', i === inBar && b >= 0);
        el.style.transform = i === inBar && b >= 0 ? `scale(${1 + 0.6 * Math.exp(-6 * u)})` : '';
      });
      const seg = stage.currentSegment;
      const label = seg ? (seg.intro ? 'Intro · waiting for the beat' : seg.outro ? 'Outro' : seg.move.name) : '';
      if (moveRef.current.textContent !== label) moveRef.current.textContent = label;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="viewport">
      <div className="stage-mount" ref={mountRef}>
        <div className="hud" ref={hudRef} data-aspect={aspect}>
          <div className="hud-move">
            <span className="beat-dots">
              {[0, 1, 2, 3].map((i) => (
                <i key={i} ref={(el) => (dotRefs.current[i] = el)} />
              ))}
            </span>
            <span ref={moveRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
