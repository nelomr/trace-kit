import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { Pane } from "tweakpane";
import { mount } from "../../src/views/core-math/mount.js";

describe("/core-math balanced mount/unmount lifecycle", () => {
  let addCount = 0;
  let removeCount = 0;
  let originalAdd: typeof EventTarget.prototype.addEventListener;
  let originalRemove: typeof EventTarget.prototype.removeEventListener;
  let rafSpy: MockInstance<(callback: FrameRequestCallback) => number>;
  let cafSpy: MockInstance<(handle: number) => void>;
  let observeSpy: MockInstance<typeof ResizeObserver.prototype.observe>;
  let disconnectSpy: MockInstance<typeof ResizeObserver.prototype.disconnect>;

  beforeEach(() => {
    addCount = 0;
    removeCount = 0;
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
    observeSpy = vi.spyOn(ResizeObserver.prototype, "observe");
    disconnectSpy = vi.spyOn(ResizeObserver.prototype, "disconnect");
  });

  afterEach(() => {
    EventTarget.prototype.addEventListener = originalAdd;
    EventTarget.prototype.removeEventListener = originalRemove;
    rafSpy.mockRestore();
    cafSpy.mockRestore();
    observeSpy.mockRestore();
    disconnectSpy.mockRestore();
  });

  it("leaves zero net listeners, cancels its frame, and disconnects its observer", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const panel = new Pane();
    const controller = new AbortController();

    const teardown = mount({ container, panel, signal: controller.signal });
    await teardown();

    expect(addCount - removeCount).toBe(0);
    expect(rafSpy).toHaveBeenCalled();
    expect(cafSpy).toHaveBeenCalled();
    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
