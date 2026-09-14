// Permanent regression fixture (deliberately violating the rule) for the transport module's
// source-level gate: no `new Worker(` and no module-scope `Worker`/`self` reference anywhere
// under `packages/core/src/**`. Ignored by the main `eslint .`/build run
// (`**/test/fixtures/**`); `isomorphism.test.ts` scans this file's own text directly to prove the
// scanning check is live against a genuine violation.
export const capturedWorkerType: typeof Worker = Worker;

export function makeWorker(url: string): Worker {
  return new Worker(url);
}
