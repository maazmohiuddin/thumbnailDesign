import { useRef } from "react";
import { store } from "../state/store";

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: string;
  onChange: (v: number) => void;
  /** Double-clicking the label resets to this value (if provided). */
  resetTo?: number;
}

/** A labeled slider that snapshots undo state at the start of each gesture. */
export default function SliderRow({ label, value, min, max, step, display, onChange, resetTo }: Props) {
  const lastKey = useRef(0);
  return (
    <div className="control-row">
      <div className="label-row">
        <label
          title={resetTo !== undefined ? "Double-click to reset" : undefined}
          onDoubleClick={() => {
            if (resetTo === undefined) return;
            store.beginAction();
            onChange(resetTo);
          }}
        >
          {label}
        </label>
        <span className="value">{display ?? value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => store.beginAction()}
        onKeyDown={(e) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
          const now = Date.now();
          if (now - lastKey.current > 500) store.beginAction();
          lastKey.current = now;
        }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}
