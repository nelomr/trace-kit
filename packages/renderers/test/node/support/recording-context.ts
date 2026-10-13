/**
 * Recording doubles for the Canvas2D drawing seam. `RecordingContext` logs every method call and
 * every property assignment with its arguments in one ordered list, and `RecordingPath2D` logs
 * the path commands plus a registry of every instance the renderer constructed, so a test can
 * assert both what was stroked or filled and what coordinates the path was built from.
 */
export interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

export class RecordingPath2D {
  static created: RecordingPath2D[] = [];
  readonly ops: RecordedCall[] = [];

  constructor() {
    RecordingPath2D.created.push(this);
  }

  moveTo(x: number, y: number): void {
    this.ops.push({ name: "moveTo", args: [x, y] });
  }

  lineTo(x: number, y: number): void {
    this.ops.push({ name: "lineTo", args: [x, y] });
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ name: "rect", args: [x, y, w, h] });
  }
}

export class RecordingContext {
  readonly calls: RecordedCall[] = [];
  #fillStyle = "";
  #strokeStyle = "";
  #lineWidth = 1;
  #font = "";
  #textAlign = "start";
  #textBaseline = "alphabetic";
  lineJoin = "miter";

  get fillStyle(): string {
    return this.#fillStyle;
  }
  set fillStyle(value: string) {
    this.#fillStyle = value;
    this.calls.push({ name: "set fillStyle", args: [value] });
  }
  get strokeStyle(): string {
    return this.#strokeStyle;
  }
  set strokeStyle(value: string) {
    this.#strokeStyle = value;
    this.calls.push({ name: "set strokeStyle", args: [value] });
  }
  get lineWidth(): number {
    return this.#lineWidth;
  }
  set lineWidth(value: number) {
    this.#lineWidth = value;
    this.calls.push({ name: "set lineWidth", args: [value] });
  }
  get font(): string {
    return this.#font;
  }
  set font(value: string) {
    this.#font = value;
  }
  get textAlign(): string {
    return this.#textAlign;
  }
  set textAlign(value: string) {
    this.#textAlign = value;
  }
  get textBaseline(): string {
    return this.#textBaseline;
  }
  set textBaseline(value: string) {
    this.#textBaseline = value;
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.calls.push({ name: "setTransform", args: [a, b, c, d, e, f] });
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ name: "fillRect", args: [x, y, w, h] });
  }
  beginPath(): void {
    this.calls.push({ name: "beginPath", args: [] });
  }
  moveTo(x: number, y: number): void {
    this.calls.push({ name: "moveTo", args: [x, y] });
  }
  lineTo(x: number, y: number): void {
    this.calls.push({ name: "lineTo", args: [x, y] });
  }
  stroke(path?: unknown): void {
    this.calls.push({ name: "stroke", args: path === undefined ? [] : [path] });
  }
  fillText(text: string, x: number, y: number): void {
    this.calls.push({ name: "fillText", args: [text, x, y] });
  }
  setLineDash(segments: number[]): void {
    this.calls.push({ name: "setLineDash", args: [segments] });
  }
  fill(path?: unknown): void {
    this.calls.push({ name: "fill", args: path === undefined ? [] : [path] });
  }
}

/** Installs `RecordingPath2D` as the global `Path2D` and returns the restore function. */
export function installRecordingPath2D(): () => void {
  const original = (globalThis as Record<string, unknown>)["Path2D"];
  RecordingPath2D.created = [];
  (globalThis as Record<string, unknown>)["Path2D"] = RecordingPath2D;
  return () => {
    (globalThis as Record<string, unknown>)["Path2D"] = original;
  };
}

export function recordingSurface(context: RecordingContext): HTMLCanvasElement {
  const canvas = { getContext: () => context };
  // eslint-disable-next-line no-restricted-syntax -- test double for a DOM host unavailable under `node`
  return canvas as unknown as HTMLCanvasElement;
}

export interface LineSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Pairs each `moveTo` on the context with the `lineTo` that follows it. */
export function contextSegments(calls: readonly RecordedCall[]): LineSegment[] {
  const out: LineSegment[] = [];
  for (let i = 0; i + 1 < calls.length; i += 1) {
    const a = calls[i];
    const b = calls[i + 1];
    if (a?.name === "moveTo" && b?.name === "lineTo") {
      out.push({
        x1: Number(a.args[0]),
        y1: Number(a.args[1]),
        x2: Number(b.args[0]),
        y2: Number(b.args[1]),
      });
    }
  }
  return out;
}
