// Type-only fixture (`figure-renderer-contract`'s "`FigureRenderer` Is Lifecycle-Shaped and
// Excludes Interaction", widened to eleven members). Never executed by Vitest; its only purpose
// is to be type-checked by `tsc --noEmit`.
import type {
  DecimationSelection,
  SpectrumDataPayload,
  TraceCollection,
  ViewportTransform,
} from "@trace-kit/core";
import type { FigureRenderer, FigureRendererKind } from "../../src/figure-renderer.js";

// @ts-expect-error — missing `setDecimation` names it as the absent member.
class MissingSetDecimation implements FigureRenderer {
  readonly kind: FigureRendererKind = "canvas2d";
  readonly disposed: boolean = false;
  readonly transform = {} as ViewportTransform;
  setData(payload: SpectrumDataPayload): void {
    void payload;
  }
  setTraces(collection: TraceCollection): void {
    void collection;
  }
  setDomain(xMin: number, xMax: number, yMin: number, yMax: number): void {
    void xMin;
    void xMax;
    void yMin;
    void yMax;
  }
  resize(width: number, height: number, dpr: number): void {
    void width;
    void height;
    void dpr;
  }
  render(): void {}
  clear(): void {}
  dispose(): void {}
}
void MissingSetDecimation;

declare function acceptsSelection(value: DecimationSelection | undefined): void;
void acceptsSelection;
