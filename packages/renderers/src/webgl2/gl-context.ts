/**
 * The narrow slice of `WebGL2RenderingContext` the renderer calls, plus the numeric constants it
 * needs. Writing the renderer against this interface instead of the full context lets a recording
 * fake stand in for a GPU in the Node test suite, and a type-level assertion keeps the interface a
 * strict subset of the real context so a real context can always be passed in its place.
 *
 * The constants are plain numbers (the values are fixed by the WebGL specification) rather than
 * reads of `gl.ARRAY_BUFFER` and friends: a read of an instance property per call would have to
 * be mirrored by every fake, and a module-level constant is also free of any DOM dependency.
 */

/** The `WEBGL_lose_context` extension, reduced to the one call the renderer makes. */
export interface LoseContextExtension {
  loseContext(): void;
}

export interface Gl2Context {
  createShader(type: number): WebGLShader | null;
  shaderSource(shader: WebGLShader, source: string): void;
  compileShader(shader: WebGLShader): void;
  getShaderParameter(shader: WebGLShader, pname: number): unknown;
  getShaderInfoLog(shader: WebGLShader): string | null;
  deleteShader(shader: WebGLShader | null): void;

  createProgram(): WebGLProgram;
  attachShader(program: WebGLProgram, shader: WebGLShader): void;
  detachShader(program: WebGLProgram, shader: WebGLShader): void;
  linkProgram(program: WebGLProgram): void;
  getProgramParameter(program: WebGLProgram, pname: number): unknown;
  getProgramInfoLog(program: WebGLProgram): string | null;
  deleteProgram(program: WebGLProgram | null): void;
  useProgram(program: WebGLProgram | null): void;
  getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation | null;

  createBuffer(): WebGLBuffer;
  deleteBuffer(buffer: WebGLBuffer | null): void;
  bindBuffer(target: number, buffer: WebGLBuffer | null): void;
  /** The `srcOffset`/`length` overload: uploads `length` elements starting at element
   * `srcOffset` of the caller's own typed array, with no `subarray` and no CPU copy. */
  bufferData(
    target: number,
    srcData: ArrayBufferView,
    usage: number,
    srcOffset: number,
    length: number,
  ): void;

  createVertexArray(): WebGLVertexArrayObject;
  deleteVertexArray(vertexArray: WebGLVertexArrayObject | null): void;
  bindVertexArray(vertexArray: WebGLVertexArrayObject | null): void;
  enableVertexAttribArray(index: number): void;
  vertexAttribPointer(
    index: number,
    size: number,
    type: number,
    normalized: boolean,
    stride: number,
    offset: number,
  ): void;
  vertexAttribDivisor(index: number, divisor: number): void;

  viewport(x: number, y: number, width: number, height: number): void;
  scissor(x: number, y: number, width: number, height: number): void;
  enable(capability: number): void;
  disable(capability: number): void;
  clearColor(red: number, green: number, blue: number, alpha: number): void;
  clear(mask: number): void;
  blendFuncSeparate(srcRgb: number, dstRgb: number, srcAlpha: number, dstAlpha: number): void;

  /** The offset overloads: `srcLength` is a count of vectors' components, read from `data`
   * starting at element `srcOffset`, so one preallocated row array feeds every trace. */
  uniform1fv(
    location: WebGLUniformLocation | null,
    data: Float32Array,
    srcOffset: number,
    srcLength: number,
  ): void;
  uniform2fv(
    location: WebGLUniformLocation | null,
    data: Float32Array,
    srcOffset: number,
    srcLength: number,
  ): void;
  uniform4fv(
    location: WebGLUniformLocation | null,
    data: Float32Array,
    srcOffset: number,
    srcLength: number,
  ): void;
  uniform1iv(
    location: WebGLUniformLocation | null,
    data: Int32Array,
    srcOffset: number,
    srcLength: number,
  ): void;

  drawArraysInstanced(mode: number, first: number, count: number, instanceCount: number): void;

  getExtension(extensionName: "WEBGL_lose_context"): LoseContextExtension | null;
}

export const GL_COLOR_BUFFER_BIT = 0x4000;
export const GL_BLEND = 0x0be2;
export const GL_SCISSOR_TEST = 0x0c11;
export const GL_ONE = 1;
export const GL_ONE_MINUS_SRC_ALPHA = 0x0303;
export const GL_TRIANGLE_STRIP = 5;
export const GL_ARRAY_BUFFER = 0x8892;
export const GL_DYNAMIC_DRAW = 0x88e8;
export const GL_FLOAT = 0x1406;
export const GL_VERTEX_SHADER = 0x8b31;
export const GL_FRAGMENT_SHADER = 0x8b30;
export const GL_COMPILE_STATUS = 0x8b81;
export const GL_LINK_STATUS = 0x8b82;
