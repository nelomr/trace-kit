/**
 * Canvas double for one stacked surface: a size, a recorded `getContext` that hands out a supplied
 * context (or `null`, to exercise the unavailable-context errors) and a recorded
 * `addEventListener`. Nothing is stubbed globally; `asSurface` is the one boundary where the
 * structural double is presented as the DOM host type the renderer's options declare.
 */
import type { Canvas2DSurface } from "../../../src/surface.js";

export interface GetContextCall {
  readonly id: string;
  readonly attributes: unknown;
}

export class FakeSurface<TContext extends object> {
  width = 0;
  height = 0;
  readonly getContextCalls: GetContextCall[] = [];
  readonly listeners: string[] = [];
  readonly #context: TContext | null;

  constructor(context: TContext | null) {
    this.#context = context;
  }

  getContext(id: string, attributes?: unknown): TContext | null {
    this.getContextCalls.push({ id, attributes });
    return this.#context;
  }

  addEventListener(type: string, listener: () => void): void {
    void listener;
    this.listeners.push(type);
  }
}

export function asSurface(surface: FakeSurface<object>): Canvas2DSurface {
  // eslint-disable-next-line no-restricted-syntax -- test double for a DOM host unavailable under `node`
  return surface as unknown as Canvas2DSurface;
}
