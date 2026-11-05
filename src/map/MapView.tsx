import { useEffect, useRef, type ComponentRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useMapStore } from '../state/store.ts';
import { SCALE } from './scale.ts';
import { SystemScene } from './SystemScene.tsx';
import { LabelsOverlay } from './LabelsOverlay.tsx';
import { TransferArc } from '../transfer/TransferArc.tsx';

export function MapView() {
  return (
    <div className="map-view">
      <Canvas
        className="map-canvas"
        gl={{ logarithmicDepthBuffer: true, antialias: true }}
        camera={{ fov: 50, near: 1e-4, far: 1e10, position: [0, 4e4, 1.2e5] }}
        dpr={[1, 2]}
      >
        <color attach="background" args={['#05070d']} />
        <SystemScene />
        <TransferArc />
        <CameraRig />
      </Canvas>
      <LabelsOverlay />
    </div>
  );
}

/**
 * Orbit controls around the focused body (always at the origin), log-feel zoom from low orbit
 * to the whole system, zoom kept across focus changes, and the top-down 2D lock.
 */
function CameraRig() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const system = useMapStore((s) => s.system);
  const focusId = useMapStore((s) => s.focusId);
  const focusSerial = useMapStore((s) => s.focusSerial);
  const viewMode = useMapStore((s) => s.viewMode);
  const focus = system.get(focusId);
  const targetDistance = useRef<number | null>(null);
  const saved3d = useRef<THREE.Vector3 | null>(null);

  const minDistance = focus.radius * SCALE * 1.15;
  const maxDistance = system.extent(system.root) * SCALE * 4;

  // Initial framing: the focused body's moons, or a few radii if it has none.
  useEffect(() => {
    const d = focus.children.length ? system.extent(focus) * 1.6 : focus.radius * 8;
    camera.position.setLength(d * SCALE);
    // Only on mount: later focus changes keep the current distance.
  }, []);

  // Keep the zoom distance when the focus changes; only back off if the camera would end up
  // inside (or right on top of) the newly focused body.
  useEffect(() => {
    if (focusSerial === 0) return;
    const safe = focus.radius * SCALE * 3;
    targetDistance.current = camera.position.length() < safe ? safe : null;
  }, [focusSerial, focus, camera]);

  // 2D: look straight down on the reference plane. 3D: restore the previous angle.
  useEffect(() => {
    const len = camera.position.length();
    if (viewMode === '2d') {
      saved3d.current = camera.position.clone();
      camera.position.set(0, len, len * 1e-6);
    } else if (saved3d.current) {
      camera.position.copy(saved3d.current).setLength(len);
    }
    camera.lookAt(0, 0, 0);
    controls.current?.update();
  }, [viewMode, camera]);

  // Any manual zoom or drag cancels an eased back-off.
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    const cancel = () => (targetDistance.current = null);
    const el = gl.domElement;
    el.addEventListener('wheel', cancel, { passive: true });
    el.addEventListener('pointerdown', cancel);
    return () => {
      el.removeEventListener('wheel', cancel);
      el.removeEventListener('pointerdown', cancel);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const target = targetDistance.current;
    if (target === null) return;
    const current = camera.position.length();
    const k = 1 - Math.exp(-delta * 6);
    const next = Math.exp(Math.log(current) + (Math.log(target) - Math.log(current)) * k);
    camera.position.setLength(next);
    if (Math.abs(Math.log(next / target)) < 1e-3) targetDistance.current = null;
  }, -2); // before OrbitControls (-1) and the scene loop (0), so everything sees the final camera

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0, 0]}
      enablePan={false}
      enableRotate={viewMode === '3d'}
      enableDamping
      dampingFactor={0.12}
      rotateSpeed={0.6}
      zoomSpeed={3}
      minDistance={minDistance}
      maxDistance={maxDistance}
    />
  );
}
