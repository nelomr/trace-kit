import { lttb } from "../src/decimation/lttb.js";
import { minMaxEnvelope } from "../src/decimation/min-max.js";

// Traced child process for `--trace-deopt`. Imports from `../src/decimation/*` (source, not
// `dist`) so the `<JSFunction name>` in the trace matches the authored function name rather
// than a bundled/renamed one. Warms both targets to tier-up with monomorphic
// `Float32Array`/`Int32Array` arguments, then runs a fixture engineered to deopt reliably, as
// the mode's own self-check sentinel.

function warmMinMax(): void {
  const sampleCount = 4096;
  const bucketCount = 256;
  const y = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) y[i] = Math.sin(i);
  const out = new Float32Array(bucketCount * 2);
  for (let i = 0; i < 50_000; i += 1) {
    minMaxEnvelope(y, 0, sampleCount, out, 0, bucketCount);
  }
}

function warmLttb(): void {
  const sampleCount = 4096;
  const threshold = 256;
  const x = new Float32Array(sampleCount);
  const y = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    x[i] = i;
    y[i] = Math.cos(i);
  }
  const out = new Int32Array(threshold);
  for (let i = 0; i < 50_000; i += 1) {
    lttb(x, y, 0, sampleCount, out, 0, threshold);
  }
}

interface ShapeA {
  a: number;
}

/**
 * Deliberately deopts via a hidden-class (map) transition after tier-up: warmed 100,000+ times
 * against a monomorphic `{ a }` shape, then called once with `{ a, b }`. This is the reliable
 * shape — a `Float32Array`-then-`Float64Array` call pattern commonly yields a polymorphic
 * inline cache under modern V8 with no traced deopt at all, which would make the sentinel
 * itself flaky.
 */
function injectedDeoptFixture(shape: ShapeA): number {
  return shape.a + 1;
}

function warmDeoptSentinel(): void {
  const warm: ShapeA = { a: 1 };
  for (let i = 0; i < 100_000; i += 1) {
    injectedDeoptFixture(warm);
  }
  const mismatched = { a: 1, b: 2 };
  injectedDeoptFixture(mismatched);
}

warmMinMax();
warmLttb();
warmDeoptSentinel();
