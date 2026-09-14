import { PerformanceObserver } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { createSyncDecimationPort } from "../../src/transport/sync-port.js";
import { createBufferPool } from "../../src/transport/buffer-pool.js";
import { DecimationKind } from "../../src/transport/decimation-port.js";
import { type Lease, SATURATED } from "../../src/transport/ownership.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function measureGcEvents(run: () => void, iterations: number): Promise<number> {
  let count = 0;
  const observer = new PerformanceObserver((list) => {
    count += list.getEntries().length;
  });
  observer.observe({ entryTypes: ["gc"] });

  for (let i = 0; i < 200; i += 1) run();

  globalThis.gc?.();
  await sleep(30);
  count = 0;

  for (let i = 0; i < iterations; i += 1) run();

  await sleep(30);
  observer.disconnect();
  return count;
}

describe.sequential("allocation-gate — synchronous port round trip", () => {
  it("an allocating control variant (fresh sink object per call, retained) reports > 0 GC events", async () => {
    const port = createSyncDecimationPort({ poolPairs: 3, transitCapacitySamples: 4_096 });
    // Retaining every allocated sink in `garbage` (instead of discarding it) prevents V8's
    // escape analysis from scalar-replacing the object away, which is what made an earlier,
    // discarded-object version of this control read a false 0.
    let garbage: Array<{ onSettled: (lease: number) => void; padding: number[] }> = [];
    const count = await measureGcEvents(() => {
      const lease = port.acquire();
      if (lease === SATURATED) return;
      port.setKind(lease, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(lease, 0);
      port.setBucketCount(lease, 0);
      port.submit(lease);
      // A substantially heavier per-call allocation than the pool's own bookkeeping, retained
      // (not discarded) so escape analysis cannot scalar-replace it away — enough garbage
      // volume over 10,000 iterations to guarantee at least one scavenge.
      for (let i = 0; i < 64; i += 1) {
        garbage.push({
          onSettled: (l: number) => port.release(l as Lease<"settled">),
          padding: [1, 2, 3, 4],
        });
      }
      const sink = garbage[garbage.length - 1]!;
      if (garbage.length > 50_000) garbage = [];
      port.poll(sink);
    }, 10_000);
    expect(count).toBeGreaterThan(0);
  });

  it("10,000 acquire/submit/poll/release cycles report exactly 0 GC events after warm-up", async () => {
    const port = createSyncDecimationPort({ poolPairs: 3, transitCapacitySamples: 4_096 });
    const sink = {
      onSettled(lease: number) {
        port.release(lease as Lease<"settled">);
      },
    };
    const count = await measureGcEvents(() => {
      const lease = port.acquire();
      if (lease === SATURATED) return;
      port.setKind(lease, DecimationKind.MinMaxEnvelope);
      port.setSampleCount(lease, 0);
      port.setBucketCount(lease, 0);
      port.submit(lease);
      port.poll(sink);
    }, 10_000);
    expect(count).toBe(0);
  });

  it("the deadline sweep's scratch buffer is identity-stable across many genuine timeouts", () => {
    // Unlike the two GC-instrumented cases above, this drives the timeout branch of
    // `sweepDeadlines` for real: every cycle below submits a lease, advances the clock past
    // `leaseTimeoutMs`, and re-acquires, which forces a slot to actually time out and get
    // re-minted. A real timeout re-mints backing buffers for the failed slot (a legitimate,
    // bounded allocation, not under test here); what this asserts is that the sweep's own
    // bookkeeping — finding which slots timed out — never allocates a fresh array to do it.
    // If it did, `__debugSweepScratchRef()` would return a different object after every sweep
    // that found a timeout; a V8 GC-event count can't isolate this from the legitimate re-mint
    // allocation, since both happen on the same call, so identity is the precise signal.
    let clock = 0;
    const pool = createBufferPool({ poolPairs: 1, maxRemintEvents: 100_000, now: () => clock });
    const before = pool.__debugSweepScratchRef();

    for (let i = 0; i < 500; i += 1) {
      const lease = pool.acquire();
      if (lease === SATURATED) continue;
      pool.submit(lease);
      clock += 2_000; // past the 1000ms default lease timeout
      pool.acquire(); // runs sweepDeadlines(), which finds and re-mints the timed-out slot
    }

    const after = pool.__debugSweepScratchRef();
    expect(after).toBe(before);
  });
});
