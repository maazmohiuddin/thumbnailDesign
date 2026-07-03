/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Origin of a separately-hosted reel-resolver backend (see server/index.js),
   * e.g. "https://aryplus-reel-api.onrender.com". Required on static/serverless
   * deployments (Vercel, Netlify, ...) for the Instagram Reel path; leave unset
   * for local dev, where Vite proxies same-origin /api requests to it directly.
   */
  readonly VITE_REEL_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
