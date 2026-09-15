import { describe, expect, it } from "vitest";
import { Pane } from "tweakpane";
import { asRoutePath } from "../../src/shell/view.js";
import { registerView } from "../../src/shell/registry.js";
import { createRouter } from "../../src/shell/router.js";

describe("panel contributions are cleaned up on unmount", () => {
  it("removes a fixture view's two bindings from the shared Pane after unmount", async () => {
    const path = asRoutePath("/panel-cleanup-fixture");
    registerView({
      path,
      label: "Cleanup Fixture",
      mount: (host) => {
        const params = { a: 1, b: 2 };
        host.panel.addBinding(params, "a");
        host.panel.addBinding(params, "b");
        return () => {};
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const panel = new Pane();
    const before = panel.children.length;
    const router = createRouter({ container, panel });

    await router.navigate(path);
    expect(panel.children.length).toBe(before + 2);

    await router.navigate(undefined);
    expect(panel.children.length).toBe(before);
  });
});
