import { useState } from 'react';
import type { Body } from '../core/index.ts';
import { useMapStore } from '../state/store.ts';

/** Body tree grouped by parent, like the in-game list. Click to focus. */
export function BodyList() {
  const system = useMapStore((s) => s.system);
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 720);

  return (
    <nav className={`panel body-list${open ? '' : ' collapsed'}`} aria-label="Bodies">
      <button className="panel-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Bodies ▾' : 'Bodies ▸'}
      </button>
      {open && (
        <ul>
          <BodyItem body={system.root} />
        </ul>
      )}
    </nav>
  );
}

function BodyItem({ body }: { body: Body }) {
  const focusId = useMapStore((s) => s.focusId);
  const setFocus = useMapStore((s) => s.setFocus);
  const setHover = useMapStore((s) => s.setHover);
  return (
    <li>
      <button
        className={`body-item${body.id === focusId ? ' active' : ''}`}
        onClick={() => setFocus(body.id)}
        onMouseEnter={() => setHover(body.id)}
        onMouseLeave={() => setHover(null)}
      >
        <span className="dot" style={{ background: body.data.style.color }} />
        {body.name}
      </button>
      {body.children.length > 0 && (
        <ul>
          {body.children.map((c) => (
            <BodyItem key={c.id} body={c} />
          ))}
        </ul>
      )}
    </li>
  );
}
