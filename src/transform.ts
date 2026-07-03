import { BASE_DEFAULT, INNER_H, INNER_W } from "./template";
import type { TransformState } from "./state/types";

/**
 * All math happens in Inner-frame native coordinates.
 *
 * The image is placed as: translate(cx, cy) · rotate(θ) · scale(s) around the
 * image center, where s = coverScale(image) · zoom. θ rotates around the Inner
 * frame center (rotation changes are applied by orbiting cx/cy about it).
 *
 * Invariant enforced by clampTransform: the four Inner-frame corners, mapped
 * into image space, always lie inside the image → no background gaps, ever.
 */

export const INNER_CX = INNER_W / 2;
export const INNER_CY = INNER_H / 2;

export const MAX_ZOOM = 4;

/** Scale at which the image cover-fits the Figma default 1086 × 1358 bleed box. zoom = 1 maps to this. */
export function coverScale(iw: number, ih: number): number {
  return Math.max(BASE_DEFAULT.w / iw, BASE_DEFAULT.h / ih);
}

/** Figma-default transform: cover-fit into the bleed box, centered on it. */
export function defaultTransform(): TransformState {
  return {
    cx: BASE_DEFAULT.x + BASE_DEFAULT.w / 2,
    cy: BASE_DEFAULT.y + BASE_DEFAULT.h / 2,
    zoom: 1,
    rotationDeg: 0,
  };
}

/** "Fit" preset: cover exactly the Inner frame (no bleed), centered. */
export function fitTransform(iw: number, ih: number): TransformState {
  const s0 = coverScale(iw, ih);
  const sFit = Math.max(INNER_W / iw, INNER_H / ih);
  return { cx: INNER_CX, cy: INNER_CY, zoom: sFit / s0, rotationDeg: 0 };
}

/**
 * Minimum zoom (relative to coverScale) at which a rotated image can still
 * cover the Inner frame. Derived by projecting the Inner rect's half-extents
 * onto the rotated image axes.
 */
export function minZoom(iw: number, ih: number, rotationDeg: number): number {
  const t = (Math.abs(rotationDeg) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const needW = INNER_W * c + INNER_H * s;
  const needH = INNER_W * s + INNER_H * c;
  const minScalePx = Math.max(needW / iw, needH / ih);
  return minScalePx / coverScale(iw, ih);
}

/**
 * Clamp a candidate transform so the image fully covers the Inner frame.
 * Works in image space: the Inner rect becomes a rotated rect that must fit
 * inside the axis-aligned image bounds; clamp its center, then map back.
 */
export function clampTransform(t: TransformState, iw: number, ih: number): TransformState {
  const zoom = Math.min(MAX_ZOOM, Math.max(minZoom(iw, ih, t.rotationDeg), t.zoom));
  const s = coverScale(iw, ih) * zoom;
  const rad = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Inner-frame center in image space (image center at origin).
  let ix = (cos * (INNER_CX - t.cx) + sin * (INNER_CY - t.cy)) / s;
  let iy = (-sin * (INNER_CX - t.cx) + cos * (INNER_CY - t.cy)) / s;

  // Half-extents of the Inner rect (inner px), converted to image px via /s.
  const hx = (INNER_W / 2) * Math.abs(cos) + (INNER_H / 2) * Math.abs(sin);
  const hy = (INNER_W / 2) * Math.abs(sin) + (INNER_H / 2) * Math.abs(cos);
  const maxIx = Math.max(0, iw / 2 - hx / s);
  const maxIy = Math.max(0, ih / 2 - hy / s);
  ix = Math.min(maxIx, Math.max(-maxIx, ix));
  iy = Math.min(maxIy, Math.max(-maxIy, iy));

  // Map the clamped inner-center back to a new image center in inner coords.
  const cx = INNER_CX - s * (cos * ix - sin * iy);
  const cy = INNER_CY - s * (sin * ix + cos * iy);

  return { cx, cy, zoom, rotationDeg: t.rotationDeg };
}

/** Pan by a delta in inner px, then clamp. */
export function pan(t: TransformState, dx: number, dy: number, iw: number, ih: number): TransformState {
  return clampTransform({ ...t, cx: t.cx + dx, cy: t.cy + dy }, iw, ih);
}

/** Zoom about a pivot point (inner coords) so the image point under the pivot stays put. */
export function zoomAbout(
  t: TransformState,
  pivotX: number,
  pivotY: number,
  factor: number,
  iw: number,
  ih: number
): TransformState {
  const zoom = Math.min(MAX_ZOOM, Math.max(minZoom(iw, ih, t.rotationDeg), t.zoom * factor));
  const f = zoom / t.zoom;
  const cx = pivotX + (t.cx - pivotX) * f;
  const cy = pivotY + (t.cy - pivotY) * f;
  return clampTransform({ ...t, cx, cy, zoom }, iw, ih);
}

/** Set rotation, orbiting the image center around the Inner frame center, then clamp (may raise zoom). */
export function setRotation(t: TransformState, deg: number, iw: number, ih: number): TransformState {
  const clamped = Math.min(45, Math.max(-45, deg));
  const snapped = Math.abs(clamped) < 0.75 ? 0 : clamped;
  const dRad = ((snapped - t.rotationDeg) * Math.PI) / 180;
  const cos = Math.cos(dRad);
  const sin = Math.sin(dRad);
  const dx = t.cx - INNER_CX;
  const dy = t.cy - INNER_CY;
  const cx = INNER_CX + cos * dx - sin * dy;
  const cy = INNER_CY + sin * dx + cos * dy;
  return clampTransform({ ...t, cx, cy, rotationDeg: snapped }, iw, ih);
}

/** 3×3 column-major matrix mapping image pixel coords → Inner-frame coords. */
export function imageToInnerMatrix(t: TransformState, iw: number, ih: number): number[] {
  const s = coverScale(iw, ih) * t.zoom;
  const rad = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad) * s;
  const sin = Math.sin(rad) * s;
  // p_inner = c + R·s·(p_img − imgCenter)
  const tx = t.cx - (cos * (iw / 2) - sin * (ih / 2));
  const ty = t.cy - (sin * (iw / 2) + cos * (ih / 2));
  return [cos, sin, 0, -sin, cos, 0, tx, ty, 1];
}
