import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { Pane } from "tweakpane";
import type { TraceDrawingContext } from "@trace-kit/renderers";
import { mount } from "../../src/views/core-math/mount.js";

describe("/core-math balanced mount/unmount lifecycle", () => {
  let addCount = 0;
  let removeCount = 0;
  let originalAdd: typeof EventTarget.prototype.addEventListener;
  let originalRemove: typeof EventTarget.prototype.removeEventListener;
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let originalPath2D: typeof globalThis.Path2D;
  let observeSpy: MockInstance<typeof ResizeObserver.prototype.observe>;
  let disconnectSpy: MockInstance<typeof ResizeObserver.prototype.disconnect>;

  // happy-dom has no global `Path2D` either; `Canvas2DRenderer.render()` constructs exactly one
  // per call to hand `stroke()`, so a minimal stand-in is enough for this test's purposes.
  class StubPath2D {
    moveTo(): void {}
    lineTo(): void {}
  }

  beforeEach(() => {
    addCount = 0;
    removeCount = 0;
    originalPath2D = globalThis.Path2D;
    // eslint-disable-next-line no-restricted-syntax
    globalThis.Path2D = StubPath2D as unknown as typeof Path2D;
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
    observeSpy = vi.spyOn(ResizeObserver.prototype, "observe");
    disconnectSpy = vi.spyOn(ResizeObserver.prototype, "disconnect");

    // happy-dom's `HTMLCanvasElement.getContext` returns `null` with no 2D backend installed;
    // `Canvas2DRenderer` throws synchronously on that, so mounting the real `/core-math` view
    // needs a stub context installed first.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    const context: TraceDrawingContext = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineJoin: "miter",
      font: "",
      textAlign: "left",
      textBaseline: "alphabetic",
      setTransform(): void {},
      fillRect(): void {},
      beginPath(): void {},
      moveTo(): void {},
      lineTo(): void {},
      stroke(): void {},
      fillText(): void {},
    };
    // Test double: a real DOM boundary (happy-dom has no 2D canvas backend), not a production
    // suppression.
    // eslint-disable-next-line no-restricted-syntax
    const fakeGetContext = (() => context) as unknown as typeof originalGetContext;
    HTMLCanvasElement.prototype.getContext = fakeGetContext;
  });

  afterEach(() => {
    EventTarget.prototype.addEventListener = originalAdd;
    EventTarget.prototype.removeEventListener = originalRemove;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    globalThis.Path2D = originalPath2D;
    observeSpy.mockRestore();
    disconnectSpy.mockRestore();
  });

  it("leaves zero net listeners and disconnects its observer", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const panel = new Pane();
    const controller = new AbortController();

    const teardown = mount({ container, panel, signal: controller.signal });
    await teardown();

    expect(addCount - removeCount).toBe(0);
    expect(observeSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
