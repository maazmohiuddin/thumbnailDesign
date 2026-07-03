import { useSyncExternalStore } from "react";
import {
  DEFAULT_ADJUST,
  type AdjustState,
  type DocState,
  type Step,
  type TextState,
  type TransformState,
} from "./types";
import { DEFAULT_CATEGORY, DEFAULT_TITLE_1, DEFAULT_TITLE_2 } from "../template";
import { clampTransform, defaultTransform } from "../transform";
import {
  clearImageBlob,
  clearSessionMeta,
  loadImageBlob,
  loadSessionMeta,
  saveImageBlob,
  saveSessionMeta,
} from "./persist";

const UNDO_LIMIT = 50;

export interface Snapshot {
  step: Step;
  doc: DocState;
  imageW: number;
  imageH: number;
  hasImage: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** Bumped whenever the base image bitmap changes, so views re-upload the texture. */
  imageVersion: number;
  restoring: boolean;
}

function defaultDoc(): DocState {
  return {
    transform: defaultTransform(),
    adjust: { ...DEFAULT_ADJUST },
    text: { category: DEFAULT_CATEGORY, title1: DEFAULT_TITLE_1, title2: DEFAULT_TITLE_2 },
  };
}

class Store {
  private snap: Snapshot = {
    step: "source",
    doc: defaultDoc(),
    imageW: 0,
    imageH: 0,
    hasImage: false,
    canUndo: false,
    canRedo: false,
    imageVersion: 0,
    restoring: true,
  };
  /** The decoded base image, kept outside React state (not serializable). */
  baseImage: ImageBitmap | HTMLImageElement | null = null;
  private history: DocState[] = [];
  private future: DocState[] = [];
  private listeners = new Set<() => void>();
  private saveTimer: number | undefined;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): Snapshot => this.snap;

  private emit(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const fn of this.listeners) fn();
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      if (this.snap.hasImage) {
        saveSessionMeta({ doc: this.snap.doc, imageW: this.snap.imageW, imageH: this.snap.imageH });
      }
    }, 300);
  }

  /** Snapshot the current doc before a discrete user action (drag, slider gesture, typing burst). */
  beginAction(): void {
    const last = this.history[this.history.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(this.snap.doc)) return;
    this.history.push(structuredClone(this.snap.doc));
    if (this.history.length > UNDO_LIMIT) this.history.shift();
    this.future = [];
    this.emit({ canUndo: true, canRedo: false });
  }

  undo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.future.push(structuredClone(this.snap.doc));
    this.emit({ doc: prev, canUndo: this.history.length > 0, canRedo: true });
    this.scheduleSave();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(structuredClone(this.snap.doc));
    this.emit({ doc: next, canUndo: true, canRedo: this.future.length > 0 });
    this.scheduleSave();
  }

  setStep(step: Step): void {
    this.emit({ step });
  }

  setTransform(transform: TransformState): void {
    this.emit({ doc: { ...this.snap.doc, transform } });
    this.scheduleSave();
  }

  setAdjust(adjust: AdjustState): void {
    this.emit({ doc: { ...this.snap.doc, adjust } });
    this.scheduleSave();
  }

  setText(text: TextState): void {
    this.emit({ doc: { ...this.snap.doc, text } });
    this.scheduleSave();
  }

  resetAdjust(): void {
    this.beginAction();
    this.setAdjust({ ...DEFAULT_ADJUST });
  }

  /**
   * Install a new base image (from upload or reel frame). Resets transform to
   * the Figma default and persists the blob so a refresh restores the session.
   */
  async setBaseImage(blob: Blob, opts?: { keepDoc?: boolean }): Promise<void> {
    const bitmap = await createImageBitmap(blob);
    this.baseImage = bitmap;
    const doc = opts?.keepDoc
      ? {
          ...this.snap.doc,
          transform: clampTransform(this.snap.doc.transform, bitmap.width, bitmap.height),
        }
      : defaultDoc();
    if (!opts?.keepDoc) {
      this.history = [];
      this.future = [];
    }
    this.emit({
      doc,
      imageW: bitmap.width,
      imageH: bitmap.height,
      hasImage: true,
      imageVersion: this.snap.imageVersion + 1,
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
      step: "editor",
    });
    saveSessionMeta({ doc, imageW: bitmap.width, imageH: bitmap.height });
    void saveImageBlob(blob);
  }

  /** Restore the previous session (image blob + doc state), if any. */
  async restore(): Promise<void> {
    try {
      const meta = loadSessionMeta();
      const blob = meta ? await loadImageBlob() : null;
      if (meta && blob) {
        const bitmap = await createImageBitmap(blob);
        this.baseImage = bitmap;
        this.emit({
          doc: meta.doc,
          imageW: bitmap.width,
          imageH: bitmap.height,
          hasImage: true,
          imageVersion: this.snap.imageVersion + 1,
          step: "editor",
          restoring: false,
        });
        return;
      }
    } catch {
      // Fall through to a fresh session.
    }
    this.emit({ restoring: false });
  }

  /** Start over: drop the image, doc, history, and persisted session. */
  reset(): void {
    this.baseImage = null;
    this.history = [];
    this.future = [];
    this.emit({
      step: "source",
      doc: defaultDoc(),
      imageW: 0,
      imageH: 0,
      hasImage: false,
      canUndo: false,
      canRedo: false,
      imageVersion: this.snap.imageVersion + 1,
    });
    clearSessionMeta();
    void clearImageBlob();
  }
}

export const store = new Store();

export function useStore(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
