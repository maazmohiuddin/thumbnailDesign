/**
 * ARY+ Thumbnail Studio — reel resolver.
 *
 * Single job: resolve an Instagram Reel URL to a downloadable MP4 via yt-dlp,
 * cache it in /tmp, and stream it back with CORS + Range support (the client
 * seeks the <video> element, so byte-range responses are required).
 */
import express from "express";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveYtdlp } from "./ytdlp.js";

const PORT = Number(process.env.PORT) || 8787;
// Loopback-only: this backend only ever needs to serve the browser tab open
// on the same machine, and binding 127.0.0.1 (instead of all interfaces)
// means no LAN exposure and no Windows Firewall prompt on first run.
const HOST = process.env.HOST || "127.0.0.1";
const CACHE_DIR = path.join(os.tmpdir(), "aryplus-reels");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const REEL_URL_PATTERN =
  /^https?:\/\/(www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(reel|reels|p|tv)\/[A-Za-z0-9_-]+/i;

fs.mkdirSync(CACHE_DIR, { recursive: true });

let ytdlp = null;

/**
 * Instagram increasingly gates posts (especially /p/ links, less so /reel/)
 * behind a logged-in session even for anonymous viewing — yt-dlp then reports
 * "sent an empty media response" rather than a clear "login required". Both
 * cases need the same fix: pass yt-dlp a cookie source from a real logged-in
 * browser session. Configurable two ways (env wins if both are set):
 *   - env vars YTDLP_COOKIES_BROWSER / YTDLP_COOKIES_FILE (good for hosted
 *     deployments or `npm run dev`)
 *   - a sibling config.json next to the executable, e.g.
 *     { "cookiesFromBrowser": "chrome" } — the only practical option for a
 *     double-clicked .exe with no terminal to set env vars in.
 */
function loadCookieConfig() {
  let fromFile = {};
  try {
    const configPath = path.join(path.dirname(process.execPath), "config.json");
    fromFile = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    /* no config.json, or it's invalid — fine, cookies are optional */
  }
  return {
    cookiesFromBrowser: process.env.YTDLP_COOKIES_BROWSER || fromFile.cookiesFromBrowser || null,
    cookiesFile: process.env.YTDLP_COOKIES_FILE || fromFile.cookiesFile || null,
  };
}
const cookieConfig = loadCookieConfig();
if (cookieConfig.cookiesFromBrowser || cookieConfig.cookiesFile) {
  console.log(
    `[server] using yt-dlp cookies from ${
      cookieConfig.cookiesFromBrowser ? `browser "${cookieConfig.cookiesFromBrowser}"` : cookieConfig.cookiesFile
    }`
  );
}

/** jobId → { status, progress, error, file } */
const jobs = new Map();

function friendlyError(stderr) {
  const s = stderr.toLowerCase();
  const needsLogin =
    s.includes("login required") ||
    s.includes("empty media response") ||
    (s.includes("cookies") && (s.includes("authentication") || s.includes("rate-limit") || s.includes("rate limit")));
  if (needsLogin) {
    return cookieConfig.cookiesFromBrowser || cookieConfig.cookiesFile
      ? "Instagram still requires a logged-in session for this post even with cookies configured — make sure you're logged into Instagram in that browser, then try again. Otherwise use a custom image."
      : "Instagram is requiring a logged-in session to view this post. Set YTDLP_COOKIES_BROWSER=chrome (or firefox/edge/brave — whichever browser you're logged into Instagram with) as an environment variable, or add a sibling config.json with {\"cookiesFromBrowser\": \"chrome\"}, then try again. Otherwise use a custom image instead.";
  }
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
    ...(cookieConfig.cookiesFromBrowser ? ["--cookies-from-browser", cookieConfig.cookiesFromBrowser] : []),
    ...(cookieConfig.cookiesFile ? ["--cookies", cookieConfig.cookiesFile] : []),
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
  // Chrome's Local Network Access check gates public-page → localhost fetches
  // behind this header on the preflight response (the Vercel-hosted frontend
  // calling this local backend is exactly that case).
  res.setHeader("Access-Control-Allow-Private-Network", "true");
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

async function main() {
  ytdlp = await resolveYtdlp();
  if (!ytdlp) {
    console.warn(
      "[server] yt-dlp not found and couldn't be downloaded. The Instagram Reel path is " +
        "disabled — the custom-image path works regardless."
    );
  } else {
    console.log(`[server] yt-dlp ${ytdlp.version} (${ytdlp.cmd})`);
  }

  app.listen(PORT, HOST, () => {
    console.log("");
    console.log("  ARY+ Thumbnail Studio — reel resolver backend");
    console.log("  ─────────────────────────────────────────────");
    console.log(`  Running at http://${HOST}:${PORT}`);
    console.log("  Keep this window open while using the Instagram Reel step.");
    console.log("  The custom-image path in the app works with or without this.");
    console.log("");
  });
}

main();
