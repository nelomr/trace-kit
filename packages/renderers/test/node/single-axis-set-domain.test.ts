/** @vitest-environment node */
import {
  AXIS_SIDE_LEFT,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  commitPayloadRevision,
  createSpectrumDataPayload,
  createTraceCollection,
  type YAxisRegistration,
} from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";
import type { FigureRenderer } from "../../src/figure-renderer.js";
import {
  RecordingContext,
  installRecordingPath2D,
  recordingSurface,
} from "./support/recording-context.js";
import { createHarness } from "./support/webgl2-harness.js";

interface TestBackend {
  readonly name: string;
  create(yAxes: readonly YAxisRegistration[]): {
    readonly renderer: FigureRenderer;
    readonly getDrawCallCount: () => number;
    readonly clearDrawCalls: () => void;
  };
}

const BACKENDS: readonly TestBackend[] = [
  {
    name: "Canvas2DRenderer",
    create(yAxes) {
      const ctx = new RecordingContext();
      const renderer = new Canvas2DRenderer({
        surface: recordingSurface(ctx),
        yAxes,
      });
      return {
        renderer,
        getDrawCallCount: () => ctx.calls.length,
        clearDrawCalls: () => {
          ctx.calls.length = 0;
        },
      };
    },
  },
  {
    name: "WebGL2FigureRenderer",
    create(yAxes) {
      const harness = createHarness({
        rendererOptions: { yAxes },
      });
      return {
        renderer: harness.renderer,
        getDrawCallCount: () => harness.log.length,
        clearDrawCalls: () => {
          harness.log.length = 0;
        },
      };
    },
  },
];

