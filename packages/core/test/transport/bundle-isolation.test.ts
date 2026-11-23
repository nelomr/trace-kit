import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../../..");
const distDir = path.join(packageRoot, "dist");

function readDistText(relativePath: string): string {
  return readFileSync(path.join(distDir, relativePath), "utf8");
}

function listJsFiles(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listJsFiles(abs, out);
    } else if (entry.isFile() && (entry.name.endsWith(".js") || entry.name.endsWith(".cjs"))) {
      out.push(path.relative(distDir, abs).split(path.sep).join("/"));
    }
  }
}

describe("bundle-isolation — @trace-kit/core, ./worker, and ./node subpaths", () => {
  it("emits .js, .cjs, .d.ts, .d.cts, sourcemaps, and subpath .d.ts.map artifacts for ., ./worker, and ./node", () => {
    const expectedArtifacts = [
      "index.js",
      "index.js.map",
      "index.cjs",
      "index.cjs.map",
      "index.d.ts",
      "index.d.cts",
      "worker.js",
      "worker.js.map",
      "worker.cjs",
      "worker.cjs.map",
      "worker.d.ts",
      "worker.d.cts",
      "worker.d.ts.map",
      "node/index.js",
      "node/index.js.map",
      "node/index.cjs",
      "node/index.cjs.map",
      "node/index.d.ts",
      "node/index.d.cts",
      "node/index.d.ts.map",
    ];
    for (const rel of expectedArtifacts) {
      expect(existsSync(path.join(distDir, rel)), `missing dist/${rel}`).toBe(true);
    }
  });

  it("resolves ., ./worker, and ./node cleanly via both ESM import() and CJS require()", async () => {
    const require = createRequire(import.meta.url);

    function assertExportsFunctions(mod: unknown, names: readonly string[]): void {
      expect(typeof mod).toBe("object");
      expect(mod).not.toBeNull();
      const record = mod as Record<string, unknown>;
      for (const name of names) {
        expect(typeof record[name], `expected export ${name} to be a function`).toBe("function");
      }
    }

    // Root "."
    const esmRoot: unknown = await import("@trace-kit/core");
    const cjsRoot: unknown = require("@trace-kit/core");
    const rootFns = [
      "createWorkerDecimationPort",
      "handleDecimationMessage",
      "attachDecimationWorker",
      "attachCurrentDecimationWorker",
    ];
    assertExportsFunctions(esmRoot, rootFns);
    assertExportsFunctions(cjsRoot, rootFns);

    // Subpath "./worker"
    const esmWorker: unknown = await import("@trace-kit/core/worker");
    const cjsWorker: unknown = require("@trace-kit/core/worker");
    const workerFns = [
      "handleDecimationMessage",
      "createDecimationWorkerHandler",
      "attachDecimationWorker",
      "attachCurrentDecimationWorker",
      "minMaxEnvelope",
      "minMaxEnvelopeIndices",
      "lttb",
    ];
    assertExportsFunctions(esmWorker, workerFns);
    assertExportsFunctions(cjsWorker, workerFns);

    // Subpath "./node"
    const esmNode: unknown = await import("@trace-kit/core/node");
    const cjsNode: unknown = require("@trace-kit/core/node");
    const nodeFns = [
      "adaptNodeWorker",
      "createNodeWorkerFactory",
      "createNodeParentPortEndpoint",
      "attachNodeDecimationWorker",
    ];
    assertExportsFunctions(esmNode, nodeFns);
    assertExportsFunctions(cjsNode, nodeFns);
  });

  it("contains zero node:worker_threads, node:, or new Worker( references in root and ./worker bundles", () => {
    const allJsFiles: string[] = [];
    listJsFiles(distDir, allJsFiles);

    // Every emitted JS/CJS file outside dist/node/ (root, worker, and any shared chunks)
    const nonNodeFiles = allJsFiles.filter((rel) => !rel.startsWith("node/"));
    expect(nonNodeFiles).toContain("index.js");
    expect(nonNodeFiles).toContain("index.cjs");
    expect(nonNodeFiles).toContain("worker.js");
    expect(nonNodeFiles).toContain("worker.cjs");

    for (const rel of nonNodeFiles) {
      const code = readDistText(rel);
      expect(/worker_threads/.test(code), `${rel} leaked worker_threads`).toBe(false);
      expect(/["']node:/.test(code), `${rel} leaked node:* builtin`).toBe(false);
      expect(/\bnew Worker\(/.test(code), `${rel} contains new Worker(`).toBe(false);
    }

    // ./node explicitly keeps node:worker_threads external
    const nodeEsm = readDistText("node/index.js");
    const nodeCjs = readDistText("node/index.cjs");
    expect(nodeEsm).toContain("node:worker_threads");
    expect(nodeCjs).toContain("node:worker_threads");
  });

  it("excludes unrelated viewport and CSV export modules from the ./worker bundle and its chunks", () => {
    const workerEsm = readDistText("worker.js");
    const workerFiles = ["worker.js", "worker.cjs"];
    for (const match of workerEsm.matchAll(/from\s+["']\.\/(chunk-[^"']+\.js)["']/g)) {
      if (match[1] !== undefined) workerFiles.push(match[1]);
    }
    for (const rel of workerFiles) {
      const code = readDistText(rel);
      expect(code, `${rel} leaked exportToCsv`).not.toContain("exportToCsv");
      expect(code, `${rel} leaked exportCsv`).not.toContain("exportCsv");
      expect(code, `${rel} leaked exportNpy`).not.toContain("exportNpy");
      expect(code, `${rel} leaked createViewportTransform`).not.toContain("createViewportTransform");
    }
  });
});
