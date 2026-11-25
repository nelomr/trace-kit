import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOMAIN_SNAPSHOT,
  assertDataTracesExclusive,
  decimationEqual,
  domainsEqual,
  normalizeOptional,
  snapshotDomain,
} from "../../src/domain-sync.js";
import { createTestPayload, createTestTraceCollection } from "./test-helpers.js";

describe("domain-sync utilities (react-dom)", () => {
  it("snapshotDomain returns a fresh frozen plain object detached from live getters", () => {
    let xMin = 1520;
    const liveView = {
      get xMin() {
        return xMin;
      },
      xMax: 1580,
      yMin: -80,
      yMax: 0,
    };

    const snap = snapshotDomain(liveView);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(snap).toEqual({ xMin: 1520, xMax: 1580, yMin: -80, yMax: 0 });
    expect(snap).not.toBe(liveView);

    xMin = 1540;
    expect(snap.xMin).toBe(1520);
    expect(Object.isFrozen(DEFAULT_DOMAIN_SNAPSHOT)).toBe(true);
  });

  it("domainsEqual compares all four scalar coordinates", () => {
    const a = { xMin: 0, xMax: 10, yMin: -5, yMax: 5 };
    expect(domainsEqual(a, { xMin: 0, xMax: 10, yMin: -5, yMax: 5 })).toBe(true);
    expect(domainsEqual(a, { xMin: 1, xMax: 10, yMin: -5, yMax: 5 })).toBe(false);
    expect(domainsEqual(a, { xMin: 0, xMax: 11, yMin: -5, yMax: 5 })).toBe(false);
    expect(domainsEqual(a, { xMin: 0, xMax: 10, yMin: -6, yMax: 5 })).toBe(false);
    expect(domainsEqual(a, { xMin: 0, xMax: 10, yMin: -5, yMax: 6 })).toBe(false);
  });

  it("decimationEqual compares LTTB and Min-Max selections structurally", () => {
    expect(decimationEqual(undefined, undefined)).toBe(true);
    expect(decimationEqual({ algorithm: "lttb" }, undefined)).toBe(false);
    expect(decimationEqual({ algorithm: "lttb", threshold: 500 }, { algorithm: "lttb", threshold: 500 })).toBe(true);
    expect(decimationEqual({ algorithm: "lttb", threshold: 500 }, { algorithm: "lttb", threshold: 1000 })).toBe(false);
    expect(decimationEqual({ algorithm: "min-max", bucketCount: 256 }, { algorithm: "min-max", bucketCount: 256 })).toBe(true);
    expect(decimationEqual({ algorithm: "min-max", bucketCount: 256 }, { algorithm: "lttb" })).toBe(false);
  });

  it("assertDataTracesExclusive throws TypeError when both are provided", () => {
    const payload = createTestPayload(32);
    const traces = createTestTraceCollection();

    expect(() => assertDataTracesExclusive(undefined, undefined)).not.toThrow();
    expect(() => assertDataTracesExclusive(payload, undefined)).not.toThrow();
    expect(() => assertDataTracesExclusive(undefined, traces)).not.toThrow();
    expect(() => assertDataTracesExclusive(payload, traces)).toThrow(TypeError);
    expect(normalizeOptional(null)).toBeUndefined();
    expect(normalizeOptional(undefined)).toBeUndefined();
    expect(normalizeOptional(payload)).toBe(payload);
  });
});
