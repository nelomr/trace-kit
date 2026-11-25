/** @vitest-environment happy-dom */
import type { ViewportDomain, ViewportMutationReason } from "@trace-kit/renderers/controller";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, isProxy, nextTick, shallowRef } from "vue";
import type { UseSpectrumEngineReturn } from "../../src/types.js";
import { useSpectrumEngine } from "../../src/use-spectrum-engine.js";
import { createMockPlatform, createMountedHost } from "./test-helpers.js";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("domain-sync & dual echo guard (happy-dom)", () => {
  it("emits detached immutable snapshotDomain objects across consecutive pan moves", () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const emitted: ViewportDomain[] = [];
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          domain: { xMin: 0, xMax: 100, yMin: -50, yMax: 50 },
          platform: harness.platform,
          onDomainChange: (snapshot) => {
            emitted.push(snapshot);
          },
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);

    const handle = handleRef!;
    handle.panByFraction(0.1, 0);
    const s1 = emitted[0]!;
    const s1Copy = { ...s1 };

    handle.panByFraction(0.1, 0);
    const s2 = emitted[1]!;

    expect(s1).not.toBe(handle.controller.value!.domain);
    expect(s1).not.toBe(s2);
    expect(isProxy(s1)).toBe(false);
    expect(Object.isFrozen(s1)).toBe(true);
    // s1 coordinates must remain completely unchanged after s2
    expect(s1).toEqual(s1Copy);
    expect(s2.xMin).toBeGreaterThan(s1.xMin);

    app.unmount();
  });

  it("Guard 1 (WeakSet): prevents stale-frame snap-back when async parent flush echoes earlier snapshots S_k and S_{k+1}", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const domainRef = shallowRef<ViewportDomain>({ xMin: 0, xMax: 100, yMin: -10, yMax: 10 });
    const emitted: ViewportDomain[] = [];
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          domain: domainRef,
          platform: harness.platform,
          onDomainChange: (snapshot) => {
            emitted.push(snapshot);
          },
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const handle = handleRef!;
    const setDomainSpy = vi.spyOn(handle.controller.value!, "setDomain");

    // Rapid frame k and frame k+1 happen BEFORE parent Vue flushes domainRef
    handle.panByFraction(0.1, 0); // emits S_k
    handle.panByFraction(0.1, 0); // emits S_{k+1}
    expect(emitted.length).toBe(2);
    const sK = emitted[0]!;
    const sKPlus1 = emitted[1]!;
    expect(sKPlus1.xMin).toBeGreaterThan(sK.xMin);

    setDomainSpy.mockClear();

    // Delayed parent flush first delivers stale S_k
    domainRef.value = sK;
    await nextTick();

    // Controller must NOT snap backwards to S_k
    expect(setDomainSpy).not.toHaveBeenCalled();
    expect(handle.controller.value!.domain.xMin).toBeCloseTo(sKPlus1.xMin, 6);
    expect(handle.controller.value!.domain.xMax).toBeCloseTo(sKPlus1.xMax, 6);

    // Subsequent parent flush delivers S_{k+1}
    domainRef.value = sKPlus1;
    await nextTick();
    expect(setDomainSpy).not.toHaveBeenCalled();
    expect(handle.controller.value!.domain.xMin).toBeCloseTo(sKPlus1.xMin, 6);

    app.unmount();
  });

  it("Guard 2 (4-scalar equality): suppresses redundant setDomain and requestRender when parent clones emitted domain", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const parentDomain = shallowRef<ViewportDomain>({ xMin: 0, xMax: 100, yMin: -10, yMax: 10 });
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          domain: parentDomain,
          platform: harness.platform,
          onDomainChange: (snapshot) => {
            // Consumer clones snapshot object instead of preserving reference
            parentDomain.value = { ...snapshot };
          },
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const handle = handleRef!;
    const setDomainSpy = vi.spyOn(handle.controller.value!, "setDomain");
    const requestRenderSpy = vi.spyOn(handle.controller.value!, "requestRender");

    handle.panByFraction(0.15, 0);
    const setDomainCallsDuringPan = setDomainSpy.mock.calls.length;
    const reqRenderCallsDuringPan = requestRenderSpy.mock.calls.length;

    await nextTick();

    // Cloned parentDomain echo must NOT invoke setDomain or requestRender again
    expect(setDomainSpy.mock.calls.length).toBe(setDomainCallsDuringPan);
    expect(requestRenderSpy.mock.calls.length).toBe(reqRenderCallsDuringPan);

    app.unmount();
  });

  it("applies genuine external domain changes via setDomain, refreshes reactive domain, and calls requestRender without re-emitting", async () => {
    const harness = createMockPlatform();
    const mountTarget = createMountedHost();
    const domainRef = shallowRef<ViewportDomain>({ xMin: 0, xMax: 100, yMin: -1, yMax: 1 });
    const emitted: Array<{ d: ViewportDomain; r: ViewportMutationReason }> = [];
    let handleRef: UseSpectrumEngineReturn | null = null;

    const Host = defineComponent({
      setup() {
        const containerRef = shallowRef<HTMLDivElement | null>(null);
        handleRef = useSpectrumEngine(containerRef, {
          domain: domainRef,
          platform: harness.platform,
          onDomainChange: (d, r) => emitted.push({ d, r }),
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const app = createApp(Host);
    app.mount(mountTarget);
    harness.raf.flush();

    const handle = handleRef!;
    const setDomainSpy = vi.spyOn(handle.controller.value!, "setDomain");
    const requestRenderSpy = vi.spyOn(handle.controller.value!, "requestRender");

    domainRef.value = { xMin: 10, xMax: 50, yMin: -20, yMax: 5 };
    await nextTick();

    expect(setDomainSpy).toHaveBeenCalledTimes(1);
    expect(setDomainSpy).toHaveBeenCalledWith(10, 50, -20, 5);
    expect(requestRenderSpy).toHaveBeenCalledTimes(1);
    expect(handle.domain.value).toEqual({ xMin: 10, xMax: 50, yMin: -20, yMax: 5 });
    expect(emitted.length).toBe(0);

    app.unmount();
  });
});
