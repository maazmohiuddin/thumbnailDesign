/**
 * Template spec — "Card A – Dark Anchor"
 * Extracted verbatim from the production Figma file (node 196:88).
 * These values are LOCKED brand constants. Do not expose any of them to the UI.
 */

/** Outer canvas: 1015 × 1920, black. */
export const CANVAS_W = 1015;
export const CANVAS_H = 1920;

/** Inner frame: 1015 × 1350 at (0, 285). Clips all content. */
export const INNER_X = 0;
export const INNER_Y = 285;
export const INNER_W = 1015;
export const INNER_H = 1350;

/** Base image default placement (Figma: rect at (−53, −8), 1086 × 1358, cover-fit). */
export const BASE_DEFAULT = { x: -53, y: -8, w: 1086, h: 1358 } as const;

/** Vignette: (4, 575) 1026 × 775, linear gradient top→bottom, transparent → rgba(0,0,0,0.92). */
export const VIGNETTE = { x: 4, y: 575, w: 1026, h: 775, alphaBottom: 0.92 } as const;

/** Accent bar: solid #DFFF00. */
export const ACCENT_BAR = { x: 81.8046875, y: 1034, w: 101.09834289550781, h: 5.616574287414551 } as const;

/** Category text: Poppins Medium 30.891px, tracking 5.6166px, #DFFF00, single line. */
export const CATEGORY = {
  x: 81.8046875,
  y: 1056.4658203125, // top of the CSS line box
  lineHeight: 46,
  fontSizePx: 30.891,
  trackingPx: 5.6166,
  fontFamily: "Poppins",
  fontWeight: 500,
} as const;

/**
 * Left edge bar: 18px-wide vertical strip on the left edge, y 1–1350.
 * Gradient runs along its length from the BOTTOM: #DFFF00 at 0% → #00FF00 at 77.404% → #DFFF00 at 100%.
 * (In Figma it is a 1349 × 18 rect rotated −90°, so the gradient start lands at the bottom.)
 */
export const EDGE_BAR = { x: 0, y: 1, w: 18.000118094467325, h: 1349.0000007868075, greenStop: 0.77404 } as const;

/** Logo: static asset placement. */
export const LOGO = { x: 780.4296875, y: 1151.34619140625, w: 167.779541015625, h: 61.90660858154297 } as const;

/** Title: Permanent Marker Regular 85px, #FFFFFF, two independent lines. */
export const TITLE = {
  x: 81.8046875,
  line1Y: 1109.6318359375, // top of the CSS line box, line 1
  line2Y: 1187, // top of the CSS line box, line 2 (fixed 77.37px offset)
  lineHeight: 124,
  fontSizePx: 85,
  fontFamily: "Permanent Marker",
  fontWeight: 400,
} as const;

/** Hard-locked brand colors. Not theme variables. */
export const COLOR_ACCENT = "#DFFF00";
export const COLOR_EDGE_GREEN = "#00FF00";
export const COLOR_TITLE = "#FFFFFF";
export const COLOR_BLACK = "#000000";

/** Default text content. */
export const DEFAULT_CATEGORY = "TELEFILMS · ARY+";
export const DEFAULT_TITLE_1 = "Mannay Ki";
export const DEFAULT_TITLE_2 = "Shadi";

export const LOGO_URL = "/assets/logo.png";
