// Regression fixture for `noUncheckedIndexedAccess` (workspace-toolchain capability).
// Group 0 (baseline) proved this read unguarded and unchecked; Group 2 task 2.1 enabled
// `noUncheckedIndexedAccess` in `tsconfig.base.json`, which made the original unguarded
// `const v: number = buf[i]` fail as `number | undefined`. This guarded form compiles clean
// and stays committed as the regression asset for that strictness flag.
const buf = new Float32Array([1, 2, 3]);
const i = 1;
const maybeV = buf[i];
if (maybeV === undefined) {
  throw new RangeError(`index ${i} out of bounds`);
}
const v: number = maybeV;
void v;
