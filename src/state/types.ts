export interface TransformState {
  /** Image center in Inner-frame coordinates (px). */
  cx: number;
  cy: number;
  /** Zoom multiplier relative to the default cover scale (1 = Figma default). */
  zoom: number;
  /** Rotation in degrees, −45…+45, around the Inner frame center. */
  rotationDeg: number;
}

export interface AdjustState {
  exposure: number;
  temperature: number;
  tint: number;
  contrast: number;
  highlights: number;
  shadows: number;
  saturation: number;
}

export type AdjustKey = keyof AdjustState;

export const ADJUST_KEYS: AdjustKey[] = [
  "exposure",
  "temperature",
  "tint",
  "contrast",
  "highlights",
  "shadows",
  "saturation",
];

export interface TextState {
  category: string;
  title1: string;
  title2: string;
}

/** The full editable document (everything undo tracks + persistence saves). */
export interface DocState {
  transform: TransformState;
  adjust: AdjustState;
  text: TextState;
}

export const DEFAULT_ADJUST: AdjustState = {
  exposure: 0,
  temperature: 0,
  tint: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
};

export type Step = "source" | "frames" | "editor";
