// Type-only fixture (spectrum-data-payload spec's "The transport protocol cannot place a
// payload buffer in a transfer list"; buffer-ownership-protocol spec's brand-level enforcement).
// This file is never executed by Vitest; its only purpose is `tsc --noEmit`.
import type { Retained, TransitXBuffer } from "../../src/buffers/brand.js";
import { collectTransferList } from "../../src/transport/ownership.js";

declare const retainedX: Retained<Float32Array>;
declare const transitX: TransitXBuffer;
const out: ArrayBufferLike[] = [];

// Positive control: a Transit buffer type-checks cleanly against the transfer-list builder.
collectTransferList([transitX], out);

// @ts-expect-error — Retained<Float32Array> is not assignable to TransferableBacking; the
// authoritative main-thread copy must never be placeable in a transfer list.
collectTransferList([retainedX], out);
