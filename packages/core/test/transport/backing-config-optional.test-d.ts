// Type-only fixture (shared-array-buffer-capability spec's "The backing is not a required
// configuration field"). This file is never executed by Vitest; its only purpose is `tsc
// --noEmit`.
import { createBufferPool, type BufferPoolConfig } from "../../src/transport/buffer-pool.js";

// Positive control: a config omitting any backing-related field type-checks cleanly — there is
// no such field to omit, proving the config type never grew one.
declare const noBackingField: BufferPoolConfig;
createBufferPool(noBackingField);
createBufferPool({});

// @ts-expect-error — control fixture: `poolPairs` accepts only a number, so a string is a
// genuine type error in this same typecheck run, discriminating "no error because unconstrained"
// from "no error because genuinely optional".
const badControl: BufferPoolConfig = { poolPairs: "not-a-number" };
void badControl;
