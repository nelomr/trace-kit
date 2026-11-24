/** @vitest-environment node */
import {
  commitPayloadRevision,
  createSpectrumDataPayload,
  type SpectrumDataPayload,
  type TraceCollection,
} from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HYSTERESIS_CONFIG,
  classifyHysteresisBand,
  computePayloadSampleCount,
  computeTracesSampleCount,
  evaluateHysteresisTarget,
  resolveHysteresisConfig,
} from "../../src/controller/hysteresis.js";

function makePayload(sampleCount: number): SpectrumDataPayload {
  const capacity = Math.max(1, sampleCount);
  const payload = createSpectrumDataPayload({
    capacity,
    xOrigin: 0,
    xUnit: "nm",
    yUnit: "dBm",
  });
  if (sampleCount > 0) {
    commitPayloadRevision(payload, sampleCount);
  }
  return payload;
}

function makeTraces(counts: readonly number[]): TraceCollection {
  return {
    entries: counts.map((count, index) => ({
      id: `trace-${index}`,
      payload: makePayload(count),
      yAxisId: "y",
      style: {},
    })),
    xDomainMin: 0,
    xDomainMax: 1,
    revision: 1,
  };
}

describe("DEFAULT_HYSTERESIS_CONFIG and resolveHysteresisConfig", () => {
  it("exposes frozen default thresholds of 80_000 up and 64_000 down", () => {
    expect(DEFAULT_HYSTERESIS_CONFIG).toEqual({
      upThreshold: 80_000,
      downThreshold: 64_000,
    });
    expect(Object.isFrozen(DEFAULT_HYSTERESIS_CONFIG)).toBe(true);
  });

  it("resolves defaults, partial overrides, and full valid overrides into frozen configs", () => {
    const def = resolveHysteresisConfig();
    expect(def).toEqual({ upThreshold: 80_000, downThreshold: 64_000 });
    expect(Object.isFrozen(def)).toBe(true);

    expect(resolveHysteresisConfig({})).toEqual({
      upThreshold: 80_000,
      downThreshold: 64_000,
    });
    expect(resolveHysteresisConfig({ upThreshold: 100_000 })).toEqual({
      upThreshold: 100_000,
      downThreshold: 64_000,
    });
    expect(resolveHysteresisConfig({ downThreshold: 50_000 })).toEqual({
      upThreshold: 80_000,
      downThreshold: 50_000,
    });
    expect(resolveHysteresisConfig({ upThreshold: 10, downThreshold: 9 })).toEqual({
      upThreshold: 10,
      downThreshold: 9,
    });
  });

  it("throws RangeError synchronously for invalid, equal, inverted, zero, negative, non-integer, or non-finite thresholds", () => {
    const invalidConfigs = [
      { upThreshold: 80_000, downThreshold: 80_000 },
      { upThreshold: 60_000, downThreshold: 80_000 },
      { upThreshold: 0, downThreshold: 0 },
      { upThreshold: 100, downThreshold: 0 },
      { upThreshold: -10, downThreshold: -20 },
      { upThreshold: 80_000, downThreshold: -1 },
      { upThreshold: 80_000.5, downThreshold: 64_000 },
      { upThreshold: 80_000, downThreshold: 64_000.25 },
      { upThreshold: Number.NaN, downThreshold: 64_000 },
      { upThreshold: 80_000, downThreshold: Number.NaN },
      { upThreshold: Number.POSITIVE_INFINITY, downThreshold: 64_000 },
      { upThreshold: 80_000, downThreshold: Number.NEGATIVE_INFINITY },
    ];

    for (const config of invalidConfigs) {
      expect(() => resolveHysteresisConfig(config)).toThrow(RangeError);
    }
  });
});

describe("classifyHysteresisBand", () => {
  it("partitions sample counts into three strictly disjoint bands", () => {
    const config = DEFAULT_HYSTERESIS_CONFIG;

    expect(classifyHysteresisBand(0, config)).toBe("below-down");
    expect(classifyHysteresisBand(10_000, config)).toBe("below-down");
    expect(classifyHysteresisBand(64_000, config)).toBe("below-down");

    expect(classifyHysteresisBand(64_001, config)).toBe("deadband");
    expect(classifyHysteresisBand(72_000, config)).toBe("deadband");
    expect(classifyHysteresisBand(79_999, config)).toBe("deadband");

    expect(classifyHysteresisBand(80_000, config)).toBe("above-up");
    expect(classifyHysteresisBand(80_001, config)).toBe("above-up");
    expect(classifyHysteresisBand(250_000, config)).toBe("above-up");
  });
});

