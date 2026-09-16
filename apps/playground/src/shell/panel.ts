import { Pane } from "tweakpane";

export type { BindingScope } from "./binding-scope.js";
export { withBindingScope } from "./binding-scope.js";

// Exactly one tweakpane Pane at module scope: every view receives this
// same reference through `ViewHost.panel`, so a control contributed by one view and removed
// on unmount never leaves a second, orphaned panel instance behind. Requires a real DOM —
// deliberately NOT imported by the buffer-ownership module (`mount.ts`'s `createCoreMathState`
// uses `binding-scope.ts` directly instead), so that module stays importable from a Node test.
export const sharedPanel = new Pane();
