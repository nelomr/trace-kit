// Permanent regression fixture for the `packages/renderers/src/path/**` hot-path lint scope,
// which forbids per-point allocations. Ignored by the main `eslint .` run (`**/test/fixtures/**`) so it stays
// committed without failing ordinary linting; `lint-hot-path.test.ts` drives ESLint's Node API
// against the same flat config with the ignore lifted and asserts the rule fires on the exact
// line, via a virtual `filePath` under `src/path/` so the scoped `files` glob matches without
// moving this fixture into the published source tree.

/** Line 12: an array literal inside a `buildTracePath`-shaped `for` loop body. */
export function buildsArrayLiteralInLoop(values: Float32Array): number {
  const collected: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    collected.push([values[i] ?? 0][0] ?? 0);
  }
  return collected.length;
}
