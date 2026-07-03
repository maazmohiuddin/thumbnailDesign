import { store, useStore } from "../state/store";
import { ADJUST_KEYS, type AdjustKey } from "../state/types";
import SliderRow from "./SliderRow";

const LABELS: Record<AdjustKey, string> = {
  exposure: "Exposure",
  temperature: "Temperature",
  tint: "Tint",
  contrast: "Contrast",
  highlights: "Highlights",
  shadows: "Shadows",
  saturation: "Saturation",
};

export default function AdjustPanel() {
  const snap = useStore();
  const adjust = snap.doc.adjust;

  return (
    <section className="panel-section">
      <h3>
        Adjust
        <button className="btn small ghost" onClick={() => store.resetAdjust()}>
          Reset adjustments
        </button>
      </h3>
      {ADJUST_KEYS.map((key) => (
        <SliderRow
          key={key}
          label={LABELS[key]}
          value={adjust[key]}
          min={-100}
          max={100}
          step={1}
          resetTo={0}
          display={adjust[key] > 0 ? `+${adjust[key]}` : `${adjust[key]}`}
          onChange={(v) => store.setAdjust({ ...adjust, [key]: v })}
        />
      ))}
    </section>
  );
}
