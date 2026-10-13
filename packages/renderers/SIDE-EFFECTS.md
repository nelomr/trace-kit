# `sideEffects: false` audit

`package.json` declares `"sideEffects": false`, which lets a bundler drop any import whose exports
go unused. That is only true while no module runs code at import time. This note records the audit
for the modules added with the SVG exporter, the shared layout and the shared rules.

Rule applied to every file below: **no top-level side effect**. A file may contain only `import`
and `export` statements, `const` declarations of literals, regular expressions and frozen local
literals, and function or class declarations. Nothing registers, mutates, reads the environment
or touches a global at import time. `Object.freeze` over a literal declared in the same statement is
pure: it neither reaches outside the module nor can be observed by another module.

## `src/svg/`

Cold, offline path; shipped only through the `@trace-kit/renderers/svg` subpath.

| File | Top-level content | Side effect |
|---|---|---|
| `svg/index.ts` | re-exports | none |
| `svg/export-to-svg.ts` | constants, a regular expression, functions | none |
| `svg/normalize-scene.ts` | constants, functions | none |
| `svg/scene.ts` | type declarations only | none |
| `svg/svg-number.ts` | two constants, one function | none |
| `svg/svg-sinks.ts` | two classes | none |
| `svg/svg-writer.ts` | one class | none |
| `svg/escape-xml.ts` | one function | none |

`src/svg/` is deliberately outside the allocation-free lint block that covers `src/path/`: building
strings with template literals and arrays is the exporter's job, and it runs once per export call,
never inside a render loop.

## `src/webgl2/`

Shipped only through the `@trace-kit/renderers/webgl2` subpath. The GLSL sources are string
constants concatenated at module scope by template literals over other constants, which is pure:
nothing reaches a DOM or GL object at import time.

| File | Top-level content | Side effect |
|---|---|---|
| `webgl2/index.ts` | re-exports | none |
| `webgl2/webgl2-figure-renderer.ts` | one class, one function, type declarations | none |
| `webgl2/surfaces.ts` | type declarations, a frozen attribute literal, functions | none |
| `webgl2/gl-context.ts` | type declarations, numeric constants | none |
| `webgl2/shaders.ts` | numeric constants, GLSL string constants built by concatenation | none |
| `webgl2/program.ts` | type declarations, functions | none |
| `webgl2/color.ts` | two regular expressions, functions | none |
| `webgl2/trace-slot.ts` | numeric constants, one class, functions | none |
| `webgl2/upload.ts` | functions | none |
| `webgl2/frame.ts` | numeric constants, one class, functions | none |
| `webgl2/precision.ts` | one constant, one function | none |
| `webgl2/float-bits.ts` | numeric constants, two functions | none |

The allocation-free lint block covers the four files that run on every frame: `frame.ts`,
`upload.ts`, `precision.ts` and `float-bits.ts`. The others (`shaders`, `program`, `color`,
`surfaces`, `trace-slot` and the renderer class) are cold by construction: they compile programs,
create GL objects, parse colors and grow scratch buffers, so they are exempt.

## `src/layout/`

| File | Top-level content | Side effect |
|---|---|---|
| `layout/figure-layout.ts` | constants, a regular expression, a frozen empty-insets literal, functions | none |
| `layout/tick-label.ts` | one function | none |
| `layout/trace-transforms.ts` | one interface, one function | none |

## `src/rules/`

| File | Top-level content | Side effect |
|---|---|---|
| `rules/decimation.ts` | a frozen selection literal, functions | none |
| `rules/trace-style.ts` | a frozen empty dash array, one function | none |

## Font data

`src/font/index.ts` exports `TRACEKIT_INTER_EMBEDDED_FONT`, a frozen two-field literal. The font
entry was already a separate subpath, so the embedded data never loads with the root entry or the
exporter; the exporter receives it only when a caller passes it as `embedFont`.
