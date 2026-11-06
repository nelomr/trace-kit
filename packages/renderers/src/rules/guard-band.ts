/**
 * Distance, in pixels of the transform (device pixels on a raster backend, CSS pixels for SVG),
 * that a projected coordinate may reach beyond the plot rectangle. It exceeds the largest canvas
 * dimension a browser allocates (Chromium caps one at 32,767), so a clamped vertex still leaves
 * the visible region on the correct side, and it keeps huge finite values finite so a segment
 * length never overflows. A power of two, so a float32 holds it exactly and the CPU and the GPU
 * compute the same guard edges.
 */
export const GUARD_BAND_PX = 65536;
