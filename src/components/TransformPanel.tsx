import { store, useStore } from "../state/store";
import {
  clampTransform,
  defaultTransform,
  fitTransform,
  minZoom,
  setRotation,
  zoomAbout,
  INNER_CX,
  INNER_CY,
  MAX_ZOOM,
} from "../transform";
import SliderRow from "./SliderRow";

export default function TransformPanel() {
  const snap = useStore();
  const { transform } = snap.doc;
  const { imageW: iw, imageH: ih } = snap;
  const zMin = minZoom(iw, ih, transform.rotationDeg);

  const apply = (t: ReturnType<typeof defaultTransform>) => {
    store.beginAction();
    store.setTransform(clampTransform(t, iw, ih));
  };

  return (
    <section className="panel-section">
      <h3>Transform</h3>
      <SliderRow
        label="Zoom"
        value={transform.zoom}
        min={zMin}
        max={MAX_ZOOM}
        step={0.005}
        display={`${transform.zoom.toFixed(2)}×`}
        resetTo={1}
        onChange={(v) =>
          store.setTransform(zoomAbout(transform, INNER_CX, INNER_CY, v / transform.zoom, iw, ih))
        }
      />
      <SliderRow
        label="Rotate"
        value={transform.rotationDeg}
        min={-45}
        max={45}
        step={0.5}
        display={`${transform.rotationDeg.toFixed(1)}°`}
        resetTo={0}
        onChange={(v) => store.setTransform(setRotation(transform, v, iw, ih))}
      />
      <div className="btn-row">
        <button className="btn small" title="Cover the frame exactly, centered" onClick={() => apply(fitTransform(iw, ih))}>
          Fit
        </button>
        <button className="btn small" title="Figma default: cover with slight bleed" onClick={() => apply(defaultTransform())}>
          Fill
        </button>
        <button className="btn small" title="Reset to the Figma default placement" onClick={() => apply(defaultTransform())}>
          Reset
        </button>
      </div>
      <p className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>
        Drag the canvas to pan · scroll to zoom · double-click to reset.
      </p>
    </section>
  );
}
