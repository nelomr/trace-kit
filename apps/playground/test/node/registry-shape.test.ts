/** @vitest-environment node */
import { describe, expect, expectTypeOf, it } from "vitest";
import { Pane } from "tweakpane";
import type { BindingApi } from "@tweakpane/core";
import {
  asRoutePath,
  type RoutePath,
  type ViewDefinition,
  type ViewHost,
  type ViewTeardown,
} from "../../src/shell/view.js";

describe("route path branding", () => {
  it("rejects a path with no leading slash", () => {
    expect(() => asRoutePath("no-slash")).toThrow(RangeError);
  });

  it("rejects the bare root as too short", () => {
    expect(() => asRoutePath("/")).toThrow(RangeError);
  });

  it("mints a RoutePath not assignable from a bare string", () => {
    const path = asRoutePath("/core-math");
    expectTypeOf(path).toMatchTypeOf<RoutePath>();
    // A bare string literal is NOT assignable to RoutePath without going through asRoutePath.
    expectTypeOf<"/core-math">().not.toMatchTypeOf<RoutePath>();
  });
});

describe("@tweakpane/core type resolution", () => {
  it("Pane#addBinding and Pane#remove type-check against a plain object target", () => {
    // Type-only proof of a measured TS2339 trap: `tweakpane@4.0.5` declares no
    // `dependencies`/`peerDependencies` on `@tweakpane/core` at all, yet its own `.d.ts` files
    // reference it — so `addBinding`/`remove` resolve only when `@tweakpane/core` is ALSO an
    // installed, catalog-pinned dependency. This function is never called; its only job is to
    // typecheck with exit 0.
    function typeOnlyProof(pane: Pane): void {
      const params = { x: 0 };
      const handle: BindingApi = pane.addBinding(params, "x");
      pane.remove(handle);
    }
    expect(typeof typeOnlyProof).toBe("function");
  });
});

describe("shell contract shape", () => {
  it("ViewHost.panel is typed as tweakpane's Pane", () => {
    expectTypeOf<ViewHost["panel"]>().toEqualTypeOf<Pane>();
  });

  it("ViewDefinition.mount accepts both sync and async teardown returns", () => {
    const syncView: ViewDefinition = {
      path: asRoutePath("/sync-fixture"),
      label: "Sync Fixture",
      mount: (): ViewTeardown => {
        return () => {};
      },
    };
    const asyncView: ViewDefinition = {
      path: asRoutePath("/async-fixture"),
      label: "Async Fixture",
      mount: (): Promise<ViewTeardown> => {
        return Promise.resolve(() => {});
      },
    };
    expect(syncView.path).toBe("/sync-fixture");
    expect(asyncView.path).toBe("/async-fixture");
  });
});
