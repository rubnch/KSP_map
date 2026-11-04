import { useState } from 'react';
import { dateToUt, formatUt, utToDate } from '../core/index.ts';
import { useMapStore, WARP_STEPS } from '../state/store.ts';

/** UT clock in the pack's calendar, play/pause, warp steps and a date picker. */
export function TimeControls() {
  const ut = useMapStore((s) => s.ut);
  const cal = useMapStore((s) => s.system.pack.calendar);
  const warpIndex = useMapStore((s) => s.warpIndex);
  const paused = useMapStore((s) => s.paused);
  const { setWarpIndex, togglePause, setUt } = useMapStore.getState();
  const [editing, setEditing] = useState(false);

  return (
    <div className="panel time-controls">
      {editing ? (
        <DatePicker
          initial={utToDate(ut, cal)}
          onCancel={() => setEditing(false)}
          onSet={(year, day) => {
            setUt(dateToUt({ year, day }, cal));
            setEditing(false);
          }}
        />
      ) : (
        <button className="clock" onClick={() => setEditing(true)} title="Set date">
          {formatUt(ut, cal)}
        </button>
      )}
      <div className="warp">
        <button onClick={togglePause} title="Pause / play" aria-label={paused ? 'Play' : 'Pause'}>
          {paused ? '▶' : '❚❚'}
        </button>
        <div className="warp-steps" role="group" aria-label="Time warp">
          {WARP_STEPS.map((w, i) => (
            <button
              key={w}
              className={`warp-step${i <= warpIndex ? ' on' : ''}`}
              onClick={() => setWarpIndex(i)}
              title={`${w.toLocaleString('en-US')}×`}
              aria-label={`Warp ${w}×`}
            />
          ))}
        </div>
        <span className="warp-label">{WARP_STEPS[warpIndex]!.toLocaleString('en-US')}×</span>
      </div>
    </div>
  );
}

function DatePicker(props: {
  initial: { year: number; day: number };
  onSet: (year: number, day: number) => void;
  onCancel: () => void;
}) {
  const [year, setYear] = useState(props.initial.year);
  const [day, setDay] = useState(props.initial.day);
  return (
    <form
      className="date-picker"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSet(Math.max(1, year), Math.max(1, day));
      }}
    >
      <label>
        Year <input type="number" min={1} value={year} onChange={(e) => setYear(Number(e.target.value))} />
      </label>
      <label>
        Day <input type="number" min={1} value={day} onChange={(e) => setDay(Number(e.target.value))} />
      </label>
      <button type="submit">Go</button>
      <button type="button" onClick={props.onCancel}>
        ✕
      </button>
    </form>
  );
}
