/**
 * DOM-free structural worker contracts and typed wire-protocol discriminated unions.
 *
 * Deliberately avoids ambient DOM or WebWorker globals so `@trace-kit/core` compiles under
 * `"lib": ["ES2022"]` while keeping native browser workers and `@trace-kit/core/node` adapters
 * structurally assignable with zero casts.
 */
import type { DecimationKind } from "./decimation-port.js";

export interface WorkerMessageEventLike {
  readonly data: unknown;
}

export interface WorkerLike {
  postMessage(message: unknown): void;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  terminate(): void | Promise<number>;
  addEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
  addEventListener(type: "messageerror", listener: (event: unknown) => void): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  removeEventListener(type: "error", listener: (event: unknown) => void): void;
  removeEventListener(type: "messageerror", listener: (event: unknown) => void): void;
}

export type WorkerFactory = () => WorkerLike;

export interface WorkerMessageEndpoint {
  postMessage(message: unknown): void;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  addEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
}

export interface WorkerWorkMessage {
  readonly type: "work";
  readonly lease: number;
  readonly workerEpoch: number;
  readonly kind: DecimationKind;
  readonly sampleCount: number;
  readonly bucketCount: number;
  readonly domainMin: number;
  readonly domainMax: number;
  readonly x: ArrayBuffer;
  readonly y: ArrayBuffer;
  readonly out?: ArrayBuffer;
  readonly indices?: ArrayBuffer;
}

export interface WorkerInitSabMessage {
  readonly type: "init-sab";
  readonly version: 1;
  readonly workerEpoch: number;
  readonly controlSab: SharedArrayBuffer;
  readonly dataSab: SharedArrayBuffer;
}

export interface WorkerDisposeMessage {
  readonly type: "dispose";
}

export interface WorkerReadyMessage {
  readonly type: "ready";
  readonly workerEpoch: number;
}

export interface WorkerResultMessage {
  readonly type: "result";
  readonly lease: number;
  readonly workerEpoch: number;
  readonly kind: DecimationKind;
  readonly outCount: number;
  readonly x: ArrayBuffer;
  readonly y: ArrayBuffer;
  readonly out?: ArrayBuffer;
  readonly indices?: ArrayBuffer;
}

export interface WorkerErrorMessage {
  readonly type: "error";
  readonly lease: number;
  readonly workerEpoch: number;
  readonly code: string;
  readonly message: string;
}

export type WorkerInboundMessage =
  | WorkerWorkMessage
  | WorkerInitSabMessage
  | WorkerDisposeMessage;

export type WorkerOutboundMessage =
  | WorkerReadyMessage
  | WorkerResultMessage
  | WorkerErrorMessage;
