import { useCallback, useEffect, useRef, useState } from "react";
import { store, useStore } from "../state/store";
import { useTemplateCompositor } from "../useTemplateCompositor";
import { defaultTransform, pan, zoomAbout, clampTransform, INNER_CX, INNER_CY } from "../transform";
import { CANVAS_H, CANVAS_W, INNER_H, INNER_Y } from "../template";
import type { Compositor } from "../gl/compositor";

const OUTLINE_TOP_PCT = (INNER_Y / CANVAS_H) * 100;
const OUTLINE_H_PCT = (INNER_H / CANVAS_H) * 100;

export default function CanvasStage({ onCompositor }: { onCompositor: (c: Compositor | null) => void }) {
  const snap = useStore();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stageSize, setStageSize] = useState({ w: 320, h: 605 });
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastWheelAction = useRef(0);
  const rafId = useRef(0);

  const renderNow = useCallback((comp?: Compositor | null) => {
    const c = comp ?? compRef.current;
    if (!c) return;
    const { doc } = store.getSnapshot();
    c.render(doc.transform, doc.adjust);
  }, []);

  const comp = useTemplateCompositor(canvasRef, snap.doc.text, renderNow);
  const compRef = useRef<Compositor | null>(null);
  compRef.current = comp;

  useEffect(() => {
    onCompositor(comp);
    return () => onCompositor(null);
  }, [comp, onCompositor]);

  // Upload the base image texture whenever it changes.
  useEffect(() => {
    if (!comp || !store.baseImage || !snap.hasImage) return;
    comp.setImage(store.baseImage, snap.imageW, snap.imageH);
    renderNow(comp);
  }, [comp, snap.imageVersion, snap.hasImage, snap.imageW, snap.imageH, renderNow]);

  // Re-render (rAF-coalesced) on any transform/adjust change.
  useEffect(() => {
    if (!comp) return;
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => renderNow(comp));
    return () => cancelAnimationFrame(rafId.current);
  }, [comp, snap.doc.transform, snap.doc.adjust, renderNow]);

  // Fit the native-resolution canvas to the viewport (CSS scaling only).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const availW = el.clientWidth - 40;
      const availH = el.clientHeight - 40;
      const scale = Math.min(availW / CANVAS_W, availH / CANVAS_H);
      setStageSize({ w: Math.max(120, CANVAS_W * scale), h: Math.max(226, CANVAS_H * scale) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Convert a pointer event to Inner-frame coordinates. */
  const toInner = (e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const s = CANVAS_W / rect.width;
    return { x: (e.clientX - rect.left) * s, y: (e.clientY - rect.top) * s - INNER_Y, scale: s };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!snap.hasImage) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      store.beginAction();
      setDragging(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !snap.hasImage) return;
    const { doc, imageW, imageH } = store.getSnapshot();
    const rect = canvasRef.current!.getBoundingClientRect();
    const s = CANVAS_W / rect.width;

    if (pointers.current.size === 1) {
      const dx = (e.clientX - prev.x) * s;
      const dy = (e.clientY - prev.y) * s;
      store.setTransform(pan(doc.transform, dx, dy, imageW, imageH));
    } else if (pointers.current.size === 2) {
      // Pinch: zoom about the midpoint + pan with it.
      const pts = [...pointers.current.entries()];
      const other = pts.find(([id]) => id !== e.pointerId)![1];
      const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
      const curDist = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      const prevMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
      const curMid = { x: (e.clientX + other.x) / 2, y: (e.clientY + other.y) / 2 };
      const mid = toInner({ clientX: curMid.x, clientY: curMid.y });
      let t = pan(doc.transform, (curMid.x - prevMid.x) * s, (curMid.y - prevMid.y) * s, imageW, imageH);
      if (prevDist > 0) t = zoomAbout(t, mid.x, mid.y, curDist / prevDist, imageW, imageH);
      store.setTransform(t);
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  };

  // Wheel zoom needs preventDefault (page scroll), so bind non-passively.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { doc, imageW, imageH, hasImage } = store.getSnapshot();
      if (!hasImage) return;
      const now = Date.now();
      if (now - lastWheelAction.current > 500) store.beginAction();
      lastWheelAction.current = now;
      const p = toInner(e);
      const factor = Math.exp(-e.deltaY * 0.0016);
      store.setTransform(zoomAbout(doc.transform, p.x, p.y, factor, imageW, imageH));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onDoubleClick = () => {
    if (!snap.hasImage) return;
    const { imageW, imageH } = store.getSnapshot();
    store.beginAction();
    store.setTransform(clampTransform(defaultTransform(), imageW, imageH));
  };

  // Keyboard: nudge, zoom, undo/redo. Ignored while typing in a field.
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const lastNudge = { t: 0 };
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const { doc, imageW, imageH, hasImage } = store.getSnapshot();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.shiftKey ? store.redo() : store.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        store.redo();
        return;
      }
      if (!hasImage) return;
      const step = e.shiftKey ? 10 : 1;
      const beginNudge = () => {
        const now = Date.now();
        if (now - lastNudge.t > 500) store.beginAction();
        lastNudge.t = now;
      };
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          beginNudge();
          store.setTransform(pan(doc.transform, -step, 0, imageW, imageH));
          break;
        case "ArrowRight":
          e.preventDefault();
          beginNudge();
          store.setTransform(pan(doc.transform, step, 0, imageW, imageH));
          break;
        case "ArrowUp":
          e.preventDefault();
          beginNudge();
          store.setTransform(pan(doc.transform, 0, -step, imageW, imageH));
          break;
        case "ArrowDown":
          e.preventDefault();
          beginNudge();
          store.setTransform(pan(doc.transform, 0, step, imageW, imageH));
          break;
        case "+":
        case "=":
          beginNudge();
          store.setTransform(zoomAbout(doc.transform, INNER_CX, INNER_CY, 1.04, imageW, imageH));
          break;
        case "-":
        case "_":
          beginNudge();
          store.setTransform(zoomAbout(doc.transform, INNER_CX, INNER_CY, 1 / 1.04, imageW, imageH));
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="stage-wrap" ref={wrapRef}>
      <div className="stage" style={{ width: stageSize.w, height: stageSize.h }}>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        />
        {dragging && (
          <div className="safe-outline" style={{ top: `${OUTLINE_TOP_PCT}%`, height: `${OUTLINE_H_PCT}%` }} />
        )}
      </div>
    </div>
  );
}
