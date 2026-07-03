import { CATEGORY, TITLE } from "./template";

export const CATEGORY_FONT = `${CATEGORY.fontWeight} ${CATEGORY.fontSizePx}px "${CATEGORY.fontFamily}"`;
export const TITLE_FONT = `${TITLE.fontWeight} ${TITLE.fontSizePx}px "${TITLE.fontFamily}"`;

/**
 * The two brand fonts are self-hosted (same files Google Fonts serves) and
 * registered as explicit FontFace objects. This gives a real, per-face loaded
 * status — `document.fonts.check()` silently returns true for families the
 * browser has never heard of, which would let exports rasterize fallback
 * fonts on a flaky network.
 */
const poppins = new FontFace("Poppins", "url(/fonts/poppins-500-latin.woff2) format('woff2')", {
  weight: "500",
  style: "normal",
});
const marker = new FontFace(
  "Permanent Marker",
  "url(/fonts/permanent-marker-latin.woff2) format('woff2')",
  { weight: "400", style: "normal" }
);
document.fonts.add(poppins);
document.fonts.add(marker);

let loaded: Promise<void> | null = null;

/** Resolves only when both brand fonts are truly usable for canvas rasterization. */
export function fontsReady(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      await Promise.all([poppins.load(), marker.load()]);
      await document.fonts.ready;
    })();
  }
  return loaded;
}

export function fontsAreLoaded(): boolean {
  return poppins.status === "loaded" && marker.status === "loaded";
}

const ascentCache = new Map<string, number>();

/**
 * Figma (like CSS with `line-height: normal`) places the baseline one
 * line-box ascent below the text's top edge. Canvas `fontBoundingBoxAscent`
 * does NOT match that (verified ~10–14px off against the Figma render), so we
 * measure the true CSS ascent with a baseline strut: an empty inline-block's
 * bottom sits exactly on the text baseline.
 */
export function measureCssAscent(font: string): number {
  const cached = ascentCache.get(font);
  if (cached !== undefined) return cached;
  const host = document.createElement("div");
  host.style.cssText =
    "position:absolute;visibility:hidden;left:-9999px;top:0;line-height:normal;white-space:nowrap;";
  host.style.font = font;
  host.textContent = "Hg";
  const strut = document.createElement("span");
  strut.style.cssText = "display:inline-block;width:0;height:0;";
  host.appendChild(strut);
  document.body.appendChild(host);
  const ascent = strut.getBoundingClientRect().bottom - host.getBoundingClientRect().top;
  host.remove();
  ascentCache.set(font, ascent);
  return ascent;
}

/** Pre-measure both brand fonts once they're loaded (called from assetsReady). */
export async function calibrateBaselines(): Promise<void> {
  await fontsReady();
  measureCssAscent(CATEGORY_FONT);
  measureCssAscent(TITLE_FONT);
}
