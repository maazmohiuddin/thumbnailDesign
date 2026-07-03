/** Client for the reel-resolver backend (see server/index.js). */

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
  const res = await fetch("/api/reel", {
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
  const res = await fetch(`/api/reel/${encodeURIComponent(id)}`);
  const body = await readJson(res);
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as unknown as ReelJob;
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
