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
      "**/bench/fixtures/**",
      "**/node_modules/**",
    ],
  },
  {
    files: ["**/*.ts"],
    ignores: [
      "packages/core/test/**",
      "packages/core/bench/**",
      "packages/renderers/test/**",
    ],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: {
          // `tsup.config.ts` lives outside `src/**`, so ordinary upward `tsconfig.json`
          // discovery never reaches it. Unlike `test/**`/`bench/**`, it does not touch any
          // Node-global type that `projectService`'s fallback fails to resolve under
          // `typescript@6.0.3` (no `process`, no error-typed catch bindings), so it stays on
          // this fallback rather than moving to the classic-mode block below.
          allowDefaultProject: [
            "packages/core/tsup.config.ts",
            "packages/renderers/tsup.config.ts",
            // Not a real file on disk: `lint-hot-path.test.ts` lints the committed
            // `test/fixtures/hot-path-violation.ts` source under this virtual `filePath` so it
            // is evaluated against the `src/decimation/**`-scoped hot-path rules without moving
            // the fixture into the published source tree. `projectService` cannot discover a
            // nonexistent path through ordinary `tsconfig.json` `include` matching, even though
            // the path itself falls under `src/**`, so it still needs this fallback entry.
            "packages/core/src/decimation/__hot-path-fixture-proof__.ts",
            "packages/renderers/src/path/__hot-path-fixture-proof__.ts",
          ],
          defaultProject: "packages/core/tsconfig.test.json",
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 8,
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
  {
    // `test/**` and `bench/**` are deliberately outside each package's `tsconfig.json`
    // `include` (which stays `src/**` for the publishable build project). Under
    // `typescript@6.0.3`, `projectService`'s `defaultProject`/`allowDefaultProject` fallback
    // stops constructing a program that can resolve ambient Node types for those files
    // (`@types/node` globals like `process` come back as unresolved), producing false-positive
    // "Unsafe call/member access of a type that could not be resolved" errors — verified against
    // `tsc --noEmit -p packages/core/tsconfig.test.json`, which exits `0` on the same files under
    // the same compiler. Classic `parserOptions.project`, pointed directly at the package
    // `tsconfig.test.json` files that already include `test/**` and `bench/**`, does not go
    // through that broken fallback and resolves correctly. Scoped to the two packages whose
    // own `tsconfig.json` excludes `test/**`/`bench/**` from its `include` — `apps/playground`
    // already lists `test/**` in its own `tsconfig.json` `include`, so its test files reach a
    // program through ordinary `projectService` discovery and must stay on the block above.
    files: [
      "packages/core/test/**/*.ts",
      "packages/core/bench/**/*.ts",
      "packages/renderers/test/**/*.ts",
    ],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: [
          "packages/core/tsconfig.test.json",
          "packages/renderers/tsconfig.test.json",
        ],
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
  {
    // Allocation-free hot-path enforcement (design.md §D5). Scoped to `src/decimation/**`
    // only — this is the source-level instrument in the three-instrument enforcement graph
    // (source / runtime / codegen). The loop-scoped selectors are nested under
    // `:matches(ForStatement, WhileStatement, DoWhileStatement)` because boundary validation
    // must still be able to construct and throw a `RangeError` *before* the loop; the ban is
    // on the loop body, not the file. The remaining selectors are unscoped across the whole
    // glob because they are never acceptable in a hot-path module.
    files: ["packages/core/src/decimation/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) ObjectExpression",
          message:
            "Object literals inside a loop allocate on every iteration. Use scalar locals instead.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) ArrayExpression",
          message:
            "Array literals inside a loop allocate on every iteration. Write into a preallocated buffer instead.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) TemplateLiteral",
          message:
            "Template literals inside a loop allocate a string on every iteration. Move message construction outside the loop.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) NewExpression",
          message:
            "`new` inside a loop allocates on every iteration. Construct once outside the loop.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) ArrowFunctionExpression",
          message:
            "A per-call closure inside a loop allocates on every iteration. Hoist the function outside the loop.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) FunctionExpression",
          message:
            "A per-call closure inside a loop allocates on every iteration. Hoist the function outside the loop.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) SpreadElement",
          message:
            "Spread inside a loop allocates on every iteration. Use an explicit index-based copy instead.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) MemberExpression[property.name=/^(map|filter|slice|subarray|reduce|reduceRight|forEach|flatMap|concat|entries|keys|values|toSorted|toReversed|with)$/]",
          message:
            "This typed-array/array method allocates a new view or object. Use an explicit index-based loop writing into a preallocated buffer instead.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) MemberExpression[object.name=\"Math\"][property.name=/^(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log2|log10|log1p|pow|cbrt|sinh|cosh|tanh|asinh|acosh|atanh|hypot)$/]",
          message:
            "This transcendental Math function is implementation-dependent (ECMA-262) and breaks cross-platform determinism. Restate the computation without it.",
        },
        {
          selector: "ForOfStatement",
          message:
            "`for...of` over a typed array allocates an iterator object. Use an indexed `for` loop instead.",
        },
        {
          selector: "RestElement",
          message:
            "Rest parameters allocate an array on every call. Use explicit positional parameters instead.",
        },
        {
          selector: "Identifier[name=\"arguments\"]",
          message:
            "`arguments` allocates an array-like object. Use explicit positional parameters instead.",
        },
        {
          selector: "YieldExpression",
          message: "Generators are not permitted in a hot-path module.",
        },
        {
          selector: "AwaitExpression",
          message: "`async`/`await` is not permitted in a hot-path module.",
        },
        {
          selector: "FunctionDeclaration[async=true]",
          message: "`async` functions are not permitted in a hot-path module.",
        },
        {
          selector: "FunctionDeclaration[generator=true]",
          message: "Generator functions are not permitted in a hot-path module.",
        },
      ],
    },
  },
  {
    // Allocation-free hot-path enforcement for the renderers package's trace-path module only
    // (design.md §D6) — the same selector list as `packages/core/src/decimation/**` (task
    // 4.6), reused verbatim rather than re-derived, since the allocation-free contract is
    // identical. `packages/renderers/src/canvas2d/**` is intentionally exempt: it constructs
    // exactly one `Path2D`/frame, which is not a hot-path allocation under this design.
    files: ["packages/renderers/src/path/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) ObjectExpression",
          message:
            "Object literals inside a loop allocate on every iteration. Use scalar locals instead.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) ArrayExpression",
          message:
            "Array literals inside a loop allocate on every iteration. Write into a preallocated buffer instead.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) TemplateLiteral",
          message:
            "Template literals inside a loop allocate a string on every iteration. Move message construction outside the loop.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) NewExpression",
          message:
            "`new` inside a loop allocates on every iteration. Construct once outside the loop.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) ArrowFunctionExpression",
          message:
            "A per-call closure inside a loop allocates on every iteration. Hoist the function outside the loop.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) FunctionExpression",
          message:
            "A per-call closure inside a loop allocates on every iteration. Hoist the function outside the loop.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) SpreadElement",
          message:
            "Spread inside a loop allocates on every iteration. Use an explicit index-based copy instead.",
        },
        {
          selector:
            ":matches(ForStatement, WhileStatement, DoWhileStatement) MemberExpression[property.name=/^(map|filter|slice|subarray|reduce|reduceRight|forEach|flatMap|concat|entries|keys|values|toSorted|toReversed|with)$/]",
          message:
            "This typed-array/array method allocates a new view or object. Use an explicit index-based loop writing into a preallocated buffer instead.",
        },
        {
          selector: "ForOfStatement",
          message:
            "`for...of` over a typed array allocates an iterator object. Use an indexed `for` loop instead.",
        },
        {
          selector: "RestElement",
          message:
            "Rest parameters allocate an array on every call. Use explicit positional parameters instead.",
        },
        {
          selector: "Identifier[name=\"arguments\"]",
          message:
            "`arguments` allocates an array-like object. Use explicit positional parameters instead.",
        },
        {
          selector: "YieldExpression",
          message: "Generators are not permitted in a hot-path module.",
        },
        {
          selector: "AwaitExpression",
          message: "`async`/`await` is not permitted in a hot-path module.",
        },
        {
          selector: "FunctionDeclaration[async=true]",
          message: "`async` functions are not permitted in a hot-path module.",
        },
        {
          selector: "FunctionDeclaration[generator=true]",
          message: "Generator functions are not permitted in a hot-path module.",
        },
      ],
    },
  },
);
