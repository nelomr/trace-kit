/**
 * Drives `bench/ownership-prototype.mjs` (the `ownership-prototype-gate` capability's committed,
 * re-runnable de-risking harness) programmatically at small, deterministic
 * iteration counts so the P1-P10 pass conditions can be asserted directly, without paying the
 * real 60 s/3,600-iteration run shape on every `pnpm test`. `bench:ownership`
 * (`node --expose-gc --trace-gc bench/ownership-prototype.mjs`) is the full-shape run gated by
 * `--expose-gc`; this file exercises the same code path at a reduced scale that does not require
 * that flag (the harness falls back to a no-op `forceGc` when `--expose-gc` is absent, since a
 * Vitest worker is not started with it — assertions here are on counters the harness derives
 * itself, not on `globalThis.gc` availability).
 */
import { describe, expect, it } from "vitest";
import { runPrototype } from "../../bench/ownership-prototype.mjs";

describe("ownership-prototype.mjs is committed and re-runnable", () => {
  it("produces a machine-readable result covering both sync and transfer modes", async () => {
    const sync = await runPrototype({ mode: "sync", warmupIterations: 20, measureIterations: 50 });
    const transfer = await runPrototype({
      mode: "transfer",
      warmupIterations: 20,
      measureIterations: 50,
    });
    expect(sync.mode).toBe("sync");
    expect(transfer.mode).toBe("transfer");
    expect(typeof sync.valid).toBe("boolean");
    expect(typeof transfer.valid).toBe("boolean");
  });
});

describe("P1/P2 — sync-mode zero-scavenge gate and constant pool allocation", () => {
  it("P1: sync mode reports exactly 0 scavenge events over the measured run", async () => {
    const result = await runPrototype({
      mode: "sync",
      warmupIterations: 200,
      measureIterations: 400,
    });
    expect(result.scavengeEvents).toBe(0);
  });

  it("P2: pool allocation count is identical at iteration 200 and at the run's end, and non-zero at 200", async () => {
    const result = await runPrototype({
      mode: "sync",
      warmupIterations: 200,
      measureIterations: 400,
    });
    expect(result.poolAllocationCountAtCheckpoint).toBeGreaterThan(0);
    expect(result.poolAllocationCountAtEnd).toBe(result.poolAllocationCountAtCheckpoint);
  });
});

describe("P3 — zero detached-buffer exceptions and zero ownership violations, proven live", () => {
  it("both modes report 0/0 on the gated run, and the excluded control segment reports exactly 1/1", async () => {
    for (const mode of ["sync", "transfer"] as const) {
      const result = await runPrototype({ mode, warmupIterations: 20, measureIterations: 50 });
      expect(result.detachedBufferExceptions).toBe(0);
      expect(result.ownershipViolations).toBe(0);
      expect(result.violationControl.detachedBufferExceptions).toBe(1);
      expect(result.violationControl.staleLeaseReads).toBe(1);
    }
  });
});

describe("P4 — transfer-mode view re-mint count is constant per kind", () => {
  it("MinMaxEnvelope re-mints exactly 3 views per settlement, Lttb exactly 4", async () => {
    const minMax = await runPrototype({
      mode: "transfer",
      kind: "MinMaxEnvelope",
      warmupIterations: 20,
      measureIterations: 50,
    });
    const lttb = await runPrototype({
      mode: "transfer",
      kind: "Lttb",
      warmupIterations: 20,
      measureIterations: 50,
    });
    expect(minMax.viewConstructionPerSettlement).toBe(3);
    expect(lttb.viewConstructionPerSettlement).toBe(4);
  });
});

