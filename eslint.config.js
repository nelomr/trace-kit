// @ts-check
import tseslint from "typescript-eslint";

// Flat config per design.md §D1. Type-aware linting through `parserOptions.projectService`,
// resolved against `packages/core/tsconfig.test.json` so `test/**` and `bench/**` are inside a
// discoverable TypeScript project (design.md §D1.c) — without it, `projectService` errors with
// "file not found in any of the projects" before any rule runs.
//
// `no-explicit-any` is configured with no relaxations (`fixToUnknown: false`,
// `ignoreRestArgs: false` — `ignoreRestArgs: true` would silently permit
// `(...args: any[])`, exactly the shape a hot-path callback would use).
//
// `no-restricted-syntax` carries all four selectors from design.md §D1.b (not just the
// single `TSAsExpression > TSNeverKeyword` the original checklist proposed): each of
// `<never>x`, `x satisfies never`, and — most importantly — the `x as unknown as Foo` double
// assertion (the commonest real suppression idiom) is banned alongside plain `x as never`.
//
// `**/test/fixtures/**` and `**/dist/**` are ignored by this main run: the fixtures under
// `test/fixtures/` are permanent regression assets that must trigger these exact rules, and
// are asserted against directly by `packages/core/test/lint-rules.test.ts` via ESLint's Node
// API with the ignore lifted (design.md §D1.d).
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.tsup/**",
      "**/test/fixtures/**",
      "**/node_modules/**",
    ],
  },
  {
    files: ["**/*.ts"],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "packages/core/test/*.ts",
            "packages/core/test/fixtures/*.ts",
            "packages/core/test/bench/*.ts",
            "packages/core/bench/*.ts",
            "packages/core/tsup.config.ts",
          ],
          defaultProject: "packages/core/tsconfig.test.json",
          // `test/**` and `bench/**` are legitimately outside `tsconfig.json`'s own
          // `include` (which stays `src/**` for the publishable build project), so every
          // one of them lints through this same fallback default project rather than
          // through ordinary upward `tsconfig.json` discovery. That list is bounded and
          // explicit (the entries above), not a wildcard — this raises typescript-eslint's
          // default safety cap (8) to fit it, not to allow unbounded growth.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": [
        "error",
        { fixToUnknown: false, ignoreRestArgs: false },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAsExpression > TSNeverKeyword",
          message:
            "`as never` suppresses type errors. Use a discriminated union or a branded-type constructor with a runtime check instead.",
        },
        {
          selector: "TSTypeAssertion > TSNeverKeyword",
          message:
            "`<never>x` suppresses type errors. Use a discriminated union or a branded-type constructor with a runtime check instead.",
        },
        {
          selector: "TSSatisfiesExpression > TSNeverKeyword",
          message:
            "`satisfies never` suppresses type errors. Use a discriminated union or a branded-type constructor with a runtime check instead.",
        },
        {
          selector: "TSAsExpression > TSUnknownKeyword",
          message:
            "`as unknown as Foo` (double assertion) suppresses type errors at a boundary. Justify with an inline eslint-disable-next-line carrying a reason if this is a genuine external boundary.",
        },
      ],
    },
  },
);
