/**
 * Client for the reel-resolver backend (see server/index.js).
 *
 * The backend is a long-lived Node process (spawns yt-dlp, streams large
 * files) and can't run as a Vercel serverless function. On a static/serverless
 * deployment (Vercel, Netlify, ...) it must be hosted separately (Render,
 * Railway, Fly, a VPS — anything with a persistent process and yt-dlp
 * installed), with its origin passed via VITE_REEL_API_BASE_URL at build
 * time. Left unset, requests fall back to same-origin `/api/...` (the local
 * `npm run dev` setup, which proxies to server/index.js).
 */
const API_BASE = (import.meta.env.VITE_REEL_API_BASE_URL ?? "").replace(/\/+$/, "");

export const REEL_URL_PATTERN =
  /^https?:\/\/(www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reel|reels|p|tv)\/[A-Za-z0-9_-]+/i;

export function isValidReelUrl(url: string): boolean {
  return REEL_URL_PATTERN.test(url.trim());
}

export interface ReelJob {
  id: string;
  status: "downloading" | "ready" | "error";
  /** 0–100 while downloading. */
  progress: number;
  error?: string;
  videoUrl?: string;
}

const NO_BACKEND_MSG =
  "The reel resolver backend isn't available on this deployment. Run the app locally (npm run dev) for the Instagram path, or use a custom image instead.";

async function readJson(res: Response): Promise<Record<string, string>> {
  if (!res.headers.get("content-type")?.includes("application/json")) {
    throw new Error(NO_BACKEND_MSG);
  }
  return res.json().catch(() => ({}));
}

export async function startReelJob(url: string): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/api/reel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  }).catch(() => {
    throw new Error(NO_BACKEND_MSG);
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  if (!body.id) throw new Error(NO_BACKEND_MSG);
  return body as { id: string };
}

export async function getReelJob(id: string): Promise<ReelJob> {
  const res = await fetch(`${API_BASE}/api/reel/${encodeURIComponent(id)}`);
  const body = await readJson(res);
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  const job = body as unknown as ReelJob;
  // videoUrl is server-relative (e.g. "/api/video/<id>"); resolve it against
  // the same base the job status came from.
  if (job.videoUrl && API_BASE) job.videoUrl = `${API_BASE}${job.videoUrl}`;
  return job;
}

/** Poll a job until it's ready or errors. Reports progress along the way. */
export async function resolveReel(
  url: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal
): Promise<string> {
  const { id } = await startReelJob(url);
  for (;;) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const job = await getReelJob(id);
    if (job.status === "ready" && job.videoUrl) return job.videoUrl;
    if (job.status === "error") throw new Error(job.error || "Could not fetch this reel.");
    onProgress(job.progress);
    await new Promise((r) => setTimeout(r, 500));
  }
}
