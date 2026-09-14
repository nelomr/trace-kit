// Regression fixture proving the `core` Vitest project has no DOM globals.
// The bare `document` reference at module scope makes importing this file fail at runtime with
// `ReferenceError: document is not defined` under the pinned `environment: "node"` project.
// `isomorphism.test.ts` imports it and asserts exactly that, so the tripwire is proven live
// rather than merely committed. It type-checks cleanly because the test project enables the DOM
// lib; the production package builds against a DOM-free lib and never includes this directory.
export const domTripwire: HTMLDivElement = document.createElement("div");
