import { useCallback, useEffect, useRef, useState } from "react";
import { useStore, store } from "../state/store";
import { useTemplateCompositor } from "../useTemplateCompositor";
import { defaultTransform } from "../transform";
import { DEFAULT_ADJUST } from "../state/types";
import type { Compositor } from "../gl/compositor";

const FILMSTRIP_COUNT = 20;
const FRAME_STEP = 1 / 30;

interface Thumb {
  t: number;
  src: string;
}

function seekTo(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      v.removeEventListener("seeked", done);
      resolve();
    };
    v.addEventListener("seeked", done);
    v.currentTime = t;
  });
}

export default function FramePicker({ videoUrl, onBack }: { videoUrl: string; onBack: () => void }) {
  const snap = useStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const compRef = useRef<Compositor | null>(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [thumbs, setThumbs] = useState<Thumb[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  /** Draw the video's current frame through the real template pipeline. */
  const renderNow = useCallback((comp?: Compositor | null) => {
    const c = comp ?? compRef.current;
    const v = videoRef.current;
    if (!c || !v || v.readyState < 2 || v.videoWidth === 0) return;
    c.setImage(v, v.videoWidth, v.videoHeight);
    c.render(defaultTransform(), { ...DEFAULT_ADJUST });
  }, []);

  const comp = useTemplateCompositor(canvasRef, snap.doc.text, renderNow);
  compRef.current = comp;

  useEffect(() => {
    if (comp) renderNow(comp);
  }, [comp, renderNow]);

  // Main scrub video (kept off-DOM; frames are drawn via the compositor).
  useEffect(() => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.src = videoUrl;
    videoRef.current = v;

    const onMeta = () => setDuration(v.duration || 0);
    const onLoaded = () => renderNow();
    const onSeeked = () => {
      setTime(v.currentTime);
      renderNow();
    };
    const onError = () =>
      setError("The reel video failed to load. It may have expired from the cache — go back and fetch it again.");
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("loadeddata", onLoaded);
    v.addEventListener("seeked", onSeeked);
    v.addEventListener("error", onError);

    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("loadeddata", onLoaded);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("error", onError);
      v.removeAttribute("src");
      v.load();
      videoRef.current = null;
    };
  }, [videoUrl, renderNow]);

  // Filmstrip: ~20 evenly sampled frames from a second, independent video element.
  useEffect(() => {
    if (!duration) return;
    let cancelled = false;
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.preload = "auto";
    v.muted = true;
    v.src = videoUrl;
    const canvas = document.createElement("canvas");

    (async () => {
      await new Promise<void>((resolve, reject) => {
        v.addEventListener("loadeddata", () => resolve(), { once: true });
        v.addEventListener("error", () => reject(new Error("thumb video failed")), { once: true });
      });
      const h = 128;
      canvas.height = h;
      canvas.width = Math.max(1, Math.round((v.videoWidth / v.videoHeight) * h));
      const ctx = canvas.getContext("2d")!;
      for (let i = 0; i < FILMSTRIP_COUNT; i++) {
        if (cancelled) return;
        const t = (duration * (i + 0.5)) / FILMSTRIP_COUNT;
        await seekTo(v, t);
        if (cancelled) return;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const src = canvas.toDataURL("image/jpeg", 0.7);
        setThumbs((prev) => [...prev, { t, src }]);
      }
    })().catch(() => {
      /* filmstrip is best-effort; the scrubber still works */
    });

    return () => {
      cancelled = true;
      v.removeAttribute("src");
      v.load();
    };
  }, [videoUrl, duration]);

  const scrub = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    setTime(t);
    v.currentTime = t;
  };

  const useFrame = async () => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return;
    setCapturing(true);
    try {
      // Capture at the video's NATIVE resolution — never at preview size.
      const c = document.createElement("canvas");
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("capture failed"))), "image/png")
      );
      await store.setBaseImage(blob);
    } catch {
      setError("Couldn't capture that frame. Try a different frame or a custom image.");
      setCapturing(false);
    }
  };

  const frameNo = Math.round(time / FRAME_STEP);

  return (
    <div className="frame-step">
      <div>
        <button className="btn small ghost" onClick={onBack}>
          ← Back to source
        </button>
      </div>
      <h2 style={{ margin: 0, fontSize: 18 }}>Pick a frame</h2>
      <p className="dim" style={{ margin: 0 }}>
        The preview shows the frame inside the real template — vignette, bars, and text included — so judge it in
        context.
      </p>

      {error && <div className="error-text">{error}</div>}

      <div className="frame-layout">
        <div className="frame-preview">
          <canvas ref={canvasRef} />
        </div>

        <div className="frame-controls">
          <div>
            <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-dim)" }}>
              Filmstrip
            </h3>
            <div className="filmstrip">
              {thumbs.length === 0 && <span className="dim">Sampling frames…</span>}
              {thumbs.map((th, i) => (
                <button
                  key={i}
                  className={Math.abs(th.t - time) < duration / FILMSTRIP_COUNT / 2 ? "active" : ""}
                  onClick={() => scrub(th.t)}
                  title={`${th.t.toFixed(2)}s`}
                >
                  <img src={th.src} alt={`Frame at ${th.t.toFixed(1)}s`} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-dim)" }}>
              Fine scrub
            </h3>
            <div className="scrub-row">
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={FRAME_STEP}
                value={time}
                disabled={!duration}
                onChange={(e) => scrub(parseFloat(e.target.value))}
              />
              <span className="time">
                {time.toFixed(2)}s · f{frameNo}
              </span>
            </div>
          </div>

          <div>
            <button className="btn primary" disabled={!duration || capturing} onClick={() => void useFrame()}>
              {capturing ? "Capturing…" : "Use this frame →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
