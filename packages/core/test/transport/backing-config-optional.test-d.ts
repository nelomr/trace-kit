// Type-only fixture (shared-array-buffer-capability & worker-decimation-port specs).
// This file is never executed by Vitest; its only purpose is `tsc --noEmit`.
import { createBufferPool, type BufferPoolConfig } from "../../src/transport/buffer-pool.js";
import type { WorkerFactory, WorkerLike } from "../../src/transport/worker-channel.js";
import {
  createWorkerDecimationPort,
  type WorkerDecimationPortConfig,
} from "../../src/transport/worker-port.js";

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

// WorkerDecimationPortConfig requires `workerFactory` and requires no backing field.
declare const factory: WorkerFactory;
const validWorkerConfig: WorkerDecimationPortConfig = { workerFactory: factory };
createWorkerDecimationPort(validWorkerConfig);
createWorkerDecimationPort({ workerFactory: factory, poolPairs: 3 });

// @ts-expect-error — `workerFactory` is required on WorkerDecimationPortConfig.
createWorkerDecimationPort({});

// @ts-expect-error — WorkerDecimationPortConfig must not expose a `backing` field.
const badWorkerBacking: WorkerDecimationPortConfig = { workerFactory: factory, backing: 0 };
void badWorkerBacking;

// Browser-shaped Worker mock (matching DOM Worker's dual postMessage overloads) satisfies
// `WorkerLike` structurally with zero casts.
declare const browserWorkerMock: {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  postMessage(message: unknown, options?: { transfer?: ArrayBuffer[] }): void;
  terminate(): void;
  addEventListener(type: string, listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(type: string, listener: (event: { readonly data: unknown }) => void): void;
};
const asWorkerLike: WorkerLike = browserWorkerMock;
const browserFactory: WorkerFactory = () => asWorkerLike;
createWorkerDecimationPort({ workerFactory: browserFactory });
