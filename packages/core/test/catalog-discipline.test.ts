import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseWorkspaceYaml,
  findWorkspacePackageDirs,
  checkCatalogDiscipline,
  checkTsconfigStrictness,
  readTsconfig,
  stripJsonComments,
} from "../../../scripts/verify-catalog-discipline.mjs";
import { checkNoRootExports } from "../../../scripts/verify-no-root-exports.mjs";

const testFileDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testFileDir, "../../..");

function readWorkspaceYamlText(): string {
  return readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
}

function readBaseTsconfig(): Record<string, unknown> {
  return JSON.parse(
    stripJsonComments(readFileSync(path.join(repoRoot, "tsconfig.base.json"), "utf8")),
  ) as Record<string, unknown>;
}

function readRootPackageJson(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  ) as Record<string, unknown>;
}

function readRealPackageJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(
      readFileSync(path.join(repoRoot, dir, "package.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readRealTsconfig(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(
      readFileSync(path.join(repoRoot, dir, "tsconfig.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe("catalog discipline (real workspace on disk)", () => {
  it("holds catalog discipline across the real workspace", () => {
    const workspaceYamlText = readWorkspaceYamlText();
    const packageDirs = findWorkspacePackageDirs(workspaceYamlText);
    const violations = checkCatalogDiscipline(
      workspaceYamlText,
      packageDirs,
      readRealPackageJson,
    );
    expect(violations).toEqual([]);
  });

  it("holds tsconfig strictness across the real workspace", () => {
    const workspaceYamlText = readWorkspaceYamlText();
    const packageDirs = findWorkspacePackageDirs(workspaceYamlText);
    const baseTsconfig = readBaseTsconfig();
    const violations = checkTsconfigStrictness(
      baseTsconfig,
      packageDirs,
      readRealTsconfig,
    );
    expect(violations).toEqual([]);
  });

  it("has no root exports field", () => {
    const rootPackageJson = readRootPackageJson();
    const violations = checkNoRootExports(rootPackageJson);
    expect(violations).toEqual([]);
  });
});

describe("catalog discipline (negative fixtures)", () => {
  it("fails checkCatalogDiscipline when a governed catalog dep uses a literal version", () => {
    const workspaceYamlText = readWorkspaceYamlText();
    const fixturePackageJson: Record<string, unknown> = {
      name: "fixture-pkg",
      dependencies: {
        vitest: "1.2.3",
      },
    };
    const violations = checkCatalogDiscipline(
      workspaceYamlText,
      ["fixture-dir"],
      (dir: string) => (dir === "fixture-dir" ? fixturePackageJson : null),
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("vitest");
  });

  it("fails checkTsconfigStrictness when a governed flag is overridden to false", () => {
    const baseTsconfig = readBaseTsconfig();
    const fixtureTsconfig: Record<string, unknown> = {
      compilerOptions: {
        noUncheckedIndexedAccess: false,
      },
    };
    const violations = checkTsconfigStrictness(
      baseTsconfig,
      ["fixture-dir"],
      (dir: string) => (dir === "fixture-dir" ? fixtureTsconfig : null),
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain("noUncheckedIndexedAccess");
  });

  it("fails checkNoRootExports when a top-level exports field exists", () => {
    const fixturePackageJson: Record<string, unknown> = {
      name: "fixture-root",
      exports: { ".": "./dist/index.js" },
    };
    const violations = checkNoRootExports(fixturePackageJson);
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe("fail-open regression: JSONC tsconfig.json", () => {
  it("reports a comment-bearing (invalid JSONC) tsconfig.json as a violation, not a silent skip", () => {
    const baseTsconfig = readBaseTsconfig();
    const fixtureDir = "packages/core/test/fixtures/jsonc-tsconfig";
    const violations = checkTsconfigStrictness(
      baseTsconfig,
      [fixtureDir],
      readTsconfig,
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]).toContain(fixtureDir);
  });

  it("reads a comment-bearing but otherwise valid tsconfig.json without a false violation", () => {
    const baseTsconfig = readBaseTsconfig();
    const fixtureDir = "packages/core/test/fixtures/jsonc-tsconfig-valid";
    const violations = checkTsconfigStrictness(
      baseTsconfig,
      [fixtureDir],
      readTsconfig,
    );
    expect(violations).toEqual([]);
  });
});

describe("parseWorkspaceYaml", () => {
  it("parses the real pnpm-workspace.yaml into packages and catalog", () => {
    const { packages, catalog } = parseWorkspaceYaml(readWorkspaceYamlText());
    expect(packages.length).toBeGreaterThan(0);
    expect(Object.keys(catalog).length).toBeGreaterThan(0);
  });
});

describe("dependency freshness policy", () => {
  it("no catalogued version specifier is a prerelease", () => {
    const { catalog } = parseWorkspaceYaml(readWorkspaceYamlText());
    const prereleaseTag = /-(rc|beta|alpha|next|dev)(\.|$)/;
    const offenders = Object.entries(catalog)
      .filter(([, version]) => prereleaseTag.test(version))
      .map(([name, version]) => `${name}@${version}`);
    expect(offenders).toEqual([]);
  });
});
