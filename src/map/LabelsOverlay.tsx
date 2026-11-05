import { formatDistance, type Body } from '../core/index.ts';
import { useMapStore } from '../state/store.ts';
import { labelElements, markerElements } from './overlay.ts';
import { focusMarkers } from './markers.ts';

/** Body labels (click to focus), Ap/Pe/AN/DN on the focused body's orbit and Ap/Pe on its children's. */
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
      {focusMarkers(focus).map((m) => (
        <div
          key={`${focusId}-${m.key}`}
          ref={(el) => void (el ? markerElements.set(m.key, el) : markerElements.delete(m.key))}
          className={`orbit-marker marker-${m.kind}${m.body.id === focusId ? '' : ' is-child'}`}
          title={`${m.body.name} ${m.label}`}
          style={{ display: 'none' }}
        >
          <span className="tick" />
          <span className="text">
            {m.body.id === focusId ? m.label : `${m.body.name} ${m.label}`}
            {m.altitude !== undefined && <small>{formatDistance(m.altitude)}</small>}
          </span>
        </div>
      ))}
    </div>
  );
}
