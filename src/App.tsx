import { useState } from "react";
import { store, useStore } from "./state/store";
import SourceStep from "./components/SourceStep";
import FramePicker from "./components/FramePicker";
import Editor from "./components/Editor";

const STEP_LABELS = { source: 1, frames: 2, editor: 3 } as const;

export default function App() {
  const snap = useStore();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const active = STEP_LABELS[snap.step];

  return (
    <div className="app">
      <header className="topbar">
        <img src="/assets/logo.png" alt="ARY+" />
        <h1>
          Thumbnail <span>Studio</span>
        </h1>
        <div className="spacer" />
        <nav className="steps" aria-label="Progress">
          {(["Source", "Frame", "Edit & Export"] as const).map((label, i) => (
            <span key={label}>
              {i > 0 && "  ·  "}
              {i + 1 === active ? <b>{`${i + 1} ${label}`}</b> : `${i + 1} ${label}`}
            </span>
          ))}
        </nav>
        {snap.hasImage && (
          <button
            className="btn small ghost"
            onClick={() => {
              if (window.confirm("Start over? This discards the current image and edits.")) {
                setVideoUrl(null);
                store.reset();
              }
            }}
          >
            Start over
          </button>
        )}
      </header>

      <main className="main">
        {snap.restoring ? (
          <div className="centered-note">Restoring session…</div>
        ) : snap.step === "source" ? (
          <SourceStep
            onVideoReady={(url) => {
              setVideoUrl(url);
              store.setStep("frames");
            }}
          />
        ) : snap.step === "frames" && videoUrl ? (
          <FramePicker videoUrl={videoUrl} onBack={() => store.setStep("source")} />
        ) : (
          <Editor />
        )}
      </main>
    </div>
  );
}
