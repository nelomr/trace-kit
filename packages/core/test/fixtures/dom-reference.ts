// Regression fixture proving the `core` Vitest project has no DOM globals (CLAUDE.md rule 5).
// Kept committed and permanently unimported; see `test/isomorphism.test.ts` for why.
// Referencing `document` at module scope makes any accidental import of this file fail at
// runtime with `ReferenceError: document is not defined` under the pinned
// `environment: "node"` project.
// @ts-expect-error — intentionally invalid DOM reference under the DOM-free `lib` used by
// this isomorphic package. This file's purpose is to be invalid: it is never imported by
// production code and stays committed, unimported, as a permanent regression asset.
export const domTripwire: HTMLDivElement = document.createElement("div");
