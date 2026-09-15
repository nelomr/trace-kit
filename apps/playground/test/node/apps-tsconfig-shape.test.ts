/** @vitest-environment node */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface TsconfigShape {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
}

describe("apps/playground/tsconfig.json shape", () => {
  it("extends the base tsconfig and declares only paths/include/exclude beyond it", () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.join(dir, "../../tsconfig.json"), "utf8");
    const tsconfig = JSON.parse(raw) as TsconfigShape;

    expect(tsconfig.extends).toBe("../../tsconfig.base.json");
    expect(tsconfig.compilerOptions).toBeDefined();
    expect(tsconfig.compilerOptions?.strict).toBeUndefined();
    expect(tsconfig.compilerOptions?.noUncheckedIndexedAccess).toBeUndefined();
  });
});
