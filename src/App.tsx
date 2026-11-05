import { MapView } from './map/MapView.tsx';
import { BodyList } from './ui/BodyList.tsx';
import { InfoPanel } from './ui/InfoPanel.tsx';
import { TimeControls } from './ui/TimeControls.tsx';
import { KeyHints, Toolbar } from './ui/Toolbar.tsx';
import { useKeyboard } from './ui/useKeyboard.ts';
import { TransferTimeline } from './transfer/TransferTimeline.tsx';

export default function App() {
  useKeyboard();
  return (
    <div className="app">
      <MapView />
      <div className="hud">
        <Toolbar />
        <BodyList />
        <InfoPanel />
        <div className="time-stack">
          <TransferTimeline />
          <TimeControls />
        </div>
        <KeyHints />
      </div>
    </div>
  );
}
