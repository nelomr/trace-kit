// Regression fixture proving `@typescript-eslint/no-explicit-any` still fires inside `bench/**`
// after `eslint.config.js` moved that tree onto classic `parserOptions.project` for
// `typescript@6.0.3` (see the `test/**`/`bench/**` block in `eslint.config.js`). Permanently
// committed; ignored by the main `eslint .` run (since this file intentionally violates the
// rule) and asserted against directly by `test/lint-rules.test.ts` via ESLint's Node API with
// the ignore lifted.
export type Bad = Record<string, any>;
