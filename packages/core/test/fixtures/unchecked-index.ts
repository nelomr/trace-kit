// Regression fixture for `noUncheckedIndexedAccess` (workspace-toolchain capability).
// Without that strictness flag enabled in `tsconfig.base.json`, this array read was
// unguarded and unchecked; with it enabled, the original unguarded
// `const v: number = buf[i]` fails as `number | undefined`. This guarded form compiles clean
// and stays committed as the regression asset for that strictness flag.
const buf = new Float32Array([1, 2, 3]);
const i = 1;
const maybeV = buf[i];
if (maybeV === undefined) {
  throw new RangeError(`index ${i} out of bounds`);
}
const v: number = maybeV;
void v;
