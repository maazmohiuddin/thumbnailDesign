# ARY+ Thumbnail Studio

A single-purpose, browser-based thumbnail composer for the ARY+ OTT platform. It reproduces the locked
Figma template **"Card A – Dark Anchor"** (1015 × 1920) pixel-perfectly and lets you swap only the
background image and the text, then export a PNG/JPEG.

Background sources:

1. **Instagram Reel** — paste a reel URL; a tiny Node backend resolves it with `yt-dlp`, streams the MP4
   back, and you pick the exact frame with a filmstrip + 1/30 s scrubber (previewed *inside* the real template).
2. **Custom image** — drag & drop a JPG/PNG/WebP (≤ 20 MB) and go straight to the editor.

## Architecture

- **One shared WebGL pipeline** (`src/gl/compositor.ts`) renders both the live preview and the export.
  The canvas backing store is always the native 1015 × 1920 template space; the preview only scales it
  with CSS, and the export encodes the very same canvas — so preview = export, exactly.
- The **base image** is a textured quad: transform matrix (pan/zoom/rotate in native template
  coordinates) + a fragment shader applying, in order: exposure → temperature → tint → contrast →
  highlights → shadows → saturation.
- All **locked layers** (vignette, accent bar, category text, edge-bar gradient, logo, title) are drawn
  once per text change onto a native-resolution 2D canvas (`src/overlay.ts`) and composited as a single
  premultiplied-alpha texture above the image. They are completely non-interactive.
- The template spec lives in `src/template.ts` — values extracted verbatim from the production Figma
  file (node `196:88`). Brand colors and typography are hard-coded constants, not theme variables.
- **Backend** (`server/index.js`): one job — resolve an Instagram reel URL via `yt-dlp`, cache the MP4
  in `/tmp/aryplus-reels` (1 h TTL), and stream it with CORS + HTTP Range support (required for frame
  seeking). Frame extraction itself is fully client-side (hidden `<video>` → canvas).
- **Persistence**: the base image blob goes to IndexedDB, transform/adjust/text state to localStorage —
  a refresh restores your session.

## Getting started

```bash
npm install
npm run dev        # starts Vite (:5173) + the reel resolver (:8787)
```

Open http://localhost:5173.

### Requirements

- Node 18+.
- **`yt-dlp`** on the PATH (or importable via `python3 -m yt_dlp`) for the Instagram path:
  `pipx install yt-dlp`, `brew install yt-dlp`, or `pip install yt-dlp`.
  Without it the app still works via the custom-image path and shows a clear error for reels.
- Fonts (**Poppins 500**, **Permanent Marker**) are self-hosted in `public/fonts/` (the exact woff2
  files Google Fonts serves) and registered as explicit `FontFace` objects; exports are blocked until
  both faces report `status === "loaded"`, so fallback fonts can never leak into output — even offline.

### Logo asset

`public/assets/logo.png` is the ARY+ logo exported from the Figma file (transparent background,
1328 × 490). If the brand team ships an updated official export, drop it in at the same path — it is
placed at 168 × 62 (cover-fit) per the template spec.

## Deploying to Vercel (or any static host)

`vercel.json` builds the frontend as a static Vite app (`npm run build` → `dist/`). That covers the
**custom-image path completely** — no backend needed.

The **Instagram Reel path will not work out of the box on Vercel.** `server/index.js` is a persistent
Node process that spawns `yt-dlp` as a child process, caches the MP4 to local disk, and streams it back
with HTTP Range support — none of which fits Vercel's serverless function model (no persistent
filesystem across invocations, no arbitrary binaries, execution time limits that don't suit a multi-MB
video download).

To enable the reel path on a static deployment:

1. Host `server/index.js` somewhere that supports a long-lived process + installing `yt-dlp` — Render,
   Railway, Fly.io, or a small VPS all work. It's a single `node server/index.js`, listening on `PORT`.
2. In your Vercel project settings, set the environment variable `VITE_REEL_API_BASE_URL` to that
   backend's origin (e.g. `https://aryplus-reel-api.onrender.com`) and redeploy. The frontend will call
   `${VITE_REEL_API_BASE_URL}/api/reel` instead of a same-origin path.
3. Leave `VITE_REEL_API_BASE_URL` unset for local dev (`npm run dev`) — Vite's dev-server proxy already
   routes same-origin `/api/*` calls to `server/index.js` on `:8787`.

Without step 1–2, reel fetch attempts on the deployed site show a clear inline error pointing at the
custom-image fallback — they don't silently fail.

### Option: a local desktop companion app instead of a hosted backend

