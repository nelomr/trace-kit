/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SCENARIO_FIXTURES, type ScenarioFixture } from "@trace-kit/renderers/fixtures";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import { scaleFontSize } from "../../src/layout/figure-layout.js";
import { DEFAULT_FIGURE_STYLE } from "../../src/style.js";
import { applyFixture } from "../visual/support/figure-stack.js";
import {
  labelInkBoxes,
  labelMaskInputOf,
  type MeasureText,
  type TextBounds,
} from "../visual/support/label-mask.js";
import { LABEL_MASK_PAD_PX } from "../visual/support/webgl2-tolerances.js";
import {
  installRecordingPath2D,
  RecordingContext,
  recordingSurface,
} from "./support/recording-context.js";

let restore: () => void;
beforeEach(() => {
  restore = installRecordingPath2D();
});
afterEach(() => {
  restore();
});

/** A `RecordingContext` that also keeps the alignment and font in effect at every `fillText`. */
class TextRecordingContext extends RecordingContext {
  readonly textState: { align: string; baseline: string; font: string }[] = [];

  override fillText(text: string, x: number, y: number): void {
    this.textState.push({ align: this.textAlign, baseline: this.textBaseline, font: this.font });
    super.fillText(text, x, y);
  }
}

/**
 * Bounds that depend on the text and on the alignment, so a helper that measures with the wrong
 * alignment, or anchors a box at the wrong point, cannot produce the expected box by accident.
 */
function stubBounds(text: string, align: string, baseline: string): TextBounds {
  const width = 6 * text.length;
  const horizontal =
    align === "center" ? [width / 2, width / 2] : align === "right" ? [width, 0] : [0, width];
  const vertical =
    baseline === "top" ? [0, 10] : baseline === "middle" ? [5, 5] : [10, 0];
  return {
    actualBoundingBoxLeft: horizontal[0] ?? 0,
    actualBoundingBoxRight: horizontal[1] ?? 0,
    actualBoundingBoxAscent: vertical[0] ?? 0,
    actualBoundingBoxDescent: vertical[1] ?? 0,
  };
}

function renderRecorded(fixture: ScenarioFixture): TextRecordingContext {
  const context = new TextRecordingContext();
  const surface = recordingSurface(context);
  const renderer = new Canvas2DRenderer(
    fixture.yAxes === undefined ? { surface } : { surface, yAxes: fixture.yAxes },
  );
  applyFixture(renderer, fixture);
  renderer.render();
  return context;
}

describe("label ink boxes follow the labels the painters draw", () => {
  for (const fixture of SCENARIO_FIXTURES) {
    it(`${fixture.id}: one box per fillText, same order, anchored where the painter anchors it`, () => {
      const context = renderRecorded(fixture);
      const drawn = context.calls.filter((call) => call.name === "fillText");
      expect(drawn.length).toBeGreaterThan(0);

      const measured: { text: string; font: string; align: string; baseline: string }[] = [];
      const measure: MeasureText = (text, font, align, baseline) => {
        measured.push({ text, font, align, baseline });
        return stubBounds(text, align, baseline);
      };
      const boxes = labelInkBoxes(labelMaskInputOf(fixture), measure);

      expect(boxes).toHaveLength(drawn.length);
      expect(measured).toHaveLength(drawn.length);
      const font = scaleFontSize(DEFAULT_FIGURE_STYLE.font, fixture.dpr);
      drawn.forEach((call, i) => {
        const [text, x, y] = call.args as [string, number, number];
        const state = context.textState[i];
        const box = boxes[i];
        expect(box, `box ${i}`).toBeDefined();
        if (state === undefined || box === undefined) return;

        // The anchor is the painter's, exactly.
        expect([box.text, box.x, box.y]).toEqual([text, x, y]);
        // The text was measured with the painter's font and alignment.
        expect(measured[i]).toEqual({ text, font, align: state.align, baseline: state.baseline });
        expect(state.font).toBe(font);

        const bounds = stubBounds(text, state.align, state.baseline);
        const left = Math.floor(x - bounds.actualBoundingBoxLeft - LABEL_MASK_PAD_PX);
        const top = Math.floor(y - bounds.actualBoundingBoxAscent - LABEL_MASK_PAD_PX);
        const right = Math.ceil(x + bounds.actualBoundingBoxRight + LABEL_MASK_PAD_PX);
        const bottom = Math.ceil(y + bounds.actualBoundingBoxDescent + LABEL_MASK_PAD_PX);
        expect({ left: box.left, top: box.top, width: box.width, height: box.height }).toEqual({
          left,
          top,
          width: right - left,
          height: bottom - top,
        });
      });
    });
  }

  it("uses center/top for bottom labels and right/middle for left labels", () => {
    const fixture = SCENARIO_FIXTURES.find((f) => f.id === "dual-axis");
    if (fixture === undefined) throw new Error("fixture dual-axis missing");
    const context = renderRecorded(fixture);
    const alignments = new Set(context.textState.map((s) => `${s.align}/${s.baseline}`));
    expect([...alignments].sort()).toEqual(["center/top", "right/middle"]);
  });

  it("pads by LABEL_MASK_PAD_PX = 2 and rounds outward", () => {
    expect(LABEL_MASK_PAD_PX).toBe(2);
  });
});
