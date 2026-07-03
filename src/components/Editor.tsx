import { useCallback, useEffect, useRef, useState } from "react";
import { store, useStore } from "../state/store";
import CanvasStage from "./CanvasStage";
import TransformPanel from "./TransformPanel";
import AdjustPanel from "./AdjustPanel";
import TextPanel from "./TextPanel";
import { exportImage } from "../export";
import { assetsReady } from "../useTemplateCompositor";
import type { Compositor } from "../gl/compositor";

export default function Editor() {
  const snap = useStore();
  const compRef = useRef<Compositor | null>(null);
  const [assetsOk, setAssetsOk] = useState(false);
  const [exporting, setExporting] = useState<"png" | "jpeg" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void assetsReady().then(() => alive && setAssetsOk(true));
    return () => {
      alive = false;
    };
  }, []);

  const onCompositor = useCallback((c: Compositor | null) => {
    compRef.current = c;
  }, []);

  const doExport = async (format: "png" | "jpeg") => {
    const comp = compRef.current;
    if (!comp) return;
    setExporting(format);
    setExportError(null);
    try {
      await exportImage(comp, store.getSnapshot().doc, format);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  };

  if (!snap.hasImage) {
    return (
      <div className="centered-note">
        <div style={{ textAlign: "center" }}>
          <p>No image loaded.</p>
          <button className="btn primary" onClick={() => store.setStep("source")}>
            Choose a source
          </button>
        </div>
      </div>
    );
  }

  const canExport = assetsOk && !exporting;

  return (
    <div className="editor">
      <CanvasStage onCompositor={onCompositor} />
      <aside className="panel">
        <section className="panel-section">
          <h3>Export — 1015 × 1920</h3>
          <div className="export-row">
            <button className="btn primary" disabled={!canExport} onClick={() => void doExport("png")}>
              {exporting === "png" ? "Exporting…" : "Download PNG"}
            </button>
            <button className="btn" disabled={!canExport} onClick={() => void doExport("jpeg")}>
              {exporting === "jpeg" ? "Exporting…" : "Download JPEG"}
            </button>
          </div>
          {!assetsOk && <p className="dim" style={{ fontSize: 11.5 }}>Waiting for fonts &amp; logo…</p>}
          {exportError && <div className="error-text">{exportError}</div>}
        </section>

        <TransformPanel />
        <AdjustPanel />
        <TextPanel />

        <section className="panel-section">
          <h3>
            History
            <span>
              <button className="btn small ghost" disabled={!snap.canUndo} onClick={() => store.undo()}>
                Undo
              </button>{" "}
              <button className="btn small ghost" disabled={!snap.canRedo} onClick={() => store.redo()}>
                Redo
              </button>
            </span>
          </h3>
          <p className="kbd-hints">
            <kbd>←→↑↓</kbd> nudge 1px (<kbd>Shift</kbd> = 10px) · <kbd>+</kbd>/<kbd>−</kbd> zoom ·{" "}
            <kbd>Ctrl/⌘ Z</kbd> undo · <kbd>Ctrl/⌘ ⇧ Z</kbd> redo · double-click image resets
          </p>
        </section>
      </aside>
    </div>
  );
}
