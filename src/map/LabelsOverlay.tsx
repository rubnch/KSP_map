import { formatDistance, type Body } from '../core/index.ts';
import { useMapStore } from '../state/store.ts';
import { labelElements, markerElements } from './overlay.ts';
import { orbitMarkers } from './markers.ts';

/** Body labels (click to focus) and Ap/Pe/AN/DN markers for the focused body. */
export function LabelsOverlay() {
  const system = useMapStore((s) => s.system);
  const focusId = useMapStore((s) => s.focusId);
  const setFocus = useMapStore((s) => s.setFocus);
  const setHover = useMapStore((s) => s.setHover);
  const focus = system.get(focusId);

  return (
    <div className="labels-overlay">
      {system.bodies.map((b: Body) => (
        <div
          key={b.id}
          ref={(el) => void (el ? labelElements.set(b.id, el) : labelElements.delete(b.id))}
          className={`body-label${b.id === focusId ? ' is-focus' : ''}`}
          style={{ display: 'none' }}
          onClick={() => setFocus(b.id)}
          onPointerEnter={() => setHover(b.id)}
          onPointerLeave={() => setHover(null)}
        >
          <span className="dot" style={{ background: b.data.style.color }} />
          <span className="name">{b.name}</span>
        </div>
      ))}
      {orbitMarkers(focus).map((m) => (
        <div
          key={`${focusId}-${m.key}`}
          ref={(el) => void (el ? markerElements.set(m.key, el) : markerElements.delete(m.key))}
          className={`orbit-marker marker-${m.kind}${m.node ? ' has-node' : ''}`}
          style={{ display: 'none' }}
        >
          <span className="tick" />
          <span className="text">
            {m.label}
            {m.node && <span className={`marker-${m.node.kind}`}> · {m.node.label}</span>}
            {m.altitude !== undefined && (
              <small>
                {formatDistance(m.altitude)}
                {m.node && <span className={`marker-${m.node.kind}`}> · {m.node.angle}</span>}
              </small>
            )}
            {m.angle && <small>{m.angle}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}
