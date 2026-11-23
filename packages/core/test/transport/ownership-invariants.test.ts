import { describe, expect, it } from "vitest";
import { createBufferPool } from "../../src/transport/buffer-pool.js";
import { SATURATED } from "../../src/transport/ownership.js";

// Real detach semantics without a Worker: `structuredClone(msg, { transfer })` performs the
// standardised structured-clone transfer steps in-process, detaching every
// ArrayBuffer named in the transfer list — including the pool's own internal views, since they
// are the same object references.

/**
 * Every backing store in this suite is minted by `createBufferPool` as a plain `Float32Array`,
 * never a `SharedArrayBuffer`-backed one — but `.buffer`'s static type is the wider
 * `ArrayBufferLike`, which `structuredClone`'s transfer list (and `Set<ArrayBuffer>`) reject.
 * Assert the narrower runtime type instead of casting past the mismatch.
 */
function asArrayBuffer(buffer: ArrayBufferLike): ArrayBuffer {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new TypeError("expected an ArrayBuffer-backed view, got SharedArrayBuffer");
  }
  return buffer;
}

describe("ownership-invariants — transfer mode", () => {
  it("byteLength is 0 on the sender's pre-existing view immediately after a real transfer, and restored after settle", () => {
    const pool = createBufferPool({ poolPairs: 1 });
    const lease = pool.acquire();
    if (lease === SATURATED) throw new Error("unreachable");

    const xBefore = pool.viewX(lease);
    const yBefore = pool.viewY(lease);
    expect(xBefore.byteLength).toBeGreaterThan(0);

    const inflight = pool.submit(lease);
    if (inflight === SATURATED) throw new Error("unreachable");

    const xBuffer = asArrayBuffer(xBefore.buffer);
    const yBuffer = asArrayBuffer(yBefore.buffer);
    const cloned = structuredClone(
      { x: xBuffer, y: yBuffer },
      { transfer: [xBuffer, yBuffer] },
    );

    // The sender's pre-existing view now reads through a detached buffer.
    expect(xBefore.buffer.byteLength).toBe(0);
    expect(yBefore.buffer.byteLength).toBe(0);

    const newX = new Float32Array(cloned.x);
    const newY = new Float32Array(cloned.y);
    pool.settle(inflight, 0, {
      x: newX,
      y: newY,
      out: pool.viewOut(inflight),
      indices: pool.viewIndices(inflight),
    });

    const xAfter = pool.viewX(inflight);
    expect(xAfter.byteLength).toBeGreaterThan(0);
    expect(xAfter.byteLength).toBe(newX.byteLength);
  });

  it("reading through a pre-existing view after transfer fails (asserted as expected behaviour)", () => {
    const pool = createBufferPool({ poolPairs: 1 });
    const lease = pool.acquire();
    if (lease === SATURATED) throw new Error("unreachable");
    const xBefore = pool.viewX(lease);
    const inflight = pool.submit(lease);
    if (inflight === SATURATED) throw new Error("unreachable");
    structuredClone({ x: asArrayBuffer(xBefore.buffer) }, { transfer: [asArrayBuffer(xBefore.buffer)] });

    expect(() => xBefore[0]).not.toThrow();
    expect(xBefore[0]).toBeUndefined();
    expect(xBefore.byteLength).toBe(0);
  });

  it("preserves slot identity (not a copy) across 100 pooled round trips, allocating 0 new transit ArrayBuffer identities after warm-up", () => {
    const pool = createBufferPool({ poolPairs: 1 });
    const seenBufferIdentities = new Set<ArrayBuffer>();

    for (let i = 0; i < 100; i += 1) {
      const lease = pool.acquire();
      if (lease === SATURATED) throw new Error("unreachable");
      const inflight = pool.submit(lease);
      if (inflight === SATURATED) throw new Error("unreachable");
      // Sync-mode round trip: no real transfer, so the same backing store is reused every time.
      pool.settle(inflight, 0);
      seenBufferIdentities.add(asArrayBuffer(pool.viewX(inflight).buffer));
      pool.poll({
        onSettled: (settled) => {
          pool.release(settled);
        },
      });
    }

    // Warm-up count: 1 (the buffer minted once at pool construction).
    expect(seenBufferIdentities.size).toBe(1);
  });

  it("supports kind-specific partial ReplacementViews preserving untransferred views by reference", () => {
    const pool = createBufferPool({ poolPairs: 1, transitCapacitySamples: 16 });

    // Cycle 1: MinMaxEnvelope — replaces { x, y, out }, preserves viewIndices ===
    const l1 = pool.acquire();
    if (l1 === SATURATED) throw new Error("unreachable");
    const preIndices = pool.viewIndices(l1);
    const f1 = pool.submit(l1);
    if (f1 === SATURATED) throw new Error("unreachable");

    const repX1 = new Float32Array(16);
    const repY1 = new Float32Array(16);
    const repOut1 = new Float32Array(16_384);
    pool.settle(f1, 4, { x: repX1, y: repY1, out: repOut1 });

    let settledOut1: Float32Array | null = null;
    pool.poll({
      onSettled: (settled) => {
        expect(pool.viewX(settled)).toBe(repX1);
        expect(pool.viewY(settled)).toBe(repY1);
        expect(pool.viewOut(settled)).toBe(repOut1);
        expect(pool.viewIndices(settled)).toBe(preIndices);
        settledOut1 = pool.viewOut(settled);
        pool.release(settled);
      },
    });
    expect(settledOut1).toBe(repOut1);

    // Cycle 2: MinMaxEnvelopeIndices — replaces { x, y, indices }, preserves viewOut ===
    const l2 = pool.acquire();
    if (l2 === SATURATED) throw new Error("unreachable");
    const preOut = pool.viewOut(l2);
    expect(preOut).toBe(repOut1);
    const f2 = pool.submit(l2);
    if (f2 === SATURATED) throw new Error("unreachable");

    const repX2 = new Float32Array(16);
    const repY2 = new Float32Array(16);
    const repIdx2 = new Int32Array(16_384);
    pool.settle(f2, 4, { x: repX2, y: repY2, indices: repIdx2 });

    pool.poll({
      onSettled: (settled) => {
        expect(pool.viewX(settled)).toBe(repX2);
        expect(pool.viewY(settled)).toBe(repY2);
        expect(pool.viewOut(settled)).toBe(preOut);
        expect(pool.viewIndices(settled)).toBe(repIdx2);
        pool.release(settled);
      },
    });

    // Cycle 3: Lttb — replaces all 4 views { x, y, out, indices }
    const l3 = pool.acquire();
    if (l3 === SATURATED) throw new Error("unreachable");
    const f3 = pool.submit(l3);
    if (f3 === SATURATED) throw new Error("unreachable");

    const repX3 = new Float32Array(16);
    const repY3 = new Float32Array(16);
    const repOut3 = new Float32Array(16_384);
    const repIdx3 = new Int32Array(16_384);
    pool.settle(f3, 4, { x: repX3, y: repY3, out: repOut3, indices: repIdx3 });

    pool.poll({
      onSettled: (settled) => {
        expect(pool.viewX(settled)).toBe(repX3);
        expect(pool.viewY(settled)).toBe(repY3);
        expect(pool.viewOut(settled)).toBe(repOut3);
        expect(pool.viewIndices(settled)).toBe(repIdx3);
        pool.release(settled);
      },
    });
  });
});
