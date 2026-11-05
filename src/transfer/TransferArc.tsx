import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { add, sub, type Vec3 } from '../core/index.ts';
import { writeThree } from '../map/scale.ts';
import { useMapStore } from '../state/store.ts';
import { propagate } from './conics.ts';
import { useTransferStore } from './store.ts';

const SEGMENTS = 256;
const ARC_COLOR = new THREE.Color('#6fd36f');

/**
 * The selected transfer on the map: the arc from departure to arrival (in the common parent's
 * frame, like orbit lines), the ship's position on it at the current time, and where the origin
 * and target are at departure and arrival.
 */
export function TransferArc() {
  const selected = useTransferStore((s) => s.selected);
  const system = useMapStore((s) => s.system);

  // Path relative to the common parent, sampled once per selection (float64).
  const path = useMemo(() => {
    if (!selected) return null;
    const tr = selected.transfer;
    const mu = system.get(selected.targetId).parent!.mu;
    const pc = tr.planeChange && tr.afterPlaneChange ? tr.planeChange.time - tr.departure : Infinity;
    const at = (dt: number): Vec3 =>
      dt < pc
        ? propagate(mu, tr.start.position, tr.start.velocity, dt).position
        : propagate(mu, tr.afterPlaneChange!.position, tr.afterPlaneChange!.velocity, dt - pc).position;
    const points: Vec3[] = [];
    for (let k = 0; k <= SEGMENTS; k++) points.push(at((tr.timeOfFlight * k) / SEGMENTS));
    return { points, at, tr, parentId: system.get(selected.targetId).parent!.id };
  }, [selected, system]);

  const objects = useMemo(() => {
    const positions = new Float32Array((SEGMENTS + 1) * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: ARC_COLOR, depthWrite: false }));
    line.frustumCulled = false;
    line.raycast = () => null;

    // Ship, origin at departure, target at arrival.
    const dots = new Float32Array(3 * 3);
    const dotColors = new Float32Array([0.44, 0.83, 0.44, 0.75, 0.75, 0.75, 1, 1, 1]);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dots, 3).setUsage(THREE.DynamicDrawUsage));
    dg.setAttribute('color', new THREE.BufferAttribute(dotColors, 3));
    const points = new THREE.Points(
      dg,
      new THREE.PointsMaterial({ size: 8, sizeAttenuation: false, vertexColors: true, depthWrite: false, depthTest: false }),
    );
    points.frustumCulled = false;
    points.raycast = () => null;
    return { line, positions, points, dots };
  }, []);

  useFrame(() => {
    const { line, positions, points, dots } = objects;
    line.visible = points.visible = !!path;
    if (!path) return;
    const s = useMapStore.getState();
    const t = s.ut;
    const focus = system.get(s.focusId);
    // Floating origin: everything relative to the focused body, like the rest of the scene.
    const parentRel = sub(system.absolutePosition(system.get(path.parentId), t), system.absolutePosition(focus, t));
    for (let k = 0; k <= SEGMENTS; k++) writeThree(add(parentRel, path.points[k]!), positions, k * 3);
    line.geometry.attributes.position!.needsUpdate = true;

    const tr = path.tr;
    const origin = tr.start.position;
    const target = system.get(useTransferStore.getState().selected?.targetId ?? path.parentId).orbit?.positionAt(tr.arrival) ?? origin;
    const inFlight = t >= tr.departure && t <= tr.arrival;
    const ship = inFlight ? path.at(t - tr.departure) : origin;
    writeThree(add(parentRel, ship), dots, 0);
    writeThree(add(parentRel, origin), dots, 3);
    writeThree(add(parentRel, target), dots, 6);
    points.geometry.attributes.position!.needsUpdate = true;
  });

  return (
    <>
      <primitive object={objects.line} />
      <primitive object={objects.points} />
    </>
  );
}
