/** @vitest-environment node */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FLOAT32_ABS_MASK,
  FLOAT32_EXPONENT_MASK,
  FLOAT32_MANTISSA_MASK,
} from "../../src/webgl2/float-bits.js";
import { GUARD_BAND_PX } from "../../src/rules/guard-band.js";
import { LOG10_2 } from "../../src/webgl2/precision.js";
import {
  AA_FEATHER_PX,
  SHARED_UNIFORMS_GLSL,
  VERSION_AND_PRECISION,
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

describe("shader source text is byte-stable", () => {
  const SHA256: Record<string, string> = {
    VERSION_AND_PRECISION: "e893080efff14b49396b4f6d12fc2aaf2c1c99d809de71d79d5975c2a5707eb4",
    SHARED_UNIFORMS_GLSL: "bb4b8db47cd124470e7561f9b9fe499d696f8fb96aabce5151e4e5723ce1ad71",
    PROJECTION_GLSL: "e5dc2f1d282f7470e9377a18d5c024d3c584fdf99c6a78b37de290fa9d1318b3",
    LINE_VERTEX_SHADER: "59602e7d5e35b5e4a6c064a22d5a44625bab93dcf16d189555428cb857f6f57b",
    LINE_FRAGMENT_SHADER: "9a618e2644687c03342d2db24a631c7eec7ad0c9b51413f1e50b51a9775a1dfd",
    MARKER_VERTEX_SHADER: "bf302482a60c76a550308172c9f7ae03493288f6f8ea8a51c1e38552f976814c",
    MARKER_FRAGMENT_SHADER: "0b68431dda6c890c51c0684c381f065c21565d8fe2eecb1f620633f87f077b0f",
  };
  const SOURCES: Record<string, string> = {
    VERSION_AND_PRECISION,
    SHARED_UNIFORMS_GLSL,
    PROJECTION_GLSL,
    ...ALL,
  };

  it("declares the guard band as one exact GLSL constant line", () => {
    expect(PROJECTION_GLSL).toContain("const float GUARD_BAND_PX = 65536.0;");
    expect(PROJECTION_GLSL).toContain(
      `const float GUARD_BAND_PX = ${GUARD_BAND_PX.toFixed(1)};`,
    );
  });

  it.each(Object.keys(SHA256))("%s hashes to the recorded digest", (name) => {
    const digest = createHash("sha256").update(SOURCES[name] ?? "").digest("hex");
    expect(digest).toBe(SHA256[name]);
  });
});

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

describe("offset-space domain minimum uniform", () => {
  const FORMER_NAME = new RegExp(`u_x${"Orig"}in`);

  it("declares u_xOffsetMin as a vec2 and reads both halves in projectXDevice", () => {
    for (const source of Object.values(VERTEX)) {
      expect(source).toContain("uniform vec2 u_xOffsetMin;");
      expect(source).toContain("float hi = u_xOffsetMin.x;");
      expect(source).toContain("float lo = u_xOffsetMin.y;");
      expect(source).not.toMatch(FORMER_NAME);
    }
  });

  it("keeps u_one declared and used by the multiply barrier", () => {
    for (const source of Object.values(VERTEX)) {
      expect(source).toContain("uniform float u_one;");
      expect(source).toContain("float one = u_one;");
    }
  });

  it("leaves the former uniform name out of every renderer source and the shader test support", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = path.join(here, "../../src");
    const scanned = [
      ...readdirSync(src, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".ts"))
        .map((file) => path.join(src, file)),
      path.join(here, "support/shader-source.ts"),
    ];
    expect(scanned.length).toBeGreaterThan(1);
    for (const file of scanned) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(FORMER_NAME);
    }
  });
});

describe("uniform interface", () => {
  it("declares every uniform the frame path uploads", () => {
    for (const name of ["u_xOffsetMin", "u_one", "u_xScale", "u_plot", "u_device", "u_y", "u_yScaleKind"]) {
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
