import {
  AXIS_SIDE_LEFT,
  commitPayloadRevision,
  createSpectrumDataPayload,
  createTraceCollection,
  Y_SCALE_KIND_LINEAR,
  Y_SCALE_KIND_LOG,
  type SpectrumDataPayload,
  type YAxisRegistration,
} from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { SCENARIO_FIXTURES } from "@trace-kit/renderers/fixtures";
import { ensureDefaultFont } from "@trace-kit/renderers/font";
import { Canvas2DRenderer } from "../../src/canvas2d/canvas2d-renderer.js";

const STANDARD_VIEWPORT = { width: 800, height: 400 };

/** xorshift32, matching the scenario fixtures' own deterministic generator — a byte-stable
 * golden image requires a byte-stable payload across every process and platform. */
function nextUint32(state: number): number {
  let x = state;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

/** A monotonically rising, multi-decade payload (spanning ~3 decades) with a small amount of
 * deterministic noise — exercises decade thinning and mantissa minors on a log Y axis, which a
 * flat or single-decade fixture would not. */
function buildLogSweepPayload(sampleCount: number, seed: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin: 0,
    xUnit: "index",
    yUnit: "a.u.",
  });
  let prngState = seed >>> 0;
  for (let i = 0; i < sampleCount; i += 1) {
    prngState = nextUint32(prngState);
    const noise = 1 + ((prngState / 0xffffffff) * 2 - 1) * 0.05;
    payload.x[i] = i;
    payload.y[i] = 1 * 10 ** ((i / (sampleCount - 1)) * 3) * noise;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

const logSweepPayload = buildLogSweepPayload(512, 41);
const dualAxisPayload = buildLogSweepPayload(512, 43);

/** The overlay scenario's linear-axis trace: a bounded oscillation, sampled from `xOrigin: 0` —
 * proves two traces sharing one X domain but sampled from different absolute origins still land
 * correctly against their own transform (D7's per-trace `xOrigin`). */
function buildOverlayLinearPayload(sampleCount: number, seed: number, xOrigin: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin,
    xUnit: "index",
    yUnit: "a.u.",
  });
  let prngState = seed >>> 0;
  for (let i = 0; i < sampleCount; i += 1) {
    prngState = nextUint32(prngState);
    const noise = ((prngState / 0xffffffff) * 2 - 1) * 0.05;
    payload.x[i] = i;
    payload.y[i] = Math.sin(i * 0.05) * 5 + noise;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

/** The overlay scenario's log-axis trace: strictly positive (a log Y domain has no meaning for
 * a non-positive value), sampled from a distinct `xOrigin`. */
function buildOverlayLogPayload(sampleCount: number, seed: number, xOrigin: number): SpectrumDataPayload {
  const payload = createSpectrumDataPayload({
    capacity: sampleCount,
    xOrigin,
    xUnit: "index",
    yUnit: "a.u.",
  });
  let prngState = seed >>> 0;
  for (let i = 0; i < sampleCount; i += 1) {
    prngState = nextUint32(prngState);
    const noise = 1 + ((prngState / 0xffffffff) * 2 - 1) * 0.05;
    payload.x[i] = i;
    payload.y[i] = 1 * 10 ** ((i / (sampleCount - 1)) * 2) * noise;
  }
  commitPayloadRevision(payload, sampleCount);
  return payload;
}

const overlayLinearPayload = buildOverlayLinearPayload(300, 17, 0);
const overlayLogPayload = buildOverlayLogPayload(300, 19, 1000);

// Goldens are generated and compared exclusively in CI on `ubuntu-latest` (P5) — Chromium's
// font/AA rasterisation is not guaranteed byte-identical across host operating systems, and a
// developer machine running this locally would either produce a spurious mismatch against a
// Linux-generated reference or (on first run) silently create a macOS/Windows reference nobody
// else's CI run would ever match. `__TRACEKIT_VISUAL_IS_LINUX_CI__` is a Vite `define`
// replacement baked in at config-evaluation time (see `vitest.config.ts` and
// `test/visual/globals.d.ts`), since `process.platform` does not exist inside the browser this
// test file actually executes in.
//
// `it.skipIf` rather than an imperative `ctx.skip()` inside the test body: the latter is not
// guaranteed to abort execution before the following statements run in every Vitest browser
// mode version, and was observed here to let `toMatchScreenshot` execute anyway once a
// reference file already existed on disk from a prior run. `skipIf` decides at collection
// time, before the test body ever starts, which has no such race.
const runsWhereGoldensAreValid = __TRACEKIT_VISUAL_IS_LINUX_CI__;

describe("Canvas2D visual regression", () => {
  for (const fixture of SCENARIO_FIXTURES) {
    it.skipIf(!runsWhereGoldensAreValid)(
      `renders ${fixture.id} (${fixture.description}) matching the committed golden — visual goldens are Linux-CI-only`,
      async () => {
        const canvas = document.createElement("canvas");
        canvas.style.width = `${fixture.viewport.width}px`;
        canvas.style.height = `${fixture.viewport.height}px`;
        document.body.appendChild(canvas);

        try {
          const fontReady = await ensureDefaultFont();
          expect(fontReady).toBe(true);
          expect(document.fonts.check('10px "TraceKit Inter"')).toBe(true);

          const renderer = new Canvas2DRenderer({ surface: canvas });
          try {
            renderer.setData(fixture.payload);
            renderer.setDomain(
              fixture.domain.xMin,
              fixture.domain.xMax,
              fixture.domain.yMin,
              fixture.domain.yMax,
            );
            renderer.resize(fixture.viewport.width, fixture.viewport.height, fixture.dpr);
            renderer.render();

            await expect(page.elementLocator(canvas)).toMatchScreenshot(fixture.id);
          } finally {
            renderer.dispose();
          }
        } finally {
          canvas.remove();
        }
      },
    );
  }

  it.skipIf(!runsWhereGoldensAreValid)(
    "renders log-axis (single logarithmic Y axis, decade gridlines and labels) matching the committed golden — visual goldens are Linux-CI-only",
    async () => {
      const canvas = document.createElement("canvas");
      canvas.style.width = `${STANDARD_VIEWPORT.width}px`;
      canvas.style.height = `${STANDARD_VIEWPORT.height}px`;
      document.body.appendChild(canvas);

      try {
        const fontReady = await ensureDefaultFont();
        expect(fontReady).toBe(true);
        expect(document.fonts.check('10px "TraceKit Inter"')).toBe(true);

        const logAxis: YAxisRegistration = {
          id: "log",
          scaleKind: Y_SCALE_KIND_LOG,
          domainMin: 1,
          domainMax: 1000,
          side: AXIS_SIDE_LEFT,
        };
        const renderer = new Canvas2DRenderer({ surface: canvas, yAxes: [logAxis] });
        try {
          renderer.setData(logSweepPayload);
          renderer.setDomain(0, 511, 1, 1000);
          renderer.resize(STANDARD_VIEWPORT.width, STANDARD_VIEWPORT.height, 2);
          renderer.render();

          await expect(page.elementLocator(canvas)).toMatchScreenshot("log-axis");
        } finally {
          renderer.dispose();
        }
      } finally {
        canvas.remove();
      }
    },
  );

  it.skipIf(!runsWhereGoldensAreValid)(
    "renders dual-axis (two independent left-stacked Y axes, one linear and one log) matching the committed golden — visual goldens are Linux-CI-only",
    async () => {
      const canvas = document.createElement("canvas");
      canvas.style.width = `${STANDARD_VIEWPORT.width}px`;
      canvas.style.height = `${STANDARD_VIEWPORT.height}px`;
      document.body.appendChild(canvas);

      try {
        const fontReady = await ensureDefaultFont();
        expect(fontReady).toBe(true);
        expect(document.fonts.check('10px "TraceKit Inter"')).toBe(true);

        const axes: YAxisRegistration[] = [
          { id: "log", scaleKind: Y_SCALE_KIND_LOG, domainMin: 1, domainMax: 1000, side: AXIS_SIDE_LEFT },
          { id: "linear", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: -1, domainMax: 1, side: AXIS_SIDE_LEFT },
        ];
        const renderer = new Canvas2DRenderer({ surface: canvas, yAxes: axes });
        try {
          renderer.setData(dualAxisPayload);
          renderer.setDomain(0, 511, 1, 1000);
          renderer.resize(STANDARD_VIEWPORT.width, STANDARD_VIEWPORT.height, 2);
          renderer.render();

          await expect(page.elementLocator(canvas)).toMatchScreenshot("dual-axis");
        } finally {
          renderer.dispose();
        }
      } finally {
        canvas.remove();
      }
    },
  );

  it.skipIf(!runsWhereGoldensAreValid)(
    "renders overlay-two-axis (two traces, two Y axes — linear and log, distinct colors, one dashed) matching the committed golden — visual goldens are Linux-CI-only",
    async () => {
      const canvas = document.createElement("canvas");
      canvas.style.width = `${STANDARD_VIEWPORT.width}px`;
      canvas.style.height = `${STANDARD_VIEWPORT.height}px`;
      document.body.appendChild(canvas);

      try {
        const fontReady = await ensureDefaultFont();
        expect(fontReady).toBe(true);
        expect(document.fonts.check('10px "TraceKit Inter"')).toBe(true);

        const axes: YAxisRegistration[] = [
          { id: "linear", scaleKind: Y_SCALE_KIND_LINEAR, domainMin: -10, domainMax: 10, side: AXIS_SIDE_LEFT },
          { id: "log", scaleKind: Y_SCALE_KIND_LOG, domainMin: 1, domainMax: 200, side: AXIS_SIDE_LEFT },
        ];
        const renderer = new Canvas2DRenderer({ surface: canvas, yAxes: axes });
        try {
          const collection = createTraceCollection(
            [
              {
                id: "linear-trace",
                payload: overlayLinearPayload,
                yAxisId: "linear",
                style: { color: "#3fb6ff" },
              },
              {
                id: "log-trace",
                payload: overlayLogPayload,
                yAxisId: "log",
                style: { color: "#ff7a45", dash: [6, 4] },
              },
            ],
            axes,
            0,
            299,
          );
          renderer.setTraces(collection);
          renderer.resize(STANDARD_VIEWPORT.width, STANDARD_VIEWPORT.height, 2);
          renderer.render();

          await expect(page.elementLocator(canvas)).toMatchScreenshot("overlay-two-axis");
        } finally {
          renderer.dispose();
        }
      } finally {
        canvas.remove();
      }
    },
  );
});
