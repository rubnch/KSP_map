import type React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface View {
  x: number;
  y: number;
  k: number;
}

/** Room the floating panels take, so the first view fits the map beside them, not under them. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const MIN_K = 0.25;
const MAX_K = 4;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

/**
 * Drag to pan, wheel or pinch to zoom around the pointer. A press that moves more than a few
 * pixels is a drag, and the click it would end with is swallowed.
 */
export function usePanZoom(
  ref: RefObject<HTMLElement | null>,
  size: { width: number; height: number },
  insets: () => Insets,
) {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: View; dist: number; mid: { x: number; y: number }; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const current = useRef(view);
  current.current = view;

  /** The whole map beside the panels; with `widthOnly`, as wide as there is room for, from the top. */
  const fitTo = useCallback(
    (widthOnly: boolean) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const i = insets();
      const w = Math.max(100, r.width - i.left - i.right);
      const h = Math.max(100, r.height - i.top - i.bottom);
      const k = clampK(Math.min(1, w / size.width, widthOnly ? Infinity : h / size.height));
      setView({ k, x: i.left + (w - size.width * k) / 2, y: i.top + Math.max(0, (h - size.height * k) / 2) });
    },
    [ref, size.width, size.height, insets],
  );
  const fit = useCallback(() => fitTo(false), [fitTo]);

  useLayoutEffect(() => fitTo(true), [fitTo]);

  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    setView((v) => {
      const k = clampK(v.k * factor);
      const f = k / v.k;
      return { k, x: px - (px - v.x) * f, y: py - (py - v.y) * f };
    });
  }, []);

  // Wheel needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // The wheel always zooms (dragging pans). Lines and pages are turned into pixels first;
      // a trackpad pinch arrives as a ctrl-wheel with small steps, so it gets a stronger factor.
      const px = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-px * (e.ctrlKey ? 0.015 : 0.005)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref, zoomAt]);

  const local = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const snapshot = (start: View) => {
    const ps = [...pointers.current.values()];
    const mid = { x: ps.reduce((t, p) => t + p.x, 0) / ps.length, y: ps.reduce((t, p) => t + p.y, 0) / ps.length };
    const dist = ps.length > 1 ? Math.hypot(ps[0]!.x - ps[1]!.x, ps[0]!.y - ps[1]!.y) : 0;
    return { start, dist, mid };
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      pointers.current.set(e.pointerId, local(e));
      dragged.current = false;
      gesture.current = { ...snapshot(current.current), moved: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!pointers.current.has(e.pointerId) || !gesture.current) return;
      pointers.current.set(e.pointerId, local(e));
      const g = gesture.current;
      const now = snapshot(g.start);
      if (!g.moved && Math.hypot(now.mid.x - g.mid.x, now.mid.y - g.mid.y) < 4 && pointers.current.size < 2) return;
      if (!g.moved) {
        g.moved = true;
        dragged.current = true;
        ref.current?.setPointerCapture(e.pointerId);
      }
      const k = g.dist && now.dist ? clampK(g.start.k * (now.dist / g.dist)) : g.start.k;
      const f = k / g.start.k;
      setView({ k, x: now.mid.x - (g.mid.x - g.start.x) * f, y: now.mid.y - (g.mid.y - g.start.y) * f });
    },
    onPointerUp: (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      // A finger lifted from a pinch: carry on panning with the one left, from here.
      gesture.current = pointers.current.size ? { ...snapshot(current.current), moved: true } : null;
    },
    // The click that ends a drag is not a pick.
    onClickCapture: (e: React.MouseEvent) => {
      if (dragged.current) {
        e.stopPropagation();
        dragged.current = false;
      }
    },
  };

  const zoomBy = (factor: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r) zoomAt(r.width / 2, r.height / 2, factor);
  };

  return { view, handlers: { ...handlers, onPointerCancel: handlers.onPointerUp }, fit, zoomBy };
}
