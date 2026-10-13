/**
 * Program compilation, linking and uniform-location lookup. Cold path: runs once, from the
 * renderer constructor. Shaders are detached and deleted as soon as the link that consumed them
 * succeeds, because a linked program no longer needs them; on any failure every object created so
 * far is deleted before the error propagates, so a failed construction leaks nothing.
 */
import {
  GL_COMPILE_STATUS,
  GL_FRAGMENT_SHADER,
  GL_LINK_STATUS,
  GL_VERTEX_SHADER,
  type Gl2Context,
} from "./gl-context.js";
import {
  LINE_FRAGMENT_SHADER,
  LINE_VERTEX_SHADER,
  MARKER_FRAGMENT_SHADER,
  MARKER_VERTEX_SHADER,
} from "./shaders.js";

type Location = WebGLUniformLocation | null;

/** Uniforms shared by both programs. */
export interface SharedUniforms {
  readonly xOrigin: Location;
  readonly one: Location;
  readonly xScale: Location;
  readonly plot: Location;
  readonly device: Location;
  readonly y: Location;
  readonly yScaleKind: Location;
  readonly color: Location;
}

export interface LineUniforms extends SharedUniforms {
  readonly lineWidth: Location;
}

export interface MarkerUniforms extends SharedUniforms {
  readonly markerSide: Location;
}

export interface GlPrograms {
  readonly line: WebGLProgram;
  readonly marker: WebGLProgram;
  readonly lineUniforms: LineUniforms;
  readonly markerUniforms: MarkerUniforms;
}

function compileShader(gl: Gl2Context, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("createShader returned null: the GL context is unusable.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, GL_COMPILE_STATUS) !== true) {
    const log = gl.getShaderInfoLog(shader) ?? "";
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${log}`);
  }
  return shader;
}

/** Compiles and links one program, leaving no shader behind on success or failure. */
export function compileProgram(
  gl: Gl2Context,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertex = compileShader(gl, GL_VERTEX_SHADER, vertexSource);
  let fragment: WebGLShader;
  try {
    fragment = compileShader(gl, GL_FRAGMENT_SHADER, fragmentSource);
  } catch (error) {
    gl.deleteShader(vertex);
    throw error;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, GL_LINK_STATUS) !== true) {
    const log = gl.getProgramInfoLog(program) ?? "";
    gl.detachShader(program, vertex);
    gl.detachShader(program, fragment);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  gl.detachShader(program, vertex);
  gl.detachShader(program, fragment);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  return program;
}

function sharedUniforms(gl: Gl2Context, program: WebGLProgram): SharedUniforms {
  return {
    xOrigin: gl.getUniformLocation(program, "u_xOrigin"),
    one: gl.getUniformLocation(program, "u_one"),
    xScale: gl.getUniformLocation(program, "u_xScale"),
    plot: gl.getUniformLocation(program, "u_plot"),
    device: gl.getUniformLocation(program, "u_device"),
    y: gl.getUniformLocation(program, "u_y"),
    yScaleKind: gl.getUniformLocation(program, "u_yScaleKind"),
    color: gl.getUniformLocation(program, "u_color"),
  };
}

/**
 * Compiles both programs and resolves their uniform locations. If the second program fails, the
 * first is deleted before the error propagates.
 */
export function createGlPrograms(gl: Gl2Context): GlPrograms {
  const line = compileProgram(gl, LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
  let marker: WebGLProgram;
  try {
    marker = compileProgram(gl, MARKER_VERTEX_SHADER, MARKER_FRAGMENT_SHADER);
  } catch (error) {
    gl.deleteProgram(line);
    throw error;
  }
  return {
    line,
    marker,
    lineUniforms: {
      ...sharedUniforms(gl, line),
      lineWidth: gl.getUniformLocation(line, "u_lineWidth"),
    },
    markerUniforms: {
      ...sharedUniforms(gl, marker),
      markerSide: gl.getUniformLocation(marker, "u_markerSide"),
    },
  };
}
