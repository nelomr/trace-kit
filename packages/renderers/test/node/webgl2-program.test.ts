/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { createGlPrograms } from "../../src/webgl2/program.js";
import { RecordingGl2Context } from "./support/recording-gl2-context.js";

describe("createGlPrograms", () => {
  it("compiles both stages of both programs, links, and releases the shaders after linking", () => {
    const gl = new RecordingGl2Context();
    const programs = createGlPrograms(gl);

    expect(gl.callsNamed("compileShader")).toHaveLength(4);
    expect(gl.callsNamed("linkProgram")).toHaveLength(2);
    expect(gl.callsNamed("detachShader")).toHaveLength(4);
    expect(gl.callsNamed("deleteShader")).toHaveLength(4);
    expect(gl.liveCount("shader")).toBe(0);
    expect(gl.liveCount("program")).toBe(2);
    expect(programs.line).not.toBe(programs.marker);

    // Shaders are detached and deleted only after the link they fed.
    const names = gl.log.map((call) => call.name);
    const firstLink = names.indexOf("gl.linkProgram");
    const firstDetach = names.indexOf("gl.detachShader");
    expect(firstLink).toBeGreaterThan(-1);
    expect(firstDetach).toBeGreaterThan(firstLink);
  });

  it("looks up the uniform locations of both programs", () => {
    const gl = new RecordingGl2Context();
    const programs = createGlPrograms(gl);
    const looked = gl.callsNamed("getUniformLocation").map((call) => String(call.args[1]));

    for (const name of ["u_xOrigin", "u_one", "u_xScale", "u_plot", "u_device", "u_y", "u_yScaleKind", "u_color"]) {
      expect(looked.filter((n) => n === name)).toHaveLength(2);
    }
    expect(looked).toContain("u_lineWidth");
    expect(looked).toContain("u_markerSide");
    expect(programs.lineUniforms.one).not.toBeNull();
    expect(programs.markerUniforms.one).not.toBeNull();
    expect(programs.lineUniforms.lineWidth).not.toBeNull();
    expect(programs.markerUniforms.markerSide).not.toBeNull();
  });

  it("deletes every created object and throws with the info log on a compile failure", () => {
    const gl = new RecordingGl2Context({ compileFailureLog: "0:1: syntax error" });
    expect(() => createGlPrograms(gl)).toThrow(Error);
    expect(() => createGlPrograms(new RecordingGl2Context({ compileFailureLog: "0:1: syntax error" }))).toThrow(
      /0:1: syntax error/,
    );
    expect(gl.liveCount("shader")).toBe(0);
    expect(gl.liveCount("program")).toBe(0);
  });

  it("deletes every created object and throws with the info log on a link failure", () => {
    const gl = new RecordingGl2Context({ linkFailureLog: "varying mismatch" });
    expect(() => createGlPrograms(gl)).toThrow(/varying mismatch/);
    expect(gl.liveCount("shader")).toBe(0);
    expect(gl.liveCount("program")).toBe(0);
    expect(gl.created.program).toBe(gl.deleted.program);
    expect(gl.created.shader).toBe(gl.deleted.shader);
  });
});
