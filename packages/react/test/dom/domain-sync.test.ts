import type { ViewportDomain, ViewportMutationReason } from "@trace-kit/renderers/controller";
import { act, createElement, useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DOMAIN_SNAPSHOT,
  assertDataTracesExclusive,
  decimationEqual,
  domainsEqual,
  normalizeOptional,
  snapshotDomain,
} from "../../src/domain-sync.js";
import { useSpectrumEngine } from "../../src/use-spectrum-engine.js";
import type { UseSpectrumEngineReturn } from "../../src/types.js";
import {
  createMockPlatform,
  createTestPayload,
  createTestTraceCollection,
  mountReact,
} from "./test-helpers.js";

describe("domain-sync utilities & dual echo guard (react-dom)", () => {
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
    expect(
      decimationEqual({ algorithm: "lttb", threshold: 500 }, { algorithm: "lttb", threshold: 500 }),
    ).toBe(true);
    expect(
      decimationEqual(
        { algorithm: "lttb", threshold: 500 },
        { algorithm: "lttb", threshold: 1000 },
      ),
    ).toBe(false);
    expect(
      decimationEqual(
        { algorithm: "min-max", bucketCount: 256 },
        { algorithm: "min-max", bucketCount: 256 },
      ),
    ).toBe(true);
    expect(
      decimationEqual({ algorithm: "min-max", bucketCount: 256 }, { algorithm: "lttb" }),
    ).toBe(false);
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

  it("emits detached immutable snapshotDomain objects across consecutive domain mutations", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);
    const emitted: ViewportDomain[] = [];
    let handle: UseSpectrumEngineReturn | null = null;

    function Host() {
      const ref = useRef<HTMLDivElement | null>(null);
      handle = useSpectrumEngine(ref, {
        data: payload,
        platform: harness.platform,
        onDomainChange: (d) => {
          emitted.push(d);
        },
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(createElement(Host));
    act(() => {
      handle!.setDomain(10, 90, -70, 0);
      handle!.setDomain(20, 80, -60, -10);
    });

    expect(emitted).toHaveLength(2);
    expect(Object.isFrozen(emitted[0]!)).toBe(true);
    expect(Object.isFrozen(emitted[1]!)).toBe(true);
    expect(emitted[0]).toEqual({ xMin: 10, xMax: 90, yMin: -70, yMax: 0 });
    expect(emitted[1]).toEqual({ xMin: 20, xMax: 80, yMin: -60, yMax: -10 });

    mounted.unmount();
  });

  it("Guard 1 (WeakSet): prevents stale-frame snap-back when async parent echoes earlier snapshot S_k after S_{k+1}", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);
    const emitted: ViewportDomain[] = [];
    let handle: UseSpectrumEngineReturn | null = null;

    function Host(props: { domain: ViewportDomain }) {
      const ref = useRef<HTMLDivElement | null>(null);
      handle = useSpectrumEngine(ref, {
        data: payload,
        domain: props.domain,
        platform: harness.platform,
        onDomainChange: (d) => {
          emitted.push(d);
        },
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(
      createElement(Host, { domain: { xMin: 0, xMax: 100, yMin: -80, yMax: 0 } }),
    );
    act(() => {
      harness.raf.flushAll();
    });

    act(() => {
      handle!.setDomain(10, 90, -80, 0); // S_k
      handle!.setDomain(20, 80, -80, 0); // S_{k+1}
    });

    const sk = emitted[0]!;
    const renderer = harness.canvas2dRenderers[0]!;
    const callsBefore = renderer.setDomainCalls.length;

    // Parent asynchronously echoes stale S_k -> WeakSet guard MUST ignore it and NOT snap back!
    mounted.rerender(createElement(Host, { domain: sk }));
    expect(renderer.setDomainCalls.length).toBe(callsBefore);
    expect(handle!.controller!.domain).toEqual({ xMin: 20, xMax: 80, yMin: -80, yMax: 0 });

    mounted.unmount();
  });

  it("Guard 2 (4-scalar equality): suppresses redundant setDomain and requestRender when parent clones emitted domain", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);
    let lastEmitted: ViewportDomain | null = null;
    let handle: UseSpectrumEngineReturn | null = null;

    function Host(props: { domain: ViewportDomain }) {
      const ref = useRef<HTMLDivElement | null>(null);
      handle = useSpectrumEngine(ref, {
        data: payload,
        domain: props.domain,
        platform: harness.platform,
        onDomainChange: (d) => {
          lastEmitted = d;
        },
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(
      createElement(Host, { domain: { xMin: 0, xMax: 100, yMin: -80, yMax: 0 } }),
    );
    act(() => {
      harness.raf.flushAll();
    });

    act(() => {
      handle!.setDomain(12, 88, -75, -5);
    });

    const renderer = harness.canvas2dRenderers[0]!;
    const callsBefore = renderer.setDomainCalls.length;
    harness.raf.resetScheduleCount();

    // Pass brand-new cloned object with identical 4 coordinates
    mounted.rerender(createElement(Host, { domain: { ...lastEmitted! } }));
    expect(renderer.setDomainCalls.length).toBe(callsBefore);
    expect(harness.raf.scheduleCount()).toBe(0);

    mounted.unmount();
  });

  it("applies genuine external domain changes via setDomain, refreshes snapshot, and does not re-emit onDomainChange", () => {
    const harness = createMockPlatform();
    const payload = createTestPayload(256);
    const onDomainChange = vi.fn<(d: ViewportDomain, r: ViewportMutationReason) => void>();
    let handle: UseSpectrumEngineReturn | null = null;

    function Host(props: { domain: ViewportDomain }) {
      const ref = useRef<HTMLDivElement | null>(null);
      handle = useSpectrumEngine(ref, {
        data: payload,
        domain: props.domain,
        platform: harness.platform,
        onDomainChange,
      });
      return createElement("div", { ref });
    }

    const mounted = mountReact(
      createElement(Host, { domain: { xMin: 0, xMax: 100, yMin: -80, yMax: 0 } }),
    );
    act(() => {
      harness.raf.flushAll();
    });

    harness.raf.resetScheduleCount();
    mounted.rerender(createElement(Host, { domain: { xMin: 30, xMax: 70, yMin: -50, yMax: -10 } }));

    expect(handle!.domain).toEqual({ xMin: 30, xMax: 70, yMin: -50, yMax: -10 });
    expect(harness.raf.scheduleCount()).toBe(1);
    expect(onDomainChange).not.toHaveBeenCalled();

    mounted.unmount();
  });
});
