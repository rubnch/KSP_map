import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { add, sub, type Body, type Vec3 } from '../core/index.ts';
import { useMapStore, WARP_STEPS } from '../state/store.ts';
import { orbitMarkers } from './markers.ts';
import { labelElements, markerElements } from './overlay.ts';
import { SCALE, writeThree } from './scale.ts';

const ORBIT_SEGMENTS = 256;
/** A child's label and orbit hide when it is closer than this to its parent on screen. */
const MIN_SCREEN_SEPARATION_PX = 16;
/** Labels hide once the body itself is this big on screen. */
const MAX_LABELLED_RADIUS_PX = 28;

interface OrbitLineHandle {
  line: THREE.Line;
  positions: Float32Array;
  colors: Float32Array;
  baseColor: THREE.Color;
}

interface ScreenPoint {
  x: number;
  y: number;
  onScreen: boolean;
  /** Projected body radius in pixels. */
  radiusPx: number;
}

/**
 * Everything inside the canvas: bodies and orbit lines. One frame loop advances the clock,
 * computes every position in float64 relative to the focused body (a floating origin, so
 * large systems don't jitter), writes them to three.js objects, and places the HTML labels.
 */
export function SystemScene() {
  const system = useMapStore((s) => s.system);
  const focusId = useMapStore((s) => s.focusId);
  const setFocus = useMapStore((s) => s.setFocus);
  const setHover = useMapStore((s) => s.setHover);
  const { camera, size } = useThree();

  const groups = useRef(new Map<string, THREE.Group>());
  const orbitLines = useRef(new Map<string, OrbitLineHandle>());
  const soiMesh = useRef<THREE.Mesh>(null);

  const focus = system.get(focusId);
  const markers = useMemo(() => orbitMarkers(focus), [focus]);

  const tmp = useMemo(() => new THREE.Vector3(), []);
  const scratch = useMemo(() => new Float64Array(3), []);

  useFrame((_, delta) => {
    const state = useMapStore.getState();
    if (!state.paused) state.setUt(state.ut + Math.min(delta, 0.1) * WARP_STEPS[state.warpIndex]!);
    const t = useMapStore.getState().ut;
    const hoverId = state.hoverId;

    // Absolute positions (float64), walking the tree once, then relative to the focus.
    const abs = new Map<string, Vec3>();
    for (const b of system.bodies) {
      abs.set(b.id, b.parent && b.orbit ? add(abs.get(b.parent.id)!, b.orbit.positionAt(t)) : [0, 0, 0]);
    }
    const origin = abs.get(focusId)!;
    const rel = new Map<string, Vec3>();
    for (const b of system.bodies) rel.set(b.id, sub(abs.get(b.id)!, origin));

    const fovScale = camera instanceof THREE.PerspectiveCamera ? Math.tan((camera.fov * Math.PI) / 360) : 1;
    const project = (v: Vec3, radius = 0): ScreenPoint => {
      writeThree(v, scratch);
      tmp.set(scratch[0]!, scratch[1]!, scratch[2]!);
      const dist = tmp.distanceTo(camera.position);
      tmp.project(camera);
      return {
        x: ((tmp.x + 1) / 2) * size.width,
        y: ((1 - tmp.y) / 2) * size.height,
        onScreen: tmp.z < 1 && tmp.z > -1,
        radiusPx: ((radius * SCALE) / dist / fovScale) * (size.height / 2),
      };
    };

    const screen = new Map<string, ScreenPoint>();
    for (const b of system.bodies) screen.set(b.id, project(rel.get(b.id)!, b.radius));

    // Declutter: hide moons that sit on top of their parent, unless they are on the focus chain.
    const focusChain = new Set([focusId, ...system.ancestors(focus).map((b) => b.id)]);
    const shownCache = new Map<string, boolean>();
    const shown = (b: Body): boolean => {
      const cached = shownCache.get(b.id);
      if (cached !== undefined) return cached;
      let result = true;
      if (!focusChain.has(b.id) && b.parent) {
        const s = screen.get(b.id)!;
        const p = screen.get(b.parent.id)!;
        result = shown(b.parent) && Math.hypot(s.x - p.x, s.y - p.y) >= MIN_SCREEN_SEPARATION_PX;
      }
      shownCache.set(b.id, result);
      return result;
    };

    for (const b of system.bodies) {
      const visible = shown(b);
      const s = screen.get(b.id)!;
      const g = groups.current.get(b.id);
      if (g) {
        writeThree(rel.get(b.id)!, scratch);
        g.position.set(scratch[0]!, scratch[1]!, scratch[2]!);
      }
      const label = labelElements.get(b.id);
      if (label) placeElement(label, s, visible && s.radiusPx < MAX_LABELLED_RADIUS_PX);

      const ol = orbitLines.current.get(b.id);
      if (ol && b.orbit && b.parent) {
        ol.line.visible = visible;
        if (visible) updateOrbitLine(ol, b, rel.get(b.parent.id)!, t, b.id === focusId || b.parent.id === focusId);
      }
    }

    // SOI bubble on hover.
    const hovered = hoverId ? system.find(hoverId) : undefined;
    if (soiMesh.current) {
      const show = !!hovered && Number.isFinite(hovered.soi);
      soiMesh.current.visible = show;
      if (show) {
        writeThree(rel.get(hovered.id)!, scratch);
        soiMesh.current.position.set(scratch[0]!, scratch[1]!, scratch[2]!);
        soiMesh.current.scale.setScalar(hovered.soi * SCALE);
      }
    }

    // Ap/Pe/AN/DN markers on the focused body's orbit, which is anchored at its parent.
    if (focus.parent) {
      const parentRel = rel.get(focus.parent.id)!;
      for (const m of markers) {
        const el = markerElements.get(m.key);
        if (el) placeElement(el, project(add(parentRel, m.position)), true);
      }
    }
  });

  return (
    <>
      <ambientLight intensity={0.06} />
      {system.bodies.map((b) => (
        <group key={b.id} ref={(el) => void (el ? groups.current.set(b.id, el) : groups.current.delete(b.id))}>
          <mesh
            onDoubleClick={(e) => {
              e.stopPropagation();
              setFocus(b.id);
            }}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHover(b.id);
            }}
            onPointerOut={() => setHover(null)}
          >
            <sphereGeometry args={[b.radius * SCALE, 64, 32]} />
            {b.parent ? (
              <meshStandardMaterial color={b.data.style.color} roughness={0.9} metalness={0} />
            ) : (
              <meshBasicMaterial color={b.data.style.color} />
            )}
          </mesh>
          {!b.parent && <pointLight intensity={2.2} decay={0} distance={0} color="#fff6e0" />}
        </group>
      ))}

      {system.bodies
        .filter((b) => b.orbit)
        .map((b) => (
          <OrbitLine
            key={`orbit-${b.id}`}
            body={b}
            onReady={(h) => (h ? orbitLines.current.set(b.id, h) : orbitLines.current.delete(b.id))}
          />
        ))}

      <mesh ref={soiMesh} visible={false} raycast={() => null}>
        <sphereGeometry args={[1, 48, 24]} />
        <meshBasicMaterial color="#7fb2ff" transparent opacity={0.07} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

