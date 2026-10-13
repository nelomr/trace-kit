/** @vitest-environment node */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FLOAT32_ABS_MASK,
  FLOAT32_EXPONENT_MASK,
  FLOAT32_MANTISSA_MASK,
} from "../../src/webgl2/float-bits.js";
import { LOG10_2 } from "../../src/webgl2/precision.js";
import {
  AA_FEATHER_PX,
  GUARD_BAND_PX,
  LINE_FRAGMENT_SHADER,
  LINE_VERTEX_SHADER,
  MARKER_FRAGMENT_SHADER,
  MARKER_VERTEX_SHADER,
  PROJECTION_GLSL,
} from "../../src/webgl2/shaders.js";

const ALL = {
  LINE_VERTEX_SHADER,
  LINE_FRAGMENT_SHADER,
  MARKER_VERTEX_SHADER,
  MARKER_FRAGMENT_SHADER,
};
const VERTEX = { LINE_VERTEX_SHADER, MARKER_VERTEX_SHADER };

function squash(source: string): string {
  return source.replace(/\s+/g, " ");
}

describe("shader preamble", () => {
  for (const [name, source] of Object.entries(ALL)) {
    it(`${name} is GLSL ES 3.00 with highp float and int`, () => {
      expect(source.startsWith("#version 300 es")).toBe(true);
      expect(source).toContain("precision highp float;");
      expect(source).toContain("precision highp int;");
    });
  }
});

describe("line vertex shader", () => {
  it("binds the four instance attributes at fixed locations", () => {
    const source = squash(LINE_VERTEX_SHADER);
    expect(source).toContain("layout(location = 0) in float a_x0;");
    expect(source).toContain("layout(location = 1) in float a_x1;");
    expect(source).toContain("layout(location = 2) in float a_y0;");
    expect(source).toContain("layout(location = 3) in float a_y1;");
  });

  it("derives the quad corner from gl_VertexID", () => {
    expect(LINE_VERTEX_SHADER).toContain("gl_VertexID & 1");
    expect(LINE_VERTEX_SHADER).toContain("gl_VertexID >> 1");
  });

  it("extends square caps by the core half width and expands by the feather", () => {
    const source = squash(LINE_VERTEX_SHADER);
    expect(source).toContain("0.5 * max(u_lineWidth, 1.0)");
    expect(source).toContain("0.5 * AA_FEATHER_PX");
  });
});

describe("marker vertex shader", () => {
  it("binds a_x at location 0 and a_y at location 2", () => {
    const source = squash(MARKER_VERTEX_SHADER);
    expect(source).toContain("layout(location = 0) in float a_x;");
    expect(source).toContain("layout(location = 2) in float a_y;");
    expect(MARKER_VERTEX_SHADER).toContain("gl_VertexID & 1");
    expect(MARKER_VERTEX_SHADER).toContain("gl_VertexID >> 1");
  });
});

describe("classifiers and constants", () => {
  for (const [name, source] of Object.entries(VERTEX)) {
    it(`${name} embeds the shared projection chunk`, () => {
      expect(source).toContain(PROJECTION_GLSL);
    });
  }

  it("classifies NaN and infinity by bit pattern and never calls isnan or isinf", () => {
    for (const mask of ["0x7F800000u", "0x007FFFFFu", "0x7FFFFFFFu"]) {
      expect(PROJECTION_GLSL).toContain(mask);
    }
    for (const source of Object.values(ALL)) {
      expect(source).not.toMatch(/\bisnan\b/);
      expect(source).not.toMatch(/\bisinf\b/);
    }
    expect(PROJECTION_GLSL).toContain("floatBitsToUint");
  });

  it("matches the CPU reference masks", () => {
    const hex = (mask: number): string => `0x${mask.toString(16).toUpperCase().padStart(8, "0")}u`;
    expect(PROJECTION_GLSL).toContain(hex(FLOAT32_EXPONENT_MASK));
    expect(PROJECTION_GLSL).toContain(hex(FLOAT32_MANTISSA_MASK));
    expect(PROJECTION_GLSL).toContain(hex(FLOAT32_ABS_MASK));
  });

  it("declares the guard band, feather and log conversion constants", () => {
    expect(GUARD_BAND_PX).toBe(65536);
    expect(AA_FEATHER_PX).toBe(1);
    expect(PROJECTION_GLSL).toContain("GUARD_BAND_PX = 65536.0");
    expect(PROJECTION_GLSL).toContain("AA_FEATHER_PX = 1.0");
    expect(PROJECTION_GLSL).toContain("LOG10_2 = 0.30102999566398120");
    expect(Number("0.30102999566398120")).toBe(LOG10_2);
  });

  it("collapses an unrepresentable instance to one clip point", () => {
    expect(squash(LINE_VERTEX_SHADER)).toContain("gl_Position = vec4(0.0, 0.0, 0.0, 1.0);");
    expect(squash(MARKER_VERTEX_SHADER)).toContain("gl_Position = vec4(0.0, 0.0, 0.0, 1.0);");
  });
});

describe("fragment shaders", () => {
  it("writes premultiplied alpha with a one-pixel feather and a thin-line alpha factor", () => {
    const line = squash(LINE_FRAGMENT_SHADER);
    expect(line).toContain("float thin = min(u_lineWidth, 1.0);");
    expect(line).toContain("outColor = vec4(u_color.rgb * a, a);");
    expect(line).toContain("0.5 * AA_FEATHER_PX");
    const marker = squash(MARKER_FRAGMENT_SHADER);
    expect(marker).toContain("outColor = vec4(u_color.rgb * a, a);");
  });
});

describe("hi/lo identity barrier", () => {
  it("declares u_one in both vertex shaders and multiplies the first difference by it", () => {
    for (const source of Object.values(VERTEX)) {
      expect(source).toContain("uniform float u_one;");
      expect(source).toContain("float one = u_one;");
      expect(squash(source)).toContain("((offset - hi) * one - lo) * scale + plotLeft");
    }
  });
});

describe("uniform interface", () => {
  it("declares every uniform the frame path uploads", () => {
    for (const name of ["u_xOrigin", "u_one", "u_xScale", "u_plot", "u_device", "u_y", "u_yScaleKind"]) {
      expect(LINE_VERTEX_SHADER).toContain(name);
      expect(MARKER_VERTEX_SHADER).toContain(name);
    }
    expect(LINE_FRAGMENT_SHADER).toContain("u_color");
    expect(LINE_FRAGMENT_SHADER).toContain("u_lineWidth");
    expect(MARKER_FRAGMENT_SHADER).toContain("u_color");
    expect(MARKER_VERTEX_SHADER).toContain("u_markerSide");
    expect(LINE_VERTEX_SHADER).toContain("u_lineWidth");
  });
});

describe("source bans in src/webgl2", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/webgl2");
  const files = readdirSync(dir).filter((file) => file.endsWith(".ts"));

  it("finds the WebGL2 sources", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const banned of ["devicePixelRatio", "fillText", "texImage2D"]) {
    it(`never mentions ${banned}`, () => {
      for (const file of files) {
        expect(readFileSync(path.join(dir, file), "utf8"), file).not.toContain(banned);
      }
    });
  }
});