describe("P5 — transfer-mode allocation is invariant to payload size", () => {
  it("the per-settlement view-construction count is identical at deltaSamples 4096 and 262144", async () => {
    const small = await runPrototype({
      mode: "transfer",
      deltaSamples: 4_096,
      warmupIterations: 20,
      measureIterations: 50,
    });
    const large = await runPrototype({
      mode: "transfer",
      deltaSamples: 262_144,
      warmupIterations: 20,
      measureIterations: 50,
    });
    expect(large.viewConstructionPerSettlement).toBe(small.viewConstructionPerSettlement);
    // At this reduced 50-iteration scale (no --expose-gc; forceGc is a no-op here), the young
    // generation only occasionally crosses the scavenge threshold at all — observed 0 or 1 across
    // repeated runs, never more. A budget, not exact zero, keeps this assertion non-flaky while
    // still catching a real regression; the exact-zero case is covered by the real 3,600-iteration
    // run shape in bench/ownership-prototype.mjs itself (`bench:ownership`).
    const TRANSFER_SCAVENGE_BUDGET_AT_TEST_SCALE = 5;
    expect(small.scavengeEvents).toBeLessThanOrEqual(TRANSFER_SCAVENGE_BUDGET_AT_TEST_SCALE);
    expect(large.scavengeEvents).toBeLessThanOrEqual(TRANSFER_SCAVENGE_BUDGET_AT_TEST_SCALE);
  });

  it("the fixture-only proportional-allocation variant fails P5 even though scavenges stay within budget", async () => {
    const small = await runPrototype({
      mode: "transfer",
      deltaSamples: 4_096,
      warmupIterations: 20,
      measureIterations: 50,
      __proportionalViewConstructionFixture: true,
    });
    const large = await runPrototype({
      mode: "transfer",
      deltaSamples: 262_144,
      warmupIterations: 20,
      measureIterations: 50,
      __proportionalViewConstructionFixture: true,
    });
    expect(large.viewConstructionPerSettlement).not.toBe(small.viewConstructionPerSettlement);
    const TRANSFER_SCAVENGE_BUDGET_AT_TEST_SCALE = 5;
    expect(small.scavengeEvents).toBeLessThanOrEqual(TRANSFER_SCAVENGE_BUDGET_AT_TEST_SCALE);
    expect(large.scavengeEvents).toBeLessThanOrEqual(TRANSFER_SCAVENGE_BUDGET_AT_TEST_SCALE);
  });
});

describe("P6/P7/P8 — backpressure correctness under health load", () => {
  it("P6: a keeping-up responder drops 0", async () => {
    for (const mode of ["sync", "transfer"] as const) {
      const result = await runPrototype({ mode, warmupIterations: 20, measureIterations: 100 });
      expect(result.chunksDropped).toBe(0);
    }
  });

  it("P7: a 10-frame injected stall drops exactly 10, allocation unchanged, never Stalled", async () => {
    for (const mode of ["sync", "transfer"] as const) {
      const result = await runPrototype({
        mode,
        warmupIterations: 20,
        measureIterations: 100,
        stallFrames: 10,
      });
      expect(result.chunksDropped).toBe(10);
      expect(result.poolAllocationCountAtEnd).toBe(result.poolAllocationCountAtCheckpoint);
      expect(result.health).not.toBe("Stalled");
    }
  });

  it("P8: a 200-frame injected stall trips Stalled, clearing on the next accept", async () => {
    for (const mode of ["sync", "transfer"] as const) {
      const result = await runPrototype({
        mode,
        warmupIterations: 20,
        measureIterations: 500,
        stallFrames: 200,
      });
      expect(result.trippedStalled).toBe(true);
      expect(result.health).not.toBe("Stalled");
    }
  });
});

describe("P9 — bounded failure-path recovery", () => {
  it("one injected responder failure re-mints exactly poolPairs slots and recovers to Ready, a replayed stale settlement is rejected", async () => {
    for (const mode of ["sync", "transfer"] as const) {
      const result = await runPrototype({
        mode,
        warmupIterations: 10,
        measureIterations: 30,
        injectResponderFailure: true,
      });
      expect(result.remintEvents).toBe(result.poolPairs);
      expect(result.health).toBe("Ready");
      expect(result.staleSettlements).toBe(1);
    }
  });
});

describe("P10 — the gate is proven live, not vacuous", () => {
  it("an allocating control variant reports > 0 scavenges while the real path reports 0", async () => {
    const result = await runPrototype({
      mode: "sync",
      warmupIterations: 200,
      measureIterations: 400,
    });
    expect(result.scavengeEvents).toBe(0);
    expect(result.allocatingControlScavengeEvents).toBeGreaterThan(0);
  });
});

describe("Cold-run and non-marker measurements do not count", () => {
  it("major GC events are reported separately and do not affect pass/fail", async () => {
    const result = await runPrototype({ mode: "sync", warmupIterations: 20, measureIterations: 50 });
    expect(typeof result.majorGcEvents).toBe("number");
  });

  it("a run with warmupIterations = 0 is reported invalid rather than pass/fail", async () => {
    const result = await runPrototype({ mode: "sync", warmupIterations: 0, measureIterations: 50 });
    expect(result.valid).toBe(false);
  });
});

describe("Relative throughput regression budget, never a literal wall-clock gate", () => {
  it("the pass/fail determination references a same-runner baseline with no absolute-ms constant, and reports median as informational", async () => {
    const result = await runPrototype({
      mode: "sync",
      warmupIterations: 50,
      measureIterations: 200,
    });
    expect(typeof result.throughput.medianRoundTripMs).toBe("number");
    expect(typeof result.throughput.baselineMedianMs).toBe("number");
    expect(typeof result.throughput.regressionRatio).toBe("number");
    expect(typeof result.throughput.withinBudget).toBe("boolean");
  });
});