function placeElement(el: HTMLElement, s: ScreenPoint, visible: boolean) {
  const show = visible && s.onScreen;
  el.style.display = show ? '' : 'none';
  if (show) el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
}

function OrbitLine({ body, onReady }: { body: Body; onReady: (h: OrbitLineHandle | null) => void }) {
  const handle = useMemo(() => {
    const n = ORBIT_SEGMENTS + 1;
    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    const material = new THREE.LineBasicMaterial({ vertexColors: true, depthWrite: false });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.raycast = () => null;
    const baseColor = new THREE.Color(body.data.style.orbitColor ?? body.data.style.color);
    return { line, positions, colors, baseColor };
  }, [body]);

  return <primitive object={handle.line} ref={(el: THREE.Line | null) => onReady(el ? handle : null)} />;
}

const BG = new THREE.Color('#05070d');
const tmpColor = new THREE.Color();

/**
 * Rebuilds an orbit line starting exactly at the body, so the line always passes through it
 * whatever the zoom, and fades it behind the body like the in-game map.
 */
function updateOrbitLine(h: OrbitLineHandle, b: Body, parentRel: Vec3, t: number, emphasised: boolean) {
  const orbit = b.orbit!;
  const E0 = orbit.eccentricAnomalyAt(t);
  const n = ORBIT_SEGMENTS;
  const peak = emphasised ? 1 : 0.75;
  for (let k = 0; k <= n; k++) {
    // Walk backwards from the body so the brightest part trails just behind it.
    const p = orbit.positionAtEccentric(E0 - (2 * Math.PI * k) / n);
    writeThree(add(parentRel, p), h.positions, k * 3);
    tmpColor.copy(BG).lerp(h.baseColor, peak * (1 - 0.8 * (k / n)));
    h.colors[k * 3] = tmpColor.r;
    h.colors[k * 3 + 1] = tmpColor.g;
    h.colors[k * 3 + 2] = tmpColor.b;
  }
  const geom = h.line.geometry;
  geom.attributes.position!.needsUpdate = true;
  geom.attributes.color!.needsUpdate = true;
}
