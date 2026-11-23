import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../../..");

describe("test-harness COOP/COEP scoping and project preservation", () => {
  const vitestConfig = readFileSync(path.join(repoRoot, "vitest.config.ts"), "utf8");
  const playgroundViteConfig = readFileSync(
    path.join(repoRoot, "apps/playground/vite.config.ts"),
    "utf8",
  );

  it("never configures COOP/COEP headers in apps/playground/vite.config.ts", () => {
    expect(playgroundViteConfig).not.toMatch(/Cross-Origin-Opener-Policy/i);
    expect(playgroundViteConfig).not.toMatch(/Cross-Origin-Embedder-Policy/i);
  });

  it("scopes COOP/COEP headers strictly to core-worker-shared and keeps core-worker-transfer header-free", () => {
    const transferIdx = vitestConfig.indexOf('name: "core-worker-transfer"');
    const sharedPluginIdx = vitestConfig.indexOf('name: "trace-kit-test-only-coop-coep"');
    const sharedIdx = vitestConfig.indexOf('name: "core-worker-shared"');
    expect(transferIdx).toBeGreaterThan(-1);
    expect(sharedPluginIdx).toBeGreaterThan(transferIdx);
    expect(sharedIdx).toBeGreaterThan(sharedPluginIdx);

    // Everything from start of file through the end of the `core-worker-transfer` project
    // (before `core-worker-shared`'s server headers) MUST contain zero COOP/COEP headers.
    const sharedServerIdx = vitestConfig.indexOf("Cross-Origin-Opener-Policy");
    expect(sharedServerIdx).toBeGreaterThan(transferIdx);
    const beforeShared = vitestConfig.slice(0, transferIdx + 240);
    expect(beforeShared).not.toMatch(/Cross-Origin-Opener-Policy/i);
    expect(beforeShared).not.toMatch(/Cross-Origin-Embedder-Policy/i);

    const sharedBlock = vitestConfig.slice(transferIdx, sharedIdx + 200);
    expect(sharedBlock).toMatch(/Cross-Origin-Opener-Policy/);
    expect(sharedBlock).toMatch(/Cross-Origin-Embedder-Policy/);
  });

  it("keeps core Node project on forks + --expose-gc and excludes test/browser/**", () => {
    const coreIdx = vitestConfig.indexOf('name: "core"');
    const playgroundIdx = vitestConfig.indexOf('name: "playground"');
    expect(coreIdx).toBeGreaterThan(-1);
    expect(playgroundIdx).toBeGreaterThan(coreIdx);

    const coreBlock = vitestConfig.slice(coreIdx, playgroundIdx);
    expect(coreBlock).toContain('environment: "node"');
    expect(coreBlock).toContain('exclude: ["test/browser/**"]');
    expect(coreBlock).toContain('pool: "forks"');
    expect(coreBlock).toContain('"--expose-gc"');
    expect(coreBlock).toContain('"--no-concurrent-recompilation"');
  });
});
