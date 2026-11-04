import { useMapStore } from '../state/store.ts';

/** Pack name and pinned version, the 2D/3D toggle and a hint for keyboard controls. */
export function Toolbar() {
  const pack = useMapStore((s) => s.system.pack);
  const viewMode = useMapStore((s) => s.viewMode);
  const setViewMode = useMapStore((s) => s.setViewMode);
  return (
    <div className="panel toolbar">
      <div className="title">
        <strong>KSP Map</strong>
        <span className="pack" title={pack.source.notes}>
          {pack.name} · {pack.source.mod} {pack.source.version}
        </span>
      </div>
      <div className="view-toggle" role="group" aria-label="View">
        <button className={viewMode === '3d' ? 'on' : ''} onClick={() => setViewMode('3d')}>
          3D
        </button>
        <button className={viewMode === '2d' ? 'on' : ''} onClick={() => setViewMode('2d')}>
          2D
        </button>
      </div>
    </div>
  );
}

export function KeyHints() {
  return (
    <div className="key-hints">
      Drag to orbit · scroll to zoom · double-click a body or click its label to focus · Tab / Shift+Tab cycle ·
      Backspace home · , . warp · / reset warp · P pause
    </div>
  );
}
