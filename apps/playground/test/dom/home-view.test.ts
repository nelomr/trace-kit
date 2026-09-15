import { describe, expect, it } from "vitest";
import { Pane } from "tweakpane";
import { asRoutePath } from "../../src/shell/view.js";
import { registerView } from "../../src/shell/registry.js";
import { mount } from "../../src/views/home/mount.js";

describe("/home landing view", () => {
  it("lists every other registered view and does not list itself", () => {
    registerView({
      path: asRoutePath("/home-view-fixture"),
      label: "Fixture View",
      mount: () => () => {},
    });

    const container = document.createElement("div");
    const panel = new Pane();
    const controller = new AbortController();
    const teardown = mount({ container, panel, signal: controller.signal });

    const links = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toContain("#/home-view-fixture");
    expect(links).not.toContain("#/home");

    void teardown();
    expect(container.children.length).toBe(0);
  });
});
