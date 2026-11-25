// Permanent regression fixture verified by `packages/react/test/node/react-build.test.ts`
// under ESLint Node API (including `CI=true` singleRun mode).
export function lintFixtureViolation(x: any): number {
  return x as unknown as number;
}
