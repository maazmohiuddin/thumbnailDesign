import type { Compositor } from "./gl/compositor";
import type { DocState } from "./state/types";
import { fontsAreLoaded, fontsReady } from "./fonts";

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export function exportFilename(doc: DocState, ext: "png" | "jpg"): string {
  const title = `${doc.text.title1} ${doc.text.title2}`.trim();
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate()
  ).padStart(2, "0")}`;
  return `aryplus-thumb-${slugify(title)}-${ymd}.${ext}`;
}

/**
 * Export the current composite at native 1015 × 1920. Re-renders through the
 * exact same WebGL pipeline the preview uses, then encodes the same canvas —
 * nothing is ever scaled.
 *
 * Guard: refuses to run until fonts are loaded and a base image is present.
 */
export async function exportImage(
  compositor: Compositor,
  doc: DocState,
  format: "png" | "jpeg"
): Promise<void> {
  if (!compositor.hasImage()) throw new Error("No base image loaded yet.");
  if (!fontsAreLoaded()) await fontsReady();
  compositor.render(doc.transform, doc.adjust);
  const blob = await compositor.toBlob(
    format === "png" ? "image/png" : "image/jpeg",
    format === "jpeg" ? 0.92 : undefined
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFilename(doc, format === "png" ? "png" : "jpg");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
