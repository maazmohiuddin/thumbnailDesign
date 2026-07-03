import {
  ACCENT_BAR,
  CATEGORY,
  COLOR_ACCENT,
  COLOR_BLACK,
  COLOR_EDGE_GREEN,
  COLOR_TITLE,
  EDGE_BAR,
  INNER_H,
  INNER_W,
  LOGO,
  TITLE,
  VIGNETTE,
} from "./template";
import { CATEGORY_FONT, TITLE_FONT, measureCssAscent } from "./fonts";
import type { TextState } from "./state/types";

/**
 * Renders every LOCKED layer (vignette, accent bar, category, edge bar, logo,
 * title) onto a 1015 × 1350 canvas in native template coordinates. The result
 * is uploaded as a single texture and composited over the base image by the
 * WebGL pipeline — identically for preview and export.
 *
 * Layer order (Figma): image → vignette → accent bar → category → edge bar → logo → title.
 */

/**
 * Figma/CSS position text by the top of the line box; with `line-height:
 * normal` the baseline sits one line-box ascent below that top. Canvas draws
 * from the alphabetic baseline, so we add the DOM-measured CSS ascent
 * (canvas fontBoundingBoxAscent is measurably wrong for this — see fonts.ts).
 */
function baselineFor(ctx: CanvasRenderingContext2D, font: string, topY: number): number {
  ctx.font = font;
  return topY + measureCssAscent(font);
}

/**
 * Draw a single line with Figma-style letter tracking. Prefers the native
 * canvas `letterSpacing` property (keeps kerning/shaping intact, matching
 * DOM/Figma); falls back to per-character advances elsewhere.
 */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baselineY: number,
  trackingPx: number
): void {
  // (typed loosely: older Safari/Firefox lack canvas letterSpacing at runtime)
  const spacing = ctx as { letterSpacing?: string };
  if (typeof spacing.letterSpacing === "string") {
    spacing.letterSpacing = `${trackingPx}px`;
    ctx.fillText(text, x, baselineY);
    spacing.letterSpacing = "0px";
    return;
  }
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, baselineY);
    cursor += ctx.measureText(ch).width + trackingPx;
  }
}

export function createOverlayCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = INNER_W;
  c.height = INNER_H;
  return c;
}

export function renderOverlay(
  canvas: HTMLCanvasElement,
  text: TextState,
  logo: HTMLImageElement | null
): void {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, INNER_W, INNER_H);

  // 2. Vignette — linear gradient top→bottom, transparent → rgba(0,0,0,0.92).
  const vg = ctx.createLinearGradient(0, VIGNETTE.y, 0, VIGNETTE.y + VIGNETTE.h);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, `rgba(0,0,0,${VIGNETTE.alphaBottom})`);
  ctx.fillStyle = vg;
  ctx.fillRect(VIGNETTE.x, VIGNETTE.y, VIGNETTE.w, VIGNETTE.h);

  // 3. Accent bar — solid #DFFF00.
  ctx.fillStyle = COLOR_ACCENT;
  ctx.fillRect(ACCENT_BAR.x, ACCENT_BAR.y, ACCENT_BAR.w, ACCENT_BAR.h);

  // 4. Category text — Poppins Medium 30.891px, 5.6166px tracking, #DFFF00.
  ctx.fillStyle = COLOR_ACCENT;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const catBaseline = baselineFor(ctx, CATEGORY_FONT, CATEGORY.y);
  drawTracked(ctx, text.category, CATEGORY.x, catBaseline, CATEGORY.trackingPx);

  // 5. Left edge bar — gradient along its length, starting at the BOTTOM:
  //    #DFFF00 → #00FF00 at 77.404% → #DFFF00.
  const eg = ctx.createLinearGradient(0, EDGE_BAR.y + EDGE_BAR.h, 0, EDGE_BAR.y);
  eg.addColorStop(0, COLOR_ACCENT);
  eg.addColorStop(EDGE_BAR.greenStop, COLOR_EDGE_GREEN);
  eg.addColorStop(1, COLOR_ACCENT);
  ctx.fillStyle = eg;
  ctx.fillRect(EDGE_BAR.x, EDGE_BAR.y, EDGE_BAR.w, EDGE_BAR.h);

  // 6. Logo — static asset, cover-fit into its box.
  if (logo && logo.naturalWidth > 0) {
    const scale = Math.max(LOGO.w / logo.naturalWidth, LOGO.h / logo.naturalHeight);
    const dw = logo.naturalWidth * scale;
    const dh = logo.naturalHeight * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(LOGO.x, LOGO.y, LOGO.w, LOGO.h);
    ctx.clip();
    ctx.drawImage(logo, LOGO.x + (LOGO.w - dw) / 2, LOGO.y + (LOGO.h - dh) / 2, dw, dh);
    ctx.restore();
  }

  // 7. Title — Permanent Marker 85px, white, two independent lines.
  ctx.fillStyle = COLOR_TITLE;
  const t1Baseline = baselineFor(ctx, TITLE_FONT, TITLE.line1Y);
  if (text.title1) ctx.fillText(text.title1, TITLE.x, t1Baseline);
  const t2Baseline = baselineFor(ctx, TITLE_FONT, TITLE.line2Y);
  if (text.title2) ctx.fillText(text.title2, TITLE.x, t2Baseline);
}

/** True when a title line overflows the frame width at the locked 85px size. */
export function titleOverflows(ctx: CanvasRenderingContext2D, line: string): boolean {
  if (!line) return false;
  ctx.font = TITLE_FONT;
  return TITLE.x + ctx.measureText(line).width > INNER_W;
}

let measureCtx: CanvasRenderingContext2D | null = null;
export function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d")!;
  }
  return measureCtx;
}

export { COLOR_BLACK };
