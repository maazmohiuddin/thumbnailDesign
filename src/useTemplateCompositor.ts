import { useEffect, useRef, useState, type RefObject } from "react";
import { Compositor } from "./gl/compositor";
import { createOverlayCanvas, renderOverlay } from "./overlay";
import { calibrateBaselines } from "./fonts";
import { LOGO_URL } from "./template";
import type { TextState } from "./state/types";

let logoPromise: Promise<HTMLImageElement> | null = null;

export function getLogo(): Promise<HTMLImageElement> {
  if (!logoPromise) {
    logoPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load logo asset."));
      img.src = LOGO_URL;
    });
  }
  return logoPromise;
}

/** Everything the export guard needs: fonts rasterizable (+ baselines measured) + logo decoded. */
export function assetsReady(): Promise<void> {
  return Promise.all([calibrateBaselines(), getLogo()]).then(() => undefined);
}

/**
 * Binds a Compositor to a canvas and keeps the locked-layers overlay in sync
 * with the text state, fonts, and logo. Returns the compositor once live.
 * The caller is responsible for setting the base image and calling render().
 */
export function useTemplateCompositor(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  text: TextState,
  onRedrawNeeded?: (comp: Compositor) => void
): Compositor | null {
  const [comp, setComp] = useState<Compositor | null>(null);
  const [ready, setReady] = useState(false);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const redrawRef = useRef(onRedrawNeeded);
  redrawRef.current = onRedrawNeeded;

  useEffect(() => {
    if (!canvasRef.current) return;
    const c = new Compositor(canvasRef.current);
    overlayRef.current = createOverlayCanvas();
    setComp(c);
    let alive = true;
    void assetsReady().then(() => alive && setReady(true));
    return () => {
      alive = false;
      c.dispose();
      setComp(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!comp || !ready || !overlayRef.current) return;
    let cancelled = false;
    void getLogo().then((logo) => {
      if (cancelled || !overlayRef.current) return;
      renderOverlay(overlayRef.current, text, logo);
      comp.setOverlay(overlayRef.current);
      redrawRef.current?.(comp);
    });
    return () => {
      cancelled = true;
    };
  }, [comp, ready, text]);

  return ready ? comp : null;
}
