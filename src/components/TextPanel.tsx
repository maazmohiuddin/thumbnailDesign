import { useRef } from "react";
import { store, useStore } from "../state/store";
import { getMeasureCtx, titleOverflows } from "../overlay";
import { fontsAreLoaded } from "../fonts";

export default function TextPanel() {
  const snap = useStore();
  const text = snap.doc.text;
  const lastEdit = useRef(0);

  /** Group rapid keystrokes into a single undo step. */
  const beginTyping = () => {
    const now = Date.now();
    if (now - lastEdit.current > 900) store.beginAction();
    lastEdit.current = now;
  };

  const fontsOk = fontsAreLoaded();
  const overflow1 = fontsOk && titleOverflows(getMeasureCtx(), text.title1);
  const overflow2 = fontsOk && titleOverflows(getMeasureCtx(), text.title2);

  return (
    <section className="panel-section">
      <h3>Text</h3>
      <div className="field">
        <label htmlFor="cat">Category</label>
        <input
          id="cat"
          type="text"
          value={text.category}
          spellCheck={false}
          onChange={(e) => {
            beginTyping();
            store.setText({ ...text, category: e.target.value.toUpperCase() });
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="t1">Title — line 1 {overflow1 && <span className="warn">⚠ Text exceeds safe area</span>}</label>
        <input
          id="t1"
          type="text"
          value={text.title1}
          spellCheck={false}
          onChange={(e) => {
            beginTyping();
            store.setText({ ...text, title1: e.target.value });
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="t2">Title — line 2 {overflow2 && <span className="warn">⚠ Text exceeds safe area</span>}</label>
        <input
          id="t2"
          type="text"
          value={text.title2}
          spellCheck={false}
          onChange={(e) => {
            beginTyping();
            store.setText({ ...text, title2: e.target.value });
          }}
        />
      </div>
      <p className="dim" style={{ fontSize: 11.5, margin: 0 }}>
        Position, font, size, and color are locked to the brand template. Either title line may be left empty.
      </p>
    </section>
  );
}
