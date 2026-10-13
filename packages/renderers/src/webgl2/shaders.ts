/**
 * GLSL ES 3.00 sources for the two programs and the numeric constants they embed. The sources are
 * string constants assembled by concatenation at module scope, which is pure: nothing here touches
 * a DOM or GL object, so importing the module has no side effect.
 *
 * Geometry is drawn as instanced quads, with no vertex buffer for the quad itself: the corner is
 * derived from `gl_VertexID`. Instance `i` of the line program reads `x[i], x[i + 1], y[i],
 * y[i + 1]` through two attribute pointers into the same buffers, so the CPU never interleaves or
 * expands the payload. The marker program draws one square per isolated sample.
 *
 * Every projection mirrors the shared `ViewportTransform` the Canvas2D and SVG engines use, in
 * device pixels with a top-left origin and Y growing downwards, so the same figure comes out of
 * every engine.
 */
import { LOG10_2 } from "./precision.js";

/**
 * Distance, in device pixels, projected coordinates may reach beyond the plot rectangle. Large
 * enough to exceed the plot height of any canvas a browser can allocate (Chromium caps a
 * dimension at 32,767), so a sample pushed far outside the view still leaves the visible region
 * on the correct side. The clamp also bounds huge finite values so a segment length stays finite.
 */
export const GUARD_BAND_PX = 65536;

/** Width of the anti-aliasing ramp at a stroke edge, in device pixels. */
export const AA_FEATHER_PX = 1;

export const VERSION_AND_PRECISION = `#version 300 es
precision highp float;
precision highp int;
`;

export const SHARED_UNIFORMS_GLSL = `
uniform vec2 u_xOrigin;
uniform float u_one;
uniform float u_xScale;
uniform vec4 u_plot;
uniform vec2 u_device;
uniform vec4 u_y;
uniform int u_yScaleKind;
`;

/**
 * Shared by both vertex shaders. `projectXDevice` evaluates `((offset - hi) * one - lo) * scale +
 * plotLeft` in exactly this order: the origin is split in Float64 on the CPU, each subtraction is
 * between nearby numbers, and a compiler that regrouped it as `offset - (hi + lo)` would collapse
 * the pair back into one float32 and lose the sub-pixel part of the origin. Metal's compiler was
 * measured doing exactly that to the plain `(offset - hi) - lo`; `u_one` is a uniform that is
 * always 1, so the compiler cannot see through the multiplication and fold the two subtractions,
 * while a fused multiply-subtract of `(offset - hi) * 1 - lo` rounds like the subtraction itself.
 *
 * NaN and infinity are classified from the bit pattern, because GLSL ES 3.00 does not guarantee
 * the built-in NaN test or infinity arithmetic on every GPU. An infinity is resolved to the guard band before
 * any arithmetic touches it.
 */
export const PROJECTION_GLSL = `
const float GUARD_BAND_PX = ${GUARD_BAND_PX.toFixed(1)};
const float AA_FEATHER_PX = ${AA_FEATHER_PX.toFixed(1)};
const float LOG10_2 = ${LOG10_2.toFixed(17)};

bool isGapBits(float v) {
  uint b = floatBitsToUint(v);
  return (b & 0x7F800000u) == 0x7F800000u && (b & 0x007FFFFFu) != 0u;
}

bool isInfinityBits(float v) {
  return (floatBitsToUint(v) & 0x7FFFFFFFu) == 0x7F800000u;
}

float projectXDevice(float offset) {
  float hi = u_xOrigin.x;
  float lo = u_xOrigin.y;
  float one = u_one;
  float scale = u_xScale;
  float plotLeft = u_plot.x;
  float px = ((offset - hi) * one - lo) * scale + plotLeft;
  return clamp(px, u_plot.x - GUARD_BAND_PX, u_plot.x + u_plot.z + GUARD_BAND_PX);
}

float projectYDevice(float y) {
  float top = u_plot.y - GUARD_BAND_PX;
  float bottom = u_plot.y + u_plot.w + GUARD_BAND_PX;
  float axisScale = u_yScaleKind == 1 ? u_y.w : u_y.y;
  if (isInfinityBits(y)) {
    bool positive = (floatBitsToUint(y) & 0x80000000u) == 0u;
    return (positive == (axisScale >= 0.0)) ? top : bottom;
  }
  float py = u_yScaleKind == 1
    ? u_y.x - (log2(y) * LOG10_2 - u_y.z) * u_y.w
    : u_y.x - y * u_y.y;
  return clamp(py, top, bottom);
}

bool isUnrepresentable(float y0, float y1) {
  return isGapBits(y0) || isGapBits(y1) || (u_yScaleKind == 1 && (y0 <= 0.0 || y1 <= 0.0));
}

vec4 toClip(vec2 devicePosition) {
  return vec4(
    devicePosition.x / u_device.x * 2.0 - 1.0,
    1.0 - devicePosition.y / u_device.y * 2.0,
    0.0,
    1.0
  );
}
`;

