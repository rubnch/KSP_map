import { DeltaVView, DvPanel, DvSettingsPanel } from './dv/DeltaVView.tsx';
import { MapView } from './map/MapView.tsx';
import { useMapStore } from './state/store.ts';
import { BodyList } from './ui/BodyList.tsx';
import { InfoPanel } from './ui/InfoPanel.tsx';
import { TimeControls } from './ui/TimeControls.tsx';
import { KeyHints, Toolbar } from './ui/Toolbar.tsx';
import { useKeyboard } from './ui/useKeyboard.ts';
import { TransferLauncher } from './transfer/TransferPage.tsx';

export default function App() {
  useKeyboard();
  const page = useMapStore((s) => s.page);
  if (page === 'dv') {
    return (
      <div className="app">
        <DeltaVView />
        <div className="hud dv-hud">
          <Toolbar />
          <DvSettingsPanel />
          <DvPanel />
        </div>
      </div>
    );
  }
  return (
    <div className="app">
      <MapView />
      <div className="hud">
        <Toolbar />
        <BodyList />
        <InfoPanel />
        <div className="time-stack">
          <TransferLauncher />
          <TimeControls />
        </div>
        <KeyHints />
      </div>
    </div>
  );
}