If you'd rather not run a separate always-on server, `desktop/build.mjs` packages `server/index.js`
into a single **Windows `.exe`** — double-click it, leave the console window open, and it serves the
reel resolver on `http://127.0.0.1:8787` for the machine it's running on. Set
`VITE_REEL_API_BASE_URL=http://127.0.0.1:8787` on the Vercel project and redeploy; your Vercel-hosted
frontend will call straight into it. (Browsers treat `127.0.0.1`/`localhost` as a trustworthy origin, so
an HTTPS page calling `http://127.0.0.1` isn't blocked as mixed content; the server also sends the
`Access-Control-Allow-Private-Network` header Chrome's Local Network Access check looks for.)

- **First run needs internet once**: it auto-downloads the official `yt-dlp.exe` from yt-dlp's GitHub
  releases into a per-user app-data folder and reuses it after that (keeps it current, rather than
  freezing a copy at build time). A `yt-dlp.exe` dropped next to the app's own `.exe` overrides this.
- **Binds to loopback only** (`127.0.0.1`), so it never appears on the LAN and Windows won't prompt a
  Firewall "allow access" dialog.
- Build it yourself with:

  ```bash
  npm run build:desktop
  ```

  This bundles `server/index.js` with esbuild, turns it into a [Node.js Single Executable Application](
  https://nodejs.org/api/single-executable-applications.html), and injects that into a real Windows
  `node.exe` downloaded from nodejs.org — no `pkg`/`nexe` involved, so it only depends on nodejs.org
  and npm. Output: `desktop/dist/ARYPlusReelBackend.exe` (~90 MB — it's a full embedded Node runtime).
  Windows SmartScreen will flag it as an unrecognized publisher on first launch (expected for any
  unsigned indie `.exe` — click "More info" → "Run anyway"), unless you code-sign it yourself.

### When Instagram asks for a login (cookies)

Instagram increasingly gates posts — especially plain `/p/...` links, less so `/reel/...` — behind a
logged-in session even for anonymous viewing. yt-dlp reports this as `Instagram sent an empty media
response...`, which the app surfaces as "Instagram is requiring a logged-in session to view this post."
Fix it by pointing yt-dlp at a real, logged-in browser session's cookies:

- **`npm run dev` / a hosted backend**: set the environment variable `YTDLP_COOKIES_BROWSER=chrome`
  (or `firefox`, `edge`, `brave`, `safari` — whichever browser you're logged into Instagram with, and
  which must be installed on the same machine the backend runs on), or `YTDLP_COOKIES_FILE=/path/to/
  cookies.txt` for a manually exported Netscape-format cookie file.
- **The packaged `.exe`**: there's no terminal to set env vars in, so drop a `config.json` next to the
  `.exe` instead (see `desktop/config.example.json`):

  ```json
  { "cookiesFromBrowser": "chrome" }
  ```

Either way this only works if that browser is actually logged into Instagram on the machine running the
backend — it reads that browser's real cookie store, nothing is sent anywhere else.

## Template spec (locked)

| Layer | Geometry | Notes |
|---|---|---|
| Outer canvas | 1015 × 1920 `#000` | 285 px black bars top & bottom are part of the export |
| Inner frame | 1015 × 1350 @ y = 285 | clips all content |
| Base image | default −53, −8, 1086 × 1358 | the only editable layer (transform + color) |
| Vignette | 4, 575, 1026 × 775 | transparent → rgba(0,0,0,.92), top→bottom |
| Accent bar | 81.8, 1034, 101.1 × 5.62 | `#DFFF00` |
| Category | x 81.8, y 1056.47 | Poppins Medium 30.891 px, tracking 5.6166 px, `#DFFF00` |
| Edge bar | x 0–18, y 1–1350 | gradient from bottom: `#DFFF00` → `#00FF00` @ 77.4% → `#DFFF00` |
| Logo | 780.43, 1151.35, 167.78 × 61.91 | static asset |
| Title | x 81.8, lines @ y 1109.63 / 1187 | Permanent Marker 85 px, `#FFF`, two independent lines |

Only the base image transform/color and the *content* of the three text fields are editable. No font,
size, color, or position controls exist anywhere in the UI — by design.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + reel resolver, concurrently |
| `npm run dev:web` / `npm run dev:api` | each half separately |
| `npm run build` | typecheck + production build to `dist/` |
| `npm run typecheck` | TypeScript only |

## Keyboard

Arrows nudge the image 1 px (Shift = 10 px) · `+` / `−` zoom · `Ctrl/⌘+Z` undo, `Ctrl/⌘+Shift+Z` redo ·
double-click the image to reset its transform.