export const LINE_VERTEX_SHADER = `${VERSION_AND_PRECISION}${SHARED_UNIFORMS_GLSL}
uniform float u_lineWidth;
layout(location = 0) in float a_x0;
layout(location = 1) in float a_x1;
layout(location = 2) in float a_y0;
layout(location = 3) in float a_y1;
out float v_across;
flat out float v_halfCore;
${PROJECTION_GLSL}
void main() {
  if (isUnrepresentable(a_y0, a_y1)) {
    // One clip point for all four corners: zero area, nothing is rasterized.
    gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
    v_across = 0.0;
    v_halfCore = 0.0;
    return;
  }
  vec2 p0 = vec2(projectXDevice(a_x0), projectYDevice(a_y0));
  vec2 p1 = vec2(projectXDevice(a_x1), projectYDevice(a_y1));
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);

  // A stroke thinner than one device pixel is drawn one pixel wide with its alpha scaled down
  // (see the fragment shader), which keeps it visible instead of losing its coverage.
  float halfCore = 0.5 * max(u_lineWidth, 1.0);
  float extent = halfCore + 0.5 * AA_FEATHER_PX;
  int along = gl_VertexID & 1;
  float side = float(gl_VertexID >> 1) * 2.0 - 1.0;
  // Square caps close the notch between consecutive segments at a bend.
  vec2 base = along == 0 ? p0 - dir * halfCore : p1 + dir * halfCore;
  gl_Position = toClip(base + n * (side * extent));
  v_across = side * extent;
  v_halfCore = halfCore;
}
`;

export const LINE_FRAGMENT_SHADER = `${VERSION_AND_PRECISION}
uniform vec4 u_color;
uniform float u_lineWidth;
const float AA_FEATHER_PX = ${AA_FEATHER_PX.toFixed(1)};
in float v_across;
flat in float v_halfCore;
out vec4 outColor;
void main() {
  float coverage = clamp(v_halfCore + 0.5 * AA_FEATHER_PX - abs(v_across), 0.0, 1.0);
  float thin = min(u_lineWidth, 1.0);
  float a = u_color.a * coverage * thin;
  outColor = vec4(u_color.rgb * a, a);
}
`;

export const MARKER_VERTEX_SHADER = `${VERSION_AND_PRECISION}${SHARED_UNIFORMS_GLSL}
uniform float u_markerSide;
layout(location = 0) in float a_x;
layout(location = 2) in float a_y;
out vec2 v_local;
flat out float v_half;
${PROJECTION_GLSL}
void main() {
  if (isUnrepresentable(a_y, a_y)) {
    gl_Position = vec4(0.0, 0.0, 0.0, 1.0);
    v_local = vec2(0.0);
    v_half = 0.0;
    return;
  }
  vec2 p = vec2(projectXDevice(a_x), projectYDevice(a_y));
  float halfSide = 0.5 * u_markerSide;
  float extent = halfSide + 0.5 * AA_FEATHER_PX;
  vec2 corner = vec2(float(gl_VertexID & 1) * 2.0 - 1.0, float(gl_VertexID >> 1) * 2.0 - 1.0);
  gl_Position = toClip(p + corner * extent);
  v_local = corner * extent;
  v_half = halfSide;
}
`;

export const MARKER_FRAGMENT_SHADER = `${VERSION_AND_PRECISION}
uniform vec4 u_color;
const float AA_FEATHER_PX = ${AA_FEATHER_PX.toFixed(1)};
in vec2 v_local;
flat in float v_half;
out vec4 outColor;
void main() {
  vec2 across = clamp(vec2(v_half + 0.5 * AA_FEATHER_PX) - abs(v_local), 0.0, 1.0);
  float a = u_color.a * across.x * across.y;
  outColor = vec4(u_color.rgb * a, a);
}
`;
