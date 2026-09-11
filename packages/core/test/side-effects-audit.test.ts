import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Asserts set equality in both directions between `SIDE_EFFECTS_AUDIT.md`'s listed files and
// the actual files under `src/`: bundlers rely on this audit to tree-shake safely, so a file
// removed from `src` but left in the audit must fail this check just as a file added to `src`
// but missing from the audit does.
const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../..");

function extractAuditedPaths(markdown: string): Set<string> {
  const paths = new Set<string>();
  const rowPattern = /^\|\s*`(src\/[^`]+)`\s*\|/gm;
  for (const match of markdown.matchAll(rowPattern)) {
    const filePath = match[1];
    if (filePath !== undefined) {
      paths.add(filePath);
    }
  }
  return paths;
}

function walkTsFiles(dir: string, relativeTo: string, out: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(absolutePath, relativeTo, out);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.add(path.relative(relativeTo, absolutePath).split(path.sep).join("/"));
    }
  }
}

function actualSrcFiles(): Set<string> {
  const files = new Set<string>();
  walkTsFiles(path.join(packageRoot, "src"), packageRoot, files);
  return files;
}

describe("SIDE_EFFECTS_AUDIT.md", () => {
  it("lists exactly the files under src/ — no more, no fewer", () => {
    const auditText = readFileSync(
      path.join(packageRoot, "SIDE_EFFECTS_AUDIT.md"),
      "utf8",
    );
    const audited = extractAuditedPaths(auditText);
    const actual = actualSrcFiles();

    const missingFromAudit = [...actual].filter((file) => !audited.has(file));
    const staleInAudit = [...audited].filter((file) => !actual.has(file));

    expect(missingFromAudit).toEqual([]);
    expect(staleInAudit).toEqual([]);
  });
});
