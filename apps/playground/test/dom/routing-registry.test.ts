import { describe, expect, it } from "vitest";
import { asRoutePath } from "../../src/shell/view.js";
import { registerView, registeredViews, resolveView } from "../../src/shell/registry.js";

describe("route registry", () => {
  it("throws on a duplicate path", () => {
    const path = asRoutePath("/registry-fixture-duplicate");
    registerView({ path, label: "Fixture", mount: () => () => {} });
    expect(() =>
      registerView({ path, label: "Fixture Again", mount: () => () => {} }),
    ).toThrow();
  });

  it("resolves undefined for an unregistered path and the definition for a registered one", () => {
    const path = asRoutePath("/registry-fixture-resolve");
    expect(resolveView(path)).toBeUndefined();
    const definition = { path, label: "Fixture", mount: () => () => {} };
    registerView(definition);
    expect(resolveView(path)).toBe(definition);
  });

  it("registeredViews returns exactly the registered set", () => {
    const path = asRoutePath("/registry-fixture-set");
    const before = registeredViews();
    const definition = { path, label: "Fixture", mount: () => () => {} };
    registerView(definition);
    const after = registeredViews();
    expect(after.length).toBe(before.length + 1);
    expect(after).toContain(definition);
  });
});

describe("the real view registration", () => {
  it("resolves exactly /home, /core-math, /svg-export and /engine-parity once views/index.ts is imported, and nothing else it didn't already have", async () => {
    const before = registeredViews().map((view) => view.path);
    await import("../../src/views/index.js");
    const after = registeredViews().map((view) => view.path);
    const added = after.filter((path) => !before.includes(path));
    expect(added.sort()).toEqual(["/core-math", "/engine-parity", "/home", "/svg-export"]);
  });
});
