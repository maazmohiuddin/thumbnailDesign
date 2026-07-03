/**
 * Locates a usable yt-dlp binary, in order of preference:
 *   1. Sibling to the running executable (lets a user drop yt-dlp.exe next
 *      to the packaged desktop .exe and override everything else).
 *   2. This app's persistent cache dir (where a prior auto-download landed).
 *   3. PATH (`yt-dlp`) or `python3 -m yt_dlp` (a normal dev-machine install).
 *   4. Auto-download the official platform binary from yt-dlp's GitHub
 *      releases into the cache dir, so this app has zero setup steps on a
 *      fresh Windows machine — only needs internet on first run.
 *
 * Downloading (rather than shipping the binary inside the packaged .exe) also
 * means it stays current: yt-dlp ships frequent releases to keep up with
 * Instagram/YouTube site changes, and a binary frozen at package-build time
 * would silently rot.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const GITHUB_ASSET_BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

function platformAssetName() {
  if (process.platform === "win32") return "yt-dlp.exe";
  if (process.platform === "darwin") return "yt-dlp_macos";
  return "yt-dlp";
}

/** A writable, persistent-across-runs directory for this app's own data. */
function appDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || os.tmpdir(), "ARYPlusReelBackend");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "ARYPlusReelBackend");
  }
  return path.join(os.homedir(), ".aryplus-reel-backend");
}

function tryVersion(cmd, prefix) {
  try {
    const r = spawnSync(cmd, [...prefix, "--version"], { encoding: "utf8", timeout: 10000 });
    if (r.status === 0) return r.stdout.trim();
  } catch {
    /* not found */
  }
  return null;
}

/** Directory the running executable lives in — works both for `node server/index.js` and a packaged SEA .exe. */
function execDir() {
  return path.dirname(process.execPath);
}

async function downloadTo(url, dest, onRedirect) {
  const res = await fetch(url, { redirect: "manual" });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) throw new Error(`Redirect with no Location header (${res.status})`);
    onRedirect?.(loc);
    return downloadTo(loc, dest, onRedirect);
  }
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const file = fs.createWriteStream(tmp);
  await new Promise((resolve, reject) => {
    const reader = res.body.getReader();
    const pump = () =>
      reader
        .read()
        .then(({ done, value }) => {
          if (done) return file.end(resolve);
          file.write(Buffer.from(value), () => pump());
        })
        .catch(reject);
    pump();
  });
  await fs.promises.rename(tmp, dest);
  if (process.platform !== "win32") await fs.promises.chmod(dest, 0o755);
}

/**
 * Resolves a usable yt-dlp. Returns `{ cmd, prefix, version }` or `null` if
 * none could be found or downloaded (network-less environments still work —
 * the custom-image path never depends on this).
 */
export async function resolveYtdlp(log = console.log) {
  const assetName = platformAssetName();

  const siblingPath = path.join(execDir(), assetName);
  const cachedPath = path.join(appDataDir(), assetName);

  for (const candidate of [siblingPath, cachedPath]) {
    if (fs.existsSync(candidate)) {
      const version = tryVersion(candidate, []);
      if (version) return { cmd: candidate, prefix: [], version };
    }
  }

  for (const [cmd, prefix] of [
    ["yt-dlp", []],
    ["python3", ["-m", "yt_dlp"]],
  ]) {
    const version = tryVersion(cmd, prefix);
    if (version) return { cmd, prefix, version };
  }

  log(`[server] yt-dlp not found locally — downloading ${assetName} (first run only)...`);
  try {
    const url = `${GITHUB_ASSET_BASE}/${assetName}`;
    await downloadTo(url, cachedPath, (loc) => log(`[server]   ↳ ${new URL(loc).hostname}`));
    const version = tryVersion(cachedPath, []);
    if (version) {
      log(`[server] yt-dlp ${version} downloaded to ${cachedPath}`);
      return { cmd: cachedPath, prefix: [], version };
    }
  } catch (err) {
    log(`[server] yt-dlp auto-download failed: ${err.message}`);
  }
  return null;
}
