// Ambient type declaration for the plain-JS ownership prototype, which stays `.mjs` and runnable
// with no build step — see `ownership-prototype.mjs`'s own header comment for why. This file
// exists only so `test/transport/ownership-prototype.test.ts` type-checks under
// `tsc -p tsconfig.test.json --noEmit`; it is not part of the published `@trace-kit/core` build.

export interface PrototypeRunOptions {
  mode?: "sync" | "transfer";
  kind?: "MinMaxEnvelope" | "Lttb";
  poolPairs?: number;
  transitCapacitySamples?: number;
  warmupIterations?: number;
  measureIterations?: number;
  deltaSamples?: number;
  stallFrames?: number;
  injectResponderFailure?: boolean;
  __proportionalViewConstructionFixture?: boolean;
}

export interface PrototypeResult {
  mode: string;
  kind: string;
  valid: boolean;
  reason?: string;
  poolPairs: number;
  settledCount: number;
  scavengeEvents: number;
  majorGcEvents: number;
  allocatingControlScavengeEvents: number;
  poolAllocationCountAtCheckpoint: number;
  poolAllocationCountAtEnd: number;
  viewConstructionPerSettlement: number;
  detachedBufferExceptions: number;
  ownershipViolations: number;
  staleSettlements: number;
  remintEvents: number;
  chunksAccepted: number;
  chunksDropped: number;
  maxConsecutiveDrops: number;
  health: "Ready" | "Saturated" | "Stalled" | "Recovering" | "Degraded";
  trippedStalled: boolean;
  violationControl: {
    staleLeaseReads: number;
    detachedBufferExceptions: number;
  };
  throughput: {
    medianRoundTripMs: number;
    baselineMedianMs: number;
    regressionRatio: number;
    withinBudget: boolean;
  };
}

export function runPrototype(options?: PrototypeRunOptions): Promise<PrototypeResult>;
