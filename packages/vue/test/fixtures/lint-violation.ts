// Regression fixture for `@typescript-eslint/no-explicit-any` and `no-restricted-syntax`
// under `packages/vue/test/**` (classic `parserOptions.project`). Permanently committed;
// ignored by the main `eslint .` run via `**/test/fixtures/**` and asserted directly by
// `test/node/vue-build.test.ts` via `lintFiles` with `ignore: false`, because under
// `CI=true` (`@typescript-eslint/typescript-estree` `singleRun: true`), classic
// `parserOptions.project` builds its TypeScript Program from disk rather than `lintText`.
export function bad(x: any): number {
  return x as unknown as number;
}
