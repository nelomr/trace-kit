import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { asRoutePath } from "../../src/shell/view.js";
import { registerView } from "../../src/shell/registry.js";
import { createRouter } from "../../src/shell/router.js";
import { Pane } from "tweakpane";

// Reference-counts EventTarget listeners across the real prototype so the net outstanding
// count (add minus remove) proves the router's AbortSignal-based reclamation actually works,
// rather than trusting the view's own bookkeeping, which could report clean teardown while
// leaking real listeners.
describe("router mount/unmount lifecycle", () => {
  let addCount = 0;
  let removeCount = 0;
  let originalAdd: typeof EventTarget.prototype.addEventListener;
  let originalRemove: typeof EventTarget.prototype.removeEventListener;
  let rafSpy: MockInstance<(callback: FrameRequestCallback) => number>;
  let cafSpy: MockInstance<(handle: number) => void>;

  beforeEach(() => {
    addCount = 0;
    removeCount = 0;
    // Deliberately unbound: the whole point is to re-apply the original implementation
    // against whatever `this` the monkey-patched wrapper below is called with.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalAdd = EventTarget.prototype.addEventListener;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      ...args: Parameters<typeof originalAdd>
    ) {
      addCount += 1;
      return originalAdd.apply(this, args);
    };
    EventTarget.prototype.removeEventListener = function (
      this: EventTarget,
      ...args: Parameters<typeof originalRemove>
    ) {
      removeCount += 1;
      return originalRemove.apply(this, args);
    };
    rafSpy = vi.spyOn(window, "requestAnimationFrame");
    cafSpy = vi.spyOn(window, "cancelAnimationFrame");
  });

  afterEach(() => {
    EventTarget.prototype.addEventListener = originalAdd;
    EventTarget.prototype.removeEventListener = originalRemove;
    rafSpy.mockRestore();
    cafSpy.mockRestore();
  });

  it("leaves zero net listeners and a cancelled animation frame after mount then unmount", async () => {
    const path = asRoutePath("/routing-teardown-fixture");
    let rafHandle = -1;
    registerView({
      path,
      label: "Teardown Fixture",
      mount: (host) => {
        window.addEventListener("resize", () => {}, { signal: host.signal });
        rafHandle = requestAnimationFrame(() => {});
        return () => {
          cancelAnimationFrame(rafHandle);
        };
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const panel = new Pane();
    const router = createRouter({ container, panel });

    location.hash = `#${path}`;
    await router.navigate(path);
    location.hash = "";
    await router.navigate(undefined);

    expect(addCount - removeCount).toBe(0);
    expect(rafSpy).toHaveBeenCalled();
    expect(cafSpy).toHaveBeenCalledWith(rafHandle);
  });
});
