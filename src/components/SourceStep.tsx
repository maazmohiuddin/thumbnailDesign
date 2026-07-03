import { useRef, useState } from "react";
import { isValidReelUrl, resolveReel } from "../api";
import { store } from "../state/store";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 20 * 1024 * 1024;

export default function SourceStep({ onVideoReady }: { onVideoReady: (url: string) => void }) {
  const [reelUrl, setReelUrl] = useState("");
  const [reelError, setReelError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const submitReel = async () => {
    const url = reelUrl.trim();
    if (!isValidReelUrl(url)) {
      setReelError("That doesn't look like an Instagram reel URL (expected instagram.com/reel/…).");
      return;
    }
    setReelError(null);
    setFetching(true);
    setProgress(0);
    try {
      const videoUrl = await resolveReel(url, setProgress);
      onVideoReady(videoUrl);
    } catch (e) {
      setReelError(e instanceof Error ? e.message : "Could not fetch this reel.");
    } finally {
      setFetching(false);
    }
  };

  const acceptFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setFileError("Unsupported format — use JPG, PNG, or WebP.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setFileError("File is too large (max 20 MB).");
      return;
    }
    setFileError(null);
    try {
      await store.setBaseImage(file);
    } catch {
      setFileError("Couldn't decode that image file.");
    }
  };

  return (
    <div className="source-step">
      <h2>Create a thumbnail</h2>
      <p className="sub">Pick a source for the background image. Everything else in the template is locked to brand.</p>

      <div className="source-cards">
        <section className="source-card">
          <div className="icon">▶</div>
          <h3>Instagram Reel</h3>
          <p>Paste a reel URL — we'll fetch the video so you can pick the exact frame.</p>
          <input
            type="url"
            placeholder="https://www.instagram.com/reel/…"
            value={reelUrl}
            disabled={fetching}
            onChange={(e) => {
              setReelUrl(e.target.value);
              if (reelError) setReelError(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && !fetching && void submitReel()}
          />
          {reelError && <div className="error-text">{reelError}</div>}
          {fetching ? (
            <>
              <div className="progress-track">
                <div
                  className={`progress-fill${progress <= 0 ? " indeterminate" : ""}`}
                  style={{ width: `${Math.max(progress, 4)}%` }}
                />
              </div>
              <p className="dim">
                {progress > 0 ? `Downloading… ${Math.round(progress)}%` : "Contacting Instagram…"}
              </p>
            </>
          ) : (
            <button
              className="btn primary"
              disabled={reelUrl.trim().length === 0}
              onClick={() => void submitReel()}
            >
              Fetch reel
            </button>
          )}
        </section>

        <section className="source-card">
          <div className="icon">🖼</div>
          <h3>Custom Image</h3>
          <p>Use your own still — JPG, PNG, or WebP up to 20 MB. Goes straight to the editor.</p>
          <div
            className={`dropzone${dragging ? " drag" : ""}`}
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void acceptFile(e.dataTransfer.files?.[0]);
            }}
          >
            <span style={{ fontSize: 22 }}>⬆</span>
            <span>
              Drag &amp; drop an image here
              <br />
              or click to browse
            </span>
          </div>
          {fileError && <div className="error-text">{fileError}</div>}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            style={{ display: "none" }}
            onChange={(e) => {
              void acceptFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </section>
      </div>
    </div>
  );
}
