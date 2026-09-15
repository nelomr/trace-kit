import { describe, expect, it } from "vitest";
import { Pane } from "tweakpane";
import { sharedPanel } from "../../src/shell/panel.js";

describe("shared tweakpane panel", () => {
  it("is backed by a real tweakpane Pane", () => {
    expect(sharedPanel).toBeInstanceOf(Pane);
  });

  it("is the same reference on every access — exactly one Pane exists", () => {
    const first = sharedPanel;
    const second = sharedPanel;
    expect(first).toBe(second);
  });
});
