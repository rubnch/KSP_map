import { useEffect } from 'react';
import { useMapStore } from '../state/store.ts';

/** Game-like keys: Tab cycles focus, Backspace returns home, , and . change warp, / resets it. */
export function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.isContentEditable)) return;
      const s = useMapStore.getState();
      switch (e.key) {
        case 'Tab':
          e.preventDefault();
          s.cycleFocus(e.shiftKey ? -1 : 1);
          break;
        case 'Backspace':
          e.preventDefault();
          s.setFocus(s.system.home.id);
          break;
        case '.':
          s.setWarpIndex(s.warpIndex + 1);
          break;
        case ',':
          s.setWarpIndex(s.warpIndex - 1);
          break;
        case '/':
          s.setWarpIndex(0);
          break;
        case 'p':
        case 'P':
          s.togglePause();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