describe("computePayloadSampleCount and computeTracesSampleCount", () => {
  it("computes payload sample counts and clamps negative values to 0", () => {
    expect(computePayloadSampleCount(null)).toBe(0);
    expect(computePayloadSampleCount(makePayload(0))).toBe(0);
    expect(computePayloadSampleCount(makePayload(12_345))).toBe(12_345);

    const base = makePayload(10);
    const negativeStub: SpectrumDataPayload = {
      ...base,
      sampleCount: -50,
    };
    expect(computePayloadSampleCount(negativeStub)).toBe(0);
  });

  it("sums sample counts across multi-trace collections and handles null or empty collections", () => {
    expect(computeTracesSampleCount(null)).toBe(0);
    expect(computeTracesSampleCount(makeTraces([]))).toBe(0);
    expect(computeTracesSampleCount(makeTraces([25_000, 25_000, 25_000, 25_000]))).toBe(100_000);
    expect(computeTracesSampleCount(makeTraces([0, 12_000, 52_000]))).toBe(64_000);

    const negativePayload: SpectrumDataPayload = {
      ...makePayload(10),
      sampleCount: -15,
    };
    const collectionWithNegative: TraceCollection = {
      entries: [
        { id: "a", payload: negativePayload, yAxisId: "y", style: {} },
        { id: "b", payload: makePayload(500), yAxisId: "y", style: {} },
      ],
      xDomainMin: 0,
      xDomainMax: 1,
      revision: 1,
    };
    expect(computeTracesSampleCount(collectionWithNegative)).toBe(500);
  });
});

