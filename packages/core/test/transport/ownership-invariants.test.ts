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
});
