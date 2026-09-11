// Permanent regression fixtures for the `packages/core/src/decimation/**` hot-path lint scope.
// Ignored by the main `eslint .` run (see `eslint.config.js`'s `**/test/fixtures/**` ignore) so
// these stay committed without failing ordinary linting; `lint-hot-path.test.ts` drives ESLint's
// Node API against the same flat config with the ignore lifted and asserts the exact rule fires
// on the exact file and line for each function below.

/** Line 10: `.subarray` inside a `for` loop body. */
export function usesSubarrayInLoop(source: Float32Array, count: number): number {
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const window = source.subarray(i, i + 1);
    total += window.length;
  }
  return total;
}

/** Line 20: an object literal inside a `for` loop body. */
export function usesObjectLiteralInLoop(values: Float32Array): number {
  const collected: Array<{ index: number }> = [];
  for (let i = 0; i < values.length; i += 1) {
    collected.push({ index: i });
  }
  return collected.length;
}
