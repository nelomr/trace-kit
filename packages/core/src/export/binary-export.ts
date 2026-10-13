/**
 * A binary array export: a synchronous generator of byte chunks. The first chunk carries the
 * format header and the rest carry the data; one export describes one array (one file).
 *
 * A yielded chunk is valid only until the next `next()` call: implementations may back it with
 * a reused scratch buffer, so the same memory is overwritten by the following chunk. Consumers
 * must copy a chunk (`chunk.slice()`) or fully consume it before advancing. Retaining a chunk
 * reference without copying is outside this contract and yields corrupted bytes.
 *
 * Chunks must not be placed in a transfer list: transferring one would detach the shared scratch
 * buffer and break the export mid-stream.
 *
 * Deferred formats, not implemented: HDF5, `.npz` (zip bundles), MATLAB `.mat`, Parquet.
 */
export type BinaryArrayExport = Generator<Uint8Array, void, undefined>;
