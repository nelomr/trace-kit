/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import { commitPayloadRevision, createSpectrumDataPayload, createViewportTransform } from "@trace-kit/core";
import { describe, expect, it } from "vitest";
import { LINE_VERTEX_SHADER, MARKER_VERTEX_SHADER } from "../../src/webgl2/shaders.js";
import { createHarness } from "./support/webgl2-harness.js";

function payloadWithOrigin(xOrigin: number) {
  const payload = createSpectrumDataPayload({ capacity: 64, xOrigin, xUnit: "nm", yUnit: "dBm" });
  for (let i = 0; i < 64; i += 1) {
    payload.x[i] = i * 0.001;
    payload.y[i] = i % 7;
  }
  commitPayloadRevision(payload, 64);
  return payload;
}

describe("Float64 normalisation before any Float32 cast", () => {
  it("derives hi/lo from the transform's xDomainMin in offset space, not from xOrigin", () => {
    const h = createHarness();
    h.renderer.resize(400, 300, 1);
    h.renderer.setData(payloadWithOrigin(987654.321));
    h.renderer.setDomain(12.5000001, 12.6, -1, 8);
    h.renderer.render();

    const hi = Math.fround(12.5000001);
    const lo = Math.fround(12.5000001 - hi);
    expect(h.gl.uniformValues("u_xOrigin")[0]).toEqual([hi, lo]);
  });

  it("preserves a non-float32-representable xOrigin in the transform", () => {
    const origin = 987654.321;
    expect(Math.fround(origin)).not.toBe(origin);
    const t = createViewportTransform({
      cssWidth: 400, cssHeight: 300, dpr: 1, insetLeft: 0, insetRight: 0, insetTop: 0, insetBottom: 0,
      xDomainMin: 0, xDomainMax: 1, yDomainMin: 0, yDomainMax: 1, xOrigin: origin,
    });
    expect(t.xOrigin).toBe(origin);
  });

  it("never hands xOrigin, xDomainMin or their sum to the GPU as one float32", () => {
    const h = createHarness();
    h.renderer.resize(400, 300, 1);
    h.renderer.setData(payloadWithOrigin(987654.321));
    h.renderer.setDomain(0.0000123, 0.064, -1, 8);
    h.renderer.render();

    const [hi, lo] = h.gl.uniformValues("u_xOrigin")[0] ?? [];
    expect(hi).toBe(Math.fround(0.0000123));
    expect(hi).not.toBe(Math.fround(987654.321));
    expect(hi).not.toBe(Math.fround(987654.321 + 0.0000123));
    expect(lo).not.toBe(0);
  });

  it("has no xOrigin + offset in either vertex shader", () => {
    for (const source of [LINE_VERTEX_SHADER, MARKER_VERTEX_SHADER]) {
      expect(source.replace(/\s+/g, "")).not.toMatch(/xOrigin\+offset|offset\+u_xOrigin/);
    }
  });

  it("leaves packages/core without any WebGL or getContext reference", () => {
    const root = new URL("../../../core/src/", import.meta.url);
    for (const entry of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      if (!entry.endsWith(".ts")) continue;
      const source = readFileSync(new URL(entry, root), "utf8");
      expect(source, entry).not.toMatch(/getContext|WebGL2?RenderingContext/);
    }
  });
});
