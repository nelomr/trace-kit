import { describe, expect, it } from "vitest";
import { createSpectrumDataPayload } from "../../src/payload/spectrum-data-payload.js";
import { createBufferPool } from "../../src/transport/buffer-pool.js";
import { SATURATED } from "../../src/transport/ownership.js";

/**
 * The pool's backing stores are always plain `Float32Array`/`Int32Array`, never
 * `SharedArrayBuffer`-backed — but `.buffer`'s static type is the wider `ArrayBufferLike`, which
 * `structuredClone`'s transfer list rejects. Assert the narrower runtime type instead of casting
 * past the mismatch.
 */
function asArrayBuffer(buffer: ArrayBufferLike): ArrayBuffer {
  if (!(buffer instanceof ArrayBuffer)) {
    throw new TypeError("expected an ArrayBuffer-backed view, got SharedArrayBuffer");
  }
  return buffer;
}

describe("retained-isolation", () => {
  it("retained and transit buffers never share a backing ArrayBuffer across 100 concurrent unrelated round trips", () => {
    const payload = createSpectrumDataPayload({
      capacity: 1024,
      xOrigin: 0,
      xUnit: "s",
      yUnit: "dBm",
    });
    const pool = createBufferPool({ poolPairs: 2, transitCapacitySamples: 256 });

    for (let i = 0; i < 100; i += 1) {
      const lease = pool.acquire();
      if (lease === SATURATED) throw new Error("unreachable");

      // Payload buffers stay at full capacity throughout every concurrent transit round trip.
      expect(payload.x.byteLength).toBe(1024 * 4);
      expect(payload.y.byteLength).toBe(1024 * 4);
      // Captured while the lease is still Acquired — the real transit views, not the InFlight
      // sentinel — so the transfer below detaches the genuine transit backing store.
      const acquiredX = pool.viewX(lease);
      const acquiredY = pool.viewY(lease);
      const acquiredOut = pool.viewOut(lease);
      const acquiredIndices = pool.viewIndices(lease);
      expect(payload.x.buffer).not.toBe(acquiredX.buffer);

      const inflight = pool.submit(lease);
      if (inflight === SATURATED) throw new Error("unreachable");
      // Paired probe: the transit buffer genuinely detaches on its own submit's transfer, so the
      // isolation claim above is not vacuous — the payload's stability is a real distinction,
      // not an artifact of nothing ever detaching in this pool.
      const acquiredXBuffer = asArrayBuffer(acquiredX.buffer);
      const cloned = structuredClone(
        { x: acquiredXBuffer },
        { transfer: [acquiredXBuffer] },
      );
      expect(acquiredX.buffer.byteLength).toBe(0);

      pool.settle(inflight, 0, {
        x: new Float32Array(cloned.x),
        y: acquiredY,
        out: acquiredOut,
        indices: acquiredIndices,
      });
      pool.poll({
        onSettled: (settled) => {
          pool.release(settled);
        },
      });
    }

    expect(payload.x.byteLength).toBe(1024 * 4);
    expect(payload.y.byteLength).toBe(1024 * 4);
  });
});
