/**
 * Packages server/index.js into a single, dependency-free Windows .exe using
 * Node's built-in Single Executable Application (SEA) support:
 *
 *   1. esbuild bundles server/index.js (+ express, + ytdlp.js) into one CJS file.
 *   2. `node --experimental-sea-config` turns that bundle into a blob.
 *   3. The blob is injected (via postject) into a real Windows node.exe,
 *      downloaded once from nodejs.org and cached in .cache/.
 *
 * No `pkg`/`nexe` involved — those fetch their prebuilt base binaries from
 * GitHub releases, which isn't reachable from every build environment (incl.
 * this one). nodejs.org's own binaries are what SEA is designed to patch, so
 * this path only ever depends on nodejs.org + npm.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const CACHE_DIR = path.join(HERE, ".cache");
const OUT_DIR = path.join(HERE, "dist");

// Must match a real published nodejs.org release. Keep in sync with the repo's
// Node engine expectations; SEA blobs are plain source (no code cache), so
// exact patch-version parity with the dev machine isn't required — any
// current Node 20+ build works.
const NODE_VERSION = process.env.SEA_NODE_VERSION || "22.23.1";
const NODE_EXE_URL = `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`;

const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

async function downloadNodeExe() {
  const dest = path.join(CACHE_DIR, `node-v${NODE_VERSION}-win-x64.exe`);
  if (fs.existsSync(dest)) {
    console.log(`[build] using cached ${path.relative(ROOT, dest)}`);
    return dest;
  }
  console.log(`[build] downloading ${NODE_EXE_URL} ...`);
  const res = await fetch(NODE_EXE_URL);
  if (!res.ok) throw new Error(`Failed to download node.exe: HTTP ${res.status}`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`[build] saved ${path.relative(ROOT, dest)} (${(fs.statSync(dest).size / 1e6).toFixed(1)} MB)`);
  return dest;
}

async function bundle() {
  const outfile = path.join(HERE, "bundle.cjs");
  await esbuild.build({
    entryPoints: [path.join(ROOT, "server", "index.js")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile,
    banner: { js: "// ARY+ Thumbnail Studio — reel resolver backend (bundled)" },
  });
  console.log(`[build] bundled server/index.js -> ${path.relative(ROOT, outfile)}`);
  return outfile;
}

function makeSeaBlob(bundlePath) {
  const configPath = path.join(HERE, "sea-config.json");
  const blobPath = path.join(HERE, "sea-prep.blob");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        main: path.relative(HERE, bundlePath),
        output: path.relative(HERE, blobPath),
        disableExperimentalSEAWarning: true,
      },
      null,
      2
    )
  );
  execFileSync(process.execPath, ["--experimental-sea-config", path.basename(configPath)], {
    cwd: HERE,
    stdio: "inherit",
  });
  console.log(`[build] generated SEA blob -> ${path.relative(ROOT, blobPath)}`);
  return blobPath;
}

async function injectBlob(nodeExePath, blobPath) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outExe = path.join(OUT_DIR, "ARYPlusReelBackend.exe");
  fs.copyFileSync(nodeExePath, outExe);
  const postject = await import("postject");
  await postject.inject(outExe, "NODE_SEA_BLOB", fs.readFileSync(blobPath), {
    sentinelFuse: SENTINEL_FUSE,
    machoSegmentName: undefined,
  });
  console.log(`[build] injected blob -> ${path.relative(ROOT, outExe)}`);
  return outExe;
}

async function main() {
  const nodeExePath = await downloadNodeExe();
  const bundlePath = await bundle();
  const blobPath = makeSeaBlob(bundlePath);
  const outExe = await injectBlob(nodeExePath, blobPath);
  console.log("");
  console.log(`Done: ${outExe}`);
  console.log(`Size: ${(fs.statSync(outExe).size / 1e6).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
