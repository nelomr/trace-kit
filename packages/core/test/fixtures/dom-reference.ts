// Regression fixture proving the `core` Vitest project has no DOM globals (design.md §D5
// layer 2 — CLAUDE.md rule 5). Kept committed and permanently unimported; see
// `test/isomorphism.test.ts` for why. Referencing `document` at module scope makes any
// accidental import of this file fail at runtime with `ReferenceError: document is not
// defined` under the pinned `environment: "node"` project.
// @ts-expect-error — intentionally invalid DOM reference under the DOM-free `lib`
// (design.md §D5 layer 3). This file's purpose is to be invalid: it is imported only
// transiently by test 1.5's RED observation and stays committed, unimported, as a
// permanent regression asset.
export const domTripwire: HTMLDivElement = document.createElement("div");