describe("Option 2A — single-axis explicit yAxes setDomain parity", () => {
  for (const backend of BACKENDS) {
    describe(backend.name, () => {
      it("updates transform for a single explicit log-Y axis on setDomain with zero drawing calls", () => {
        const yAxes: readonly YAxisRegistration[] = [
          {
            id: "power",
            scaleKind: Y_SCALE_KIND_LOG,
            domainMin: 1e-3,
            domainMax: 1e3,
            side: AXIS_SIDE_LEFT,
          },
        ];
        const { renderer, getDrawCallCount, clearDrawCalls } = backend.create(yAxes);
        renderer.resize(800, 400, 1);
        clearDrawCalls();

        renderer.setDomain(1550, 1551, 1e-1, 1e2);

        const t = renderer.transform;
        expect(t.xDomainMin).toBe(1550);
        expect(t.xDomainMax).toBe(1551);
        expect(t.yDomainMin).toBe(1e-1);
        expect(t.yDomainMax).toBe(1e2);
        expect(t.yScaleKind).toBe(Y_SCALE_KIND_LOG);
        expect(t.yLogDomainMin).toBeCloseTo(-1, 12);
        expect(getDrawCallCount()).toBe(0);

        // Verify registered id ("power") is preserved when binding a TraceCollection.
        const payload = createSpectrumDataPayload({
          capacity: 4,
          xOrigin: 1550,
          xUnit: "nm",
          yUnit: "mW",
        });
        payload.x.set([0, 0.25, 0.75, 1]);
        payload.y.set([1e-1, 1, 10, 1e2]);
        commitPayloadRevision(payload, 4);
        const collection = createTraceCollection(
          [{ id: "trace-power", payload, yAxisId: "power", style: {} }],
          yAxes,
          1550,
          1551,
        );
        expect(() => renderer.setTraces(collection)).not.toThrow();
        renderer.setDomain(1550.2, 1550.8, 1, 1e2);
        expect(renderer.transform.yDomainMin).toBe(1);
        expect(renderer.transform.yDomainMax).toBe(1e2);
        expect(renderer.transform.yScaleKind).toBe(Y_SCALE_KIND_LOG);
      });

      it("preserves construction-time bounds for a single explicit log-Y axis across resize before setDomain", () => {
        const yAxes: readonly YAxisRegistration[] = [
          {
            id: "power",
            scaleKind: Y_SCALE_KIND_LOG,
            domainMin: 1e-2,
            domainMax: 1e4,
            side: AXIS_SIDE_LEFT,
          },
        ];
        const { renderer } = backend.create(yAxes);

        renderer.resize(800, 400, 1);

        expect(renderer.transform.yDomainMin).toBe(1e-2);
        expect(renderer.transform.yDomainMax).toBe(1e4);
        expect(renderer.transform.yScaleKind).toBe(Y_SCALE_KIND_LOG);
      });

      it("throws RangeError on non-positive yMin for a single log-Y axis with strong exception safety", () => {
        const yAxes: readonly YAxisRegistration[] = [
          {
            id: "power",
            scaleKind: Y_SCALE_KIND_LOG,
            domainMin: 1,
            domainMax: 1000,
            side: AXIS_SIDE_LEFT,
          },
        ];
        const { renderer } = backend.create(yAxes);
        renderer.resize(800, 400, 1);
        renderer.setDomain(10, 50, 2, 500);

        expect(() => renderer.setDomain(0, 100, 0, 1000)).toThrow(RangeError);
        expect(renderer.transform.xDomainMin).toBe(10);
        expect(renderer.transform.xDomainMax).toBe(50);
        expect(renderer.transform.yDomainMin).toBe(2);
        expect(renderer.transform.yDomainMax).toBe(500);

        expect(() => renderer.setDomain(0, 100, -5, 1000)).toThrow(RangeError);
        // Subsequent resize must also observe the rolled-back domain fields, not the rejected ones.
        renderer.resize(640, 320, 1);
        expect(renderer.transform.xDomainMin).toBe(10);
        expect(renderer.transform.xDomainMax).toBe(50);
        expect(renderer.transform.yDomainMin).toBe(2);
        expect(renderer.transform.yDomainMax).toBe(500);
      });

      it("keeps multi-axis explicit yAxes domains fixed across setDomain", () => {
        const yAxes: readonly YAxisRegistration[] = [
          {
            id: "log",
            scaleKind: Y_SCALE_KIND_LOG,
            domainMin: 1,
            domainMax: 1000,
            side: AXIS_SIDE_LEFT,
          },
          {
            id: "lin",
            scaleKind: Y_SCALE_KIND_LINEAR,
            domainMin: -1,
            domainMax: 1,
            side: AXIS_SIDE_LEFT,
          },
        ];
        const { renderer } = backend.create(yAxes);
        renderer.resize(800, 400, 1);

        expect(() => renderer.setDomain(0, 100, -1, 1)).not.toThrow();
        expect(renderer.transform.xDomainMin).toBe(0);
        expect(renderer.transform.xDomainMax).toBe(100);
        expect(renderer.transform.yDomainMin).toBe(1);
        expect(renderer.transform.yDomainMax).toBe(1000);
        expect(renderer.transform.yScaleKind).toBe(Y_SCALE_KIND_LOG);

        // Verify secondary linear axis stays registered and intact via setTraces.
        const p1 = createSpectrumDataPayload({ capacity: 2, xOrigin: 0, xUnit: "nm", yUnit: "mW" });
        p1.x.set([0, 100]);
        p1.y.set([1, 1000]);
        commitPayloadRevision(p1, 2);
        const p2 = createSpectrumDataPayload({ capacity: 2, xOrigin: 0, xUnit: "nm", yUnit: "V" });
        p2.x.set([0, 100]);
        p2.y.set([-1, 1]);
        commitPayloadRevision(p2, 2);
        const collection = createTraceCollection(
          [
            { id: "a", payload: p1, yAxisId: "log", style: {} },
            { id: "b", payload: p2, yAxisId: "lin", style: {} },
          ],
          yAxes,
          0,
          100,
        );
        expect(() => renderer.setTraces(collection)).not.toThrow();
        expect(() => renderer.setDomain(10, 90, -50, 50)).not.toThrow();
        expect(renderer.transform.xDomainMin).toBe(10);
        expect(renderer.transform.xDomainMax).toBe(90);
        expect(renderer.transform.yDomainMin).toBe(1);
        expect(renderer.transform.yDomainMax).toBe(1000);
      });

      it("updates a single explicit linear Y axis cleanly on setDomain", () => {
        const yAxes: readonly YAxisRegistration[] = [
          {
            id: "voltage",
            scaleKind: Y_SCALE_KIND_LINEAR,
            domainMin: -10,
            domainMax: 10,
            side: AXIS_SIDE_LEFT,
          },
        ];
        const { renderer } = backend.create(yAxes);
        renderer.resize(800, 400, 1);
        expect(renderer.transform.yDomainMin).toBe(-10);
        expect(renderer.transform.yDomainMax).toBe(10);

        renderer.setDomain(5, 25, -2.5, 7.5);
        expect(renderer.transform.xDomainMin).toBe(5);
        expect(renderer.transform.xDomainMax).toBe(25);
        expect(renderer.transform.yDomainMin).toBe(-2.5);
        expect(renderer.transform.yDomainMax).toBe(7.5);
        expect(renderer.transform.yScaleKind).toBe(Y_SCALE_KIND_LINEAR);
      });

      it("rolls back primary and per-trace transforms completely when TraceCollection recomputation throws in setDomain", () => {
        const yAxes: readonly YAxisRegistration[] = [
          {
            id: "lin",
            scaleKind: Y_SCALE_KIND_LINEAR,
            domainMin: -10,
            domainMax: 10,
            side: AXIS_SIDE_LEFT,
          },
        ];
        const { renderer } = backend.create(yAxes);
        renderer.resize(800, 400, 1);

        const p0 = createSpectrumDataPayload({ capacity: 2, xOrigin: 0, xUnit: "nm", yUnit: "V" });
        p0.x.set([0, 100]);
        p0.y.set([-1, 1]);
        commitPayloadRevision(p0, 2);

        // Large negative xOrigin so [0, 100] is valid (0 - (-1e308) = 1e308),
        // while [1e308, 1.5e308] succeeds for the figure (#xOrigin = 0) and trace 0,
        // then overflows xDomainMin - xOrigin to +Infinity on trace 1.
        const p1 = createSpectrumDataPayload({
          capacity: 2,
          xOrigin: -1e308,
          xUnit: "nm",
          yUnit: "V",
        });
        p1.x.set([0, 100]);
        p1.y.set([-1, 1]);
        commitPayloadRevision(p1, 2);

        const collection = createTraceCollection(
          [
            { id: "t0", payload: p0, yAxisId: "lin", style: {} },
            { id: "t1", payload: p1, yAxisId: "lin", style: {} },
          ],
          yAxes,
          0,
          100,
        );
        renderer.setTraces(collection);
        renderer.setDomain(10, 90, -5, 5);
        expect(renderer.transform.xDomainMin).toBe(10);
        expect(renderer.transform.xDomainMax).toBe(90);
        expect(renderer.transform.yDomainMin).toBe(-5);
        expect(renderer.transform.yDomainMax).toBe(5);

        expect(() => renderer.setDomain(1e308, 1.5e308, -2, 2)).toThrow(RangeError);

        // Primary transform must immediately reflect the rolled-back domain (without needing resize).
        expect(renderer.transform.xDomainMin).toBe(10);
        expect(renderer.transform.xDomainMax).toBe(90);
        expect(renderer.transform.yDomainMin).toBe(-5);
        expect(renderer.transform.yDomainMax).toBe(5);
        const restorePath2D = installRecordingPath2D();
        try {
          expect(() => renderer.render()).not.toThrow();
        } finally {
          restorePath2D();
        }
      });
    });
  }
});
