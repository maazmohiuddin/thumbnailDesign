/**
 * ARY+ Thumbnail Studio — reel resolver.
 *
 * Single job: resolve an Instagram Reel URL to a downloadable MP4 via yt-dlp,
 * cache it in /tmp, and stream it back with CORS + Range support (the client
 * seeks the <video> element, so byte-range responses are required).
 */
import express from "express";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = process.env.PORT || 8787;
const CACHE_DIR = path.join(os.tmpdir(), "aryplus-reels");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const REEL_URL_PATTERN =
  /^https?:\/\/(www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reel|reels|p|tv)\/[A-Za-z0-9_-]+/i;

fs.mkdirSync(CACHE_DIR, { recursive: true });

/** Find a usable yt-dlp invocation once at startup. */
function detectYtdlp() {
  const candidates = [
    ["yt-dlp", []],
    ["python3", ["-m", "yt_dlp"]],
  ];
  for (const [cmd, prefix] of candidates) {
    try {
      const r = spawnSync(cmd, [...prefix, "--version"], { encoding: "utf8", timeout: 10000 });
      if (r.status === 0) return { cmd, prefix, version: r.stdout.trim() };
    } catch {
      /* try next */
    }
  }
  return null;
}
const ytdlp = detectYtdlp();
if (!ytdlp) {
  console.warn(
    "[server] yt-dlp not found. Install it (`pipx install yt-dlp` or `brew install yt-dlp`) " +
      "to enable the Instagram Reel path. The custom-image path works regardless."
  );
} else {
  console.log(`[server] yt-dlp ${ytdlp.version} (${ytdlp.cmd})`);
}

/** jobId → { status, progress, error, file } */
const jobs = new Map();

function friendlyError(stderr) {
  const s = stderr.toLowerCase();
  if (s.includes("login required") || s.includes("rate-limit") || s.includes("rate limit"))
    return "Instagram is rate-limiting or requires login for this reel. Try again in a few minutes, or use a custom image instead.";
  if (s.includes("private")) return "This reel is private and can't be fetched. Use a custom image instead.";
  if (s.includes("unavailable") || s.includes("404") || s.includes("not found") || s.includes("deleted"))
    return "This reel appears to be deleted or unavailable. Double-check the URL, or use a custom image.";
  if (s.includes("unsupported url")) return "That doesn't look like a supported Instagram reel URL.";
  return "Couldn't fetch this reel. Instagram may be blocking automated access right now — use a custom image as a fallback.";
}

function startJob(url) {
  const id = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
  const file = path.join(CACHE_DIR, `${id}.mp4`);

  const existing = jobs.get(id);
  if (existing && (existing.status === "downloading" || (existing.status === "ready" && fs.existsSync(file)))) {
    return id; // dedupe: in-flight or cached
  }
  if (fs.existsSync(file)) {
    jobs.set(id, { status: "ready", progress: 100, file });
    return id;
  }

  const job = { status: "downloading", progress: 0, file };
  jobs.set(id, job);

  const args = [
    ...ytdlp.prefix,
    "--no-playlist",
    "--newline",
    "--no-part",
    "-f", "mp4/bestvideo*+bestaudio/best",
    "--merge-output-format", "mp4",
    "-o", file,
    url,
  ];
  const child = spawn(ytdlp.cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  const onLine = (line) => {
    const m = /\[download\]\s+([\d.]+)%/.exec(line);
    if (m) job.progress = Math.min(99, parseFloat(m[1]));
  };
  child.stdout.on("data", (d) => String(d).split("\n").forEach(onLine));
  child.stderr.on("data", (d) => {
    stderr += String(d);
    String(d).split("\n").forEach(onLine);
  });
  child.on("error", (err) => {
    job.status = "error";
    job.error = `Failed to launch yt-dlp: ${err.message}`;
  });
  child.on("close", (code) => {
    if (code === 0 && fs.existsSync(file)) {
      job.status = "ready";
      job.progress = 100;
    } else {
      job.status = "error";
      job.error = friendlyError(stderr);
      console.error(`[server] yt-dlp failed for ${url}:\n${stderr.slice(-2000)}`);
    }
  });
  return id;
}

/** Periodically drop cached MP4s older than the TTL. */
setInterval(() => {
  const now = Date.now();
  for (const f of fs.readdirSync(CACHE_DIR)) {
    const p = path.join(CACHE_DIR, f);
    try {
      if (now - fs.statSync(p).mtimeMs > CACHE_TTL_MS) fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}, 10 * 60 * 1000).unref();

const app = express();
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ytdlp: ytdlp ? ytdlp.version : null });
});

app.post("/api/reel", (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!REEL_URL_PATTERN.test(url)) {
    return res.status(400).json({ error: "That doesn't look like an Instagram reel URL." });
  }
  if (!ytdlp) {
    return res.status(503).json({
      error: "yt-dlp is not installed on the server. Install it, or use a custom image instead.",
    });
  }
  const id = startJob(url);
  res.json({ id });
});

app.get("/api/reel/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Unknown job." });
  res.json({
    id: req.params.id,
    status: job.status,
    progress: Math.round(job.progress),
    error: job.error,
    videoUrl: job.status === "ready" ? `/api/video/${req.params.id}` : undefined,
  });
});

app.get("/api/video/:id", (req, res) => {
  if (!/^[a-f0-9]{16}$/.test(req.params.id)) return res.sendStatus(400);
  const file = path.join(CACHE_DIR, `${req.params.id}.mp4`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: "Video not cached (expired?). Fetch the reel again." });

  const size = fs.statSync(file).size;
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-store");

  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (isNaN(start) || start >= size) start = 0;
    if (isNaN(end) || end >= size) end = size - 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", size);
    fs.createReadStream(file).pipe(res);
  }
});

app.listen(PORT, () => {
  console.log(`[server] reel resolver listening on http://localhost:${PORT}`);
});
