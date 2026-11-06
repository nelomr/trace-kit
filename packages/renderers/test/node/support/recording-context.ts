/**
 * Recording doubles for the Canvas2D drawing seam. `RecordingContext` logs every method call and
 * every property assignment with its arguments in one ordered list, and `RecordingPath2D` logs
 * the path commands plus a registry of every instance the renderer constructed, so a test can
 * assert both what was stroked or filled and what coordinates the path was built from.
 */
export interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
  /** Line dash in effect when a `stroke` was issued; kept off `args`, which tests use to tell
   * a trace stroke (one path argument) from a gridline or axis stroke. */
  readonly lineDash?: readonly number[];
}

interface SavedState {
  readonly lineDash: readonly number[];
  readonly strokeStyle: string;
  readonly lineWidth: number;
  readonly fillStyle: string;
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
  #textAlign: CanvasTextAlign = "start";
  #textBaseline: CanvasTextBaseline = "alphabetic";
  lineJoin: CanvasLineJoin = "miter";
  #lineDash: readonly number[] = [];
  readonly #stack: SavedState[] = [];

  /** The dash currently in effect, as `save`/`restore`/`setLineDash` leave it. */
  get lineDash(): readonly number[] {
    return this.#lineDash;
  }

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
  get textAlign(): CanvasTextAlign {
    return this.#textAlign;
  }
  set textAlign(value: CanvasTextAlign) {
    this.#textAlign = value;
  }
  get textBaseline(): CanvasTextBaseline {
    return this.#textBaseline;
  }
  set textBaseline(value: CanvasTextBaseline) {
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
    this.calls.push({
      name: "stroke",
      args: path === undefined ? [] : [path],
      lineDash: this.#lineDash.slice(),
    });
  }
  fillText(text: string, x: number, y: number): void {
    this.calls.push({ name: "fillText", args: [text, x, y] });
  }
  setLineDash(segments: number[]): void {
    this.#lineDash = segments.slice();
    this.calls.push({ name: "setLineDash", args: [segments] });
  }
  fill(path?: unknown): void {
    this.calls.push({ name: "fill", args: path === undefined ? [] : [path] });
  }
  save(): void {
    this.#stack.push({
      lineDash: this.#lineDash,
      strokeStyle: this.#strokeStyle,
      lineWidth: this.#lineWidth,
      fillStyle: this.#fillStyle,
    });
    this.calls.push({ name: "save", args: [] });
  }
  restore(): void {
    // Like the DOM, a restore with nothing saved changes nothing, and a real restore reassigns
    // the state silently: it is not a property write, so it is not recorded as one.
    const saved = this.#stack.pop();
    if (saved !== undefined) {
      this.#lineDash = saved.lineDash;
      this.#strokeStyle = saved.strokeStyle;
      this.#lineWidth = saved.lineWidth;
      this.#fillStyle = saved.fillStyle;
    }
    this.calls.push({ name: "restore", args: [] });
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.calls.push({ name: "rect", args: [x, y, w, h] });
  }
  clip(): void {
    this.calls.push({ name: "clip", args: [] });
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
