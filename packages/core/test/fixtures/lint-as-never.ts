// Regression fixture for the `no-restricted-syntax` `as never` selector (workspace-toolchain
// capability, design.md §D1.b). Permanently committed; ignored by the main `eslint .` run and
// asserted against directly by `test/lint-rules.test.ts` via ESLint's Node API with the ignore
// lifted.
const value = "not-a-number";
// `as unknown as never` (rather than a bare `value as never`) because TypeScript refuses a
// direct assertion between two types that do not sufficiently overlap (TS2352); bridging
// through `unknown` is the idiom this fixture exists to catch, and it still triggers the
// `TSAsExpression > TSNeverKeyword` selector on its outer assertion.
const silenced = value as unknown as never;
void silenced;
