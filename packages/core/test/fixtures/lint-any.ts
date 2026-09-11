// Regression fixture for `@typescript-eslint/no-explicit-any`, which enforces CLAUDE.md
// rule 1's ban on `any` anywhere in production code. Permanently committed; ignored by the
// main `eslint .` run (since this file intentionally violates the rule) and asserted against
// directly by `test/lint-rules.test.ts` via ESLint's Node API with the ignore lifted.
export type Bad = Record<string, any>;
