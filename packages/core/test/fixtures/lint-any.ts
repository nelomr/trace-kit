// Regression fixture for `@typescript-eslint/no-explicit-any` (workspace-toolchain capability,
// design.md §D1.a). Permanently committed; ignored by the main `eslint .` run and asserted
// against directly by `test/lint-rules.test.ts` via ESLint's Node API with the ignore lifted.
export type Bad = Record<string, any>;
