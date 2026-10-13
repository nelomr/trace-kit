/**
 * Recording double for the `Gl2Context` seam. Every call is logged in one ordered list with a
 * `gl.` prefix; passing a 2D recording's `calls` array as `log` interleaves GL and 2D calls in a
 * single ordered sequence without touching `RecordingContext`. Buffer uploads keep both the data
 * reference (so a test can prove no copy was made) and a snapshot of the uploaded range (so a test
 * can prove what the GPU would have received even if the source is mutated afterwards).
 *
 * The object classes are empty-shaped, which is all lib.dom's `WebGLBuffer` and friends are, so no
 * cast is needed anywhere.
 */
import type { RecordedCall } from "./recording-context.js";
import type { Gl2Context, LoseContextExtension } from "../../../src/webgl2/gl-context.js";
import {
  GL_ARRAY_BUFFER,
  GL_COMPILE_STATUS,
  GL_LINK_STATUS,
} from "../../../src/webgl2/gl-context.js";

export type FakeGlKind = "buffer" | "vertexArray" | "program" | "shader" | "texture";

export class FakeGlObject {
  constructor(
    readonly kind: FakeGlKind,
    readonly id: number,
  ) {}
}

export class FakeUniformLocation {
  readonly kind = "uniform";
  constructor(readonly name: string) {}
}

export interface RecordingGl2Options {
  readonly log?: RecordedCall[];
  readonly compileFailureLog?: string;
  readonly linkFailureLog?: string;
  /** Defaults to `true`; `false` makes `getExtension("WEBGL_lose_context")` return `null`. */
  readonly loseContextExtension?: boolean;
}

export interface BufferUpload {
  readonly buffer: FakeGlObject | null;
  readonly target: number;
  readonly data: ArrayBufferView;
  readonly srcOffset: number;
  readonly length: number;
  readonly snapshot: Float32Array;
}

type KindCounts = Record<FakeGlKind, number>;

function zeroCounts(): KindCounts {
  return { buffer: 0, vertexArray: 0, program: 0, shader: 0, texture: 0 };
}

export class RecordingGl2Context implements Gl2Context {
  readonly log: RecordedCall[];
  /** When `false` no call is logged and no snapshot is taken, so a GC gate sees only the fake's
   * own bookkeeping of object lifetimes. */
  recording = true;
  readonly created: KindCounts = zeroCounts();
  readonly deleted: KindCounts = zeroCounts();
  readonly live = new Set<FakeGlObject>();

  readonly #compileFailureLog: string | undefined;
  readonly #linkFailureLog: string | undefined;
  readonly #loseContextExtension: boolean;
  readonly #uploads: BufferUpload[] = [];
  readonly #uniforms: { name: string; values: number[] }[] = [];
  readonly #shaderSources = new Map<FakeGlObject, string>();
  #nextId = 1;
  #boundArrayBuffer: FakeGlObject | null = null;
  readonly #loseContext: LoseContextExtension;