describe("evaluateHysteresisTarget", () => {
  const config = DEFAULT_HYSTERESIS_CONFIG;

  it("keeps canvas2d below upThreshold and upgrades to webgl2 at upThreshold in auto mode", () => {
    expect(
      evaluateHysteresisTarget({
        mode: "auto",
        activeKind: "canvas2d",
        sampleCount: 0,
        config,
        gestureActive: false,
        webgl2Fallback: false,
      }),
    ).toEqual({
      targetKind: "canvas2d",
      desiredKind: "canvas2d",
      pendingKind: null,
      shouldSwitch: false,
      band: "below-down",
    });

    expect(
      evaluateHysteresisTarget({
        mode: "auto",
        activeKind: "canvas2d",
        sampleCount: 79_999,
        config,
        gestureActive: false,
        webgl2Fallback: false,
      }),
    ).toEqual({
      targetKind: "canvas2d",
      desiredKind: "canvas2d",
      pendingKind: null,
      shouldSwitch: false,
      band: "deadband",
    });

    expect(
      evaluateHysteresisTarget({
        mode: "auto",
        activeKind: "canvas2d",
        sampleCount: 80_000,
        config,
        gestureActive: false,
        webgl2Fallback: false,
      }),
    ).toEqual({
      targetKind: "webgl2",
      desiredKind: "webgl2",
      pendingKind: null,
      shouldSwitch: true,
      band: "above-up",
    });
  });

  it("retains webgl2 inside deadband and downgrades to canvas2d at downThreshold", () => {
    for (const sampleCount of [79_999, 72_000, 64_001]) {
      expect(
        evaluateHysteresisTarget({
          mode: "auto",
          activeKind: "webgl2",
          sampleCount,
          config,
          gestureActive: false,
          webgl2Fallback: false,
        }),
      ).toEqual({
        targetKind: "webgl2",
        desiredKind: "webgl2",
        pendingKind: null,
        shouldSwitch: false,
        band: "deadband",
      });
    }

    expect(
      evaluateHysteresisTarget({
        mode: "auto",
        activeKind: "webgl2",
        sampleCount: 64_000,
        config,
        gestureActive: false,
        webgl2Fallback: false,
      }),
    ).toEqual({
      targetKind: "canvas2d",
      desiredKind: "canvas2d",
      pendingKind: null,
      shouldSwitch: true,
      band: "below-down",
    });
  });

  it("causes zero switches across a 20-step oscillation inside [64_001, 79_999]", () => {
    for (const initialKind of ["canvas2d", "webgl2"] as const) {
      let activeKind: "canvas2d" | "webgl2" = initialKind;
      let switches = 0;
      for (let step = 0; step < 20; step += 1) {
        const sampleCount = step % 2 === 0 ? 64_001 : 79_999;
        const result = evaluateHysteresisTarget({
          mode: "auto",
          activeKind,
          sampleCount,
          config,
          gestureActive: false,
          webgl2Fallback: false,
        });
        expect(result.band).toBe("deadband");
        expect(result.shouldSwitch).toBe(false);
        expect(result.targetKind).toBe(initialKind);
        if (result.shouldSwitch) {
          switches += 1;
          activeKind = result.targetKind;
        }
      }
      expect(switches).toBe(0);
    }
  });

  it("honors pinned canvas2d and webgl2 modes regardless of sample count", () => {
    expect(
      evaluateHysteresisTarget({
        mode: "canvas2d",
        activeKind: "webgl2",
        sampleCount: 200_000,
        config,
        gestureActive: false,
        webgl2Fallback: false,
      }),
    ).toEqual({
      targetKind: "canvas2d",
      desiredKind: "canvas2d",
      pendingKind: null,
      shouldSwitch: true,
      band: "above-up",
    });

    expect(
      evaluateHysteresisTarget({
        mode: "webgl2",
        activeKind: "canvas2d",
        sampleCount: 1_000,
        config,
        gestureActive: false,
        webgl2Fallback: false,
      }),
    ).toEqual({
      targetKind: "webgl2",
      desiredKind: "webgl2",
      pendingKind: null,
      shouldSwitch: true,
      band: "below-down",
    });
  });

  it("forces canvas2d when webgl2Fallback is true in both auto and webgl2 modes", () => {
    expect(
      evaluateHysteresisTarget({
        mode: "auto",
        activeKind: "canvas2d",
        sampleCount: 150_000,
        config,
        gestureActive: false,
        webgl2Fallback: true,
      }),
    ).toEqual({
      targetKind: "canvas2d",
      desiredKind: "canvas2d",
      pendingKind: null,
      shouldSwitch: false,
      band: "above-up",
    });

    expect(
      evaluateHysteresisTarget({
        mode: "webgl2",
        activeKind: "webgl2",
        sampleCount: 150_000,
        config,
        gestureActive: false,
        webgl2Fallback: true,
      }),
    ).toEqual({
      targetKind: "canvas2d",
      desiredKind: "canvas2d",
      pendingKind: null,
      shouldSwitch: true,
      band: "above-up",
    });
  });

  it("defers eligible switches into pendingKind while gestureActive is true across all modes", () => {
    expect(
      evaluateHysteresisTarget({
        mode: "auto",
        activeKind: "canvas2d",
        sampleCount: 100_000,
        config,
        gestureActive: true,
        webgl2Fallback: false,
      }),
    ).toEqual({
      targetKind: "canvas2d",
      desiredKind: "webgl2",
      pendingKind: "webgl2",
      shouldSwitch: false,
      band: "above-up",
    });

    expect(
      evaluateHysteresisTarget({
        mode: "auto",
        activeKind: "webgl2",
        sampleCount: 10_000,
        config,
        gestureActive: true,
        webgl2Fallback: false,
      }),
    ).toEqual({
      targetKind: "webgl2",
      desiredKind: "canvas2d",
      pendingKind: "canvas2d",
      shouldSwitch: false,
      band: "below-down",
    });

    expect(
      evaluateHysteresisTarget({
        mode: "webgl2",
        activeKind: "canvas2d",
        sampleCount: 1_000,
        config,
        gestureActive: true,
        webgl2Fallback: false,
      }),
    ).toEqual({
      targetKind: "canvas2d",
      desiredKind: "webgl2",
      pendingKind: "webgl2",
      shouldSwitch: false,
      band: "below-down",
    });

    expect(
      evaluateHysteresisTarget({
        mode: "canvas2d",
        activeKind: "webgl2",
        sampleCount: 100_000,
        config,
        gestureActive: true,
        webgl2Fallback: false,
      }),
    ).toEqual({
      targetKind: "webgl2",
      desiredKind: "canvas2d",
      pendingKind: "canvas2d",
      shouldSwitch: false,
      band: "above-up",
    });

    // When desiredKind === activeKind during a gesture, pendingKind is null.
    expect(
      evaluateHysteresisTarget({
        mode: "auto",
        activeKind: "canvas2d",
        sampleCount: 50_000,
        config,
        gestureActive: true,
        webgl2Fallback: false,
      }),
    ).toEqual({
      targetKind: "canvas2d",
      desiredKind: "canvas2d",
      pendingKind: null,
      shouldSwitch: false,
      band: "below-down",
    });
  });
});