  constructor(options: RecordingGl2Options = {}) {
    this.log = options.log ?? [];
    this.#compileFailureLog = options.compileFailureLog;
    this.#linkFailureLog = options.linkFailureLog;
    this.#loseContextExtension = options.loseContextExtension ?? true;
    this.#loseContext = {
      loseContext: () => {
        this.#record("loseContext", []);
      },
    };
  }

  #record(name: string, args: readonly unknown[]): void {
    if (!this.recording) return;
    this.log.push({ name: `gl.${name}`, args });
  }

  #create(kind: FakeGlKind): FakeGlObject {
    const object = new FakeGlObject(kind, this.#nextId);
    this.#nextId += 1;
    this.created[kind] += 1;
    this.live.add(object);
    return object;
  }

  #delete(object: FakeGlObject | null): void {
    if (object === null || !this.live.has(object)) return;
    this.live.delete(object);
    this.deleted[object.kind] += 1;
  }

  callsNamed(name: string): RecordedCall[] {
    const full = name.startsWith("gl.") ? name : `gl.${name}`;
    return this.log.filter((call) => call.name === full);
  }

  /** The values of every `uniform*v` call that targeted `uniformName`, in call order. */
  uniformValues(uniformName: string): number[][] {
    return this.#uniforms.filter((entry) => entry.name === uniformName).map((entry) => entry.values);
  }

  bufferUploads(): BufferUpload[] {
    return this.#uploads;
  }

  liveCount(kind: FakeGlKind): number {
    let count = 0;
    for (const object of this.live) if (object.kind === kind) count += 1;
    return count;
  }

  shaderSourceOf(shader: WebGLShader): string | undefined {
    return shader instanceof FakeGlObject ? this.#shaderSources.get(shader) : undefined;
  }

  createShader(type: number): WebGLShader | null {
    this.#record("createShader", [type]);
    return this.#create("shader");
  }
  shaderSource(shader: WebGLShader, source: string): void {
    this.#record("shaderSource", [shader, source]);
    if (shader instanceof FakeGlObject) this.#shaderSources.set(shader, source);
  }
  compileShader(shader: WebGLShader): void {
    this.#record("compileShader", [shader]);
  }
  getShaderParameter(shader: WebGLShader, pname: number): unknown {
    this.#record("getShaderParameter", [shader, pname]);
    return pname === GL_COMPILE_STATUS ? this.#compileFailureLog === undefined : undefined;
  }
  getShaderInfoLog(shader: WebGLShader): string | null {
    this.#record("getShaderInfoLog", [shader]);
    return this.#compileFailureLog ?? "";
  }
  deleteShader(shader: WebGLShader | null): void {
    this.#record("deleteShader", [shader]);
    if (shader instanceof FakeGlObject) this.#delete(shader);
  }

  createProgram(): WebGLProgram {
    this.#record("createProgram", []);
    return this.#create("program");
  }
  attachShader(program: WebGLProgram, shader: WebGLShader): void {
    this.#record("attachShader", [program, shader]);
  }
  detachShader(program: WebGLProgram, shader: WebGLShader): void {
    this.#record("detachShader", [program, shader]);
  }
  linkProgram(program: WebGLProgram): void {
    this.#record("linkProgram", [program]);
  }
  getProgramParameter(program: WebGLProgram, pname: number): unknown {
    this.#record("getProgramParameter", [program, pname]);
    return pname === GL_LINK_STATUS ? this.#linkFailureLog === undefined : undefined;
  }
  getProgramInfoLog(program: WebGLProgram): string | null {
    this.#record("getProgramInfoLog", [program]);
    return this.#linkFailureLog ?? "";
  }
  deleteProgram(program: WebGLProgram | null): void {
    this.#record("deleteProgram", [program]);
    if (program instanceof FakeGlObject) this.#delete(program);
  }
  useProgram(program: WebGLProgram | null): void {
    this.#record("useProgram", [program]);
  }
  getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null {
    this.#record("getUniformLocation", [program, name]);
    return new FakeUniformLocation(name);
  }

  createBuffer(): WebGLBuffer {
    this.#record("createBuffer", []);
    return this.#create("buffer");
  }
  deleteBuffer(buffer: WebGLBuffer | null): void {
    this.#record("deleteBuffer", [buffer]);
    if (buffer instanceof FakeGlObject) this.#delete(buffer);
  }
  bindBuffer(target: number, buffer: WebGLBuffer | null): void {
    this.#record("bindBuffer", [target, buffer]);
    if (target === GL_ARRAY_BUFFER) {
      this.#boundArrayBuffer = buffer instanceof FakeGlObject ? buffer : null;
    }
  }
  bufferData(
    target: number,
    srcData: ArrayBufferView,
    usage: number,
    srcOffset: number,
    length: number,
  ): void {
    if (!this.recording) return;
    // WebGL treats `length === 0` as "to the end of the view", which is why the renderer must
    // skip an empty upload rather than pass it through.
    const view = srcData instanceof Float32Array ? srcData : new Float32Array(0);
    const effective = length === 0 ? view.length - srcOffset : length;
    const snapshot = view.slice(srcOffset, srcOffset + effective);
    this.#uploads.push({
      buffer: this.#boundArrayBuffer,
      target,
      data: srcData,
      srcOffset,
      length,
      snapshot,
    });
    this.#record("bufferData", [target, srcData, usage, srcOffset, length]);
  }

  createVertexArray(): WebGLVertexArrayObject {
    this.#record("createVertexArray", []);
    return this.#create("vertexArray");
  }
  deleteVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
    this.#record("deleteVertexArray", [vertexArray]);
    if (vertexArray instanceof FakeGlObject) this.#delete(vertexArray);
  }
  bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void {
    this.#record("bindVertexArray", [vertexArray]);
  }
  enableVertexAttribArray(index: number): void {
    this.#record("enableVertexAttribArray", [index]);
  }
  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void {
    this.#record("vertexAttribPointer", [index, size, type, normalized, stride, offset]);
  }
  vertexAttribDivisor(index: number, divisor: number): void {
    this.#record("vertexAttribDivisor", [index, divisor]);
  }

  viewport(x: number, y: number, width: number, height: number): void {
    this.#record("viewport", [x, y, width, height]);
  }
  scissor(x: number, y: number, width: number, height: number): void {
    this.#record("scissor", [x, y, width, height]);
  }
  enable(capability: number): void {
    this.#record("enable", [capability]);
  }
  disable(capability: number): void {
    this.#record("disable", [capability]);
  }
  clearColor(red: number, green: number, blue: number, alpha: number): void {
    this.#record("clearColor", [red, green, blue, alpha]);
  }
  clear(mask: number): void {
    this.#record("clear", [mask]);
  }
  blendFuncSeparate(srcRgb: number, dstRgb: number, srcAlpha: number, dstAlpha: number): void {
    this.#record("blendFuncSeparate", [srcRgb, dstRgb, srcAlpha, dstAlpha]);
  }

  #uniform(
    method: string,
    location: WebGLUniformLocation | null,
    data: Float32Array | Int32Array,
    srcOffset: number,
    srcLength: number,
  ): void {
    if (!this.recording) return;
    const values = Array.from(data.subarray(srcOffset, srcOffset + srcLength));
    if (location instanceof FakeUniformLocation) {
      this.#uniforms.push({ name: location.name, values });
    }
    this.#record(method, [location, values]);
  }
  uniform1fv(location: WebGLUniformLocation | null, data: Float32Array, srcOffset: number, srcLength: number): void {
    this.#uniform("uniform1fv", location, data, srcOffset, srcLength);
  }
  uniform2fv(location: WebGLUniformLocation | null, data: Float32Array, srcOffset: number, srcLength: number): void {
    this.#uniform("uniform2fv", location, data, srcOffset, srcLength);
  }
  uniform4fv(location: WebGLUniformLocation | null, data: Float32Array, srcOffset: number, srcLength: number): void {
    this.#uniform("uniform4fv", location, data, srcOffset, srcLength);
  }
  uniform1iv(location: WebGLUniformLocation | null, data: Int32Array, srcOffset: number, srcLength: number): void {
    this.#uniform("uniform1iv", location, data, srcOffset, srcLength);
  }

  drawArraysInstanced(mode: number, first: number, count: number, instanceCount: number): void {
    this.#record("drawArraysInstanced", [mode, first, count, instanceCount]);
  }

  getExtension(extensionName: "WEBGL_lose_context"): LoseContextExtension | null {
    this.#record("getExtension", [extensionName]);
    return this.#loseContextExtension ? this.#loseContext : null;
  }
}
