#!/usr/bin/env node
// Catalog + tsconfig-strictness discipline guard (design.md §D7).
//
// The governed dependency set is DERIVED from `pnpm-workspace.yaml`'s `catalog:` keys, never
// hardcoded — the day a new tool is added to the catalog it becomes governed everywhere with
// no second edit. Likewise the set of linted workspace packages is derived from the same
// file's `packages:` globs, never hardcoded `packages/*` / `apps/*` literals, and the
// governed strictness flags are derived from `tsconfig.base.json`'s own `compilerOptions`
// keys, never a hardcoded two-name list.
//
// Rule 1 (catalog-only): for every package.json matched by the workspace globs, every
// dependency/devDependency/peerDependency/optionalDependency entry whose name is a governed
// catalog key must have the specifier exactly `catalog:`. Anything else — a literal range,
// `catalog:named`, `workspace:*` — fails, naming the package, the field and the offending
// specifier. Internal `@trace-kit/*` cross-dependencies use `workspace:*` and are never
// governed, since they are not catalog entries.
//
// Rule 2 (no `false` override of a governed strictness flag): for every package tsconfig.json
// matched by the workspace globs, no key present in `tsconfig.base.json`'s `compilerOptions`
// may be set to `false` in that package's own `compilerOptions`.
//
// A minimal, hand-rolled parser is used for `pnpm-workspace.yaml` rather than a YAML library:
// the file's shape here is narrow and fully controlled by this repository (a `packages:` list
// of quoted glob strings, and a `catalog:` map of quoted `key: value` pairs).
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../..");

function unquote(token) {
  const trimmed = token.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseWorkspaceYaml(text) {
  const lines = text.split("\n");
  const packages = [];
  const catalog = {};
  let section = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (/^\S/.test(line) && line.trim() !== "") {
      // top-level key
      if (line.startsWith("packages:")) {
        section = "packages";
        continue;
      }
      if (line.startsWith("catalog:")) {
        section = "catalog";
        continue;
      }
      section = null;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (section === "packages" && trimmed.startsWith("-")) {
      packages.push(unquote(trimmed.slice(1)));
    } else if (section === "catalog" && trimmed.includes(":")) {
      const idx = trimmed.indexOf(":");
      const key = unquote(trimmed.slice(0, idx));
      const value = unquote(trimmed.slice(idx + 1));
      catalog[key] = value;
    }
  }
  return { packages, catalog };
}

function expandGlob(glob) {
  // Only the narrow shape this repository uses is supported: "<dir>/*".
  if (!glob.endsWith("/*")) {
    throw new Error(`Unsupported workspace glob shape: ${glob}`);
  }
  const dir = glob.slice(0, -2);
  const absDir = path.join(repoRoot, dir);
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name));
}

export function findWorkspacePackageDirs(workspaceYamlText) {
  const { packages } = parseWorkspaceYaml(workspaceYamlText);
  const dirs = [];
  for (const glob of packages) {
    for (const dir of expandGlob(glob)) {
      const pkgJsonPath = path.join(repoRoot, dir, "package.json");
      try {
        if (statSync(pkgJsonPath).isFile()) {
          dirs.push(dir);
        }
      } catch {
        // no package.json in this directory; skip
      }
    }
  }
  return dirs;
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

export function checkCatalogDiscipline(workspaceYamlText, packageDirs, readPackageJson) {
  const { catalog } = parseWorkspaceYaml(workspaceYamlText);
  const governed = new Set(Object.keys(catalog));
  const violations = [];

  for (const dir of packageDirs) {
    const pkg = readPackageJson(dir);
    if (!pkg) continue;
    for (const field of DEPENDENCY_FIELDS) {
      const deps = pkg[field];
      if (!deps || typeof deps !== "object") continue;
      for (const [name, specifier] of Object.entries(deps)) {
        if (governed.has(name) && specifier !== "catalog:") {
          violations.push(
            `${dir}/package.json: "${field}"."${name}" = ${JSON.stringify(specifier)} — must be exactly "catalog:"`,
          );
        }
      }
    }
  }
  return violations;
}

export function checkTsconfigStrictness(baseTsconfig, packageDirs, readTsconfig) {
  const governedFlags = new Set(Object.keys(baseTsconfig.compilerOptions ?? {}));
  const violations = [];

  for (const dir of packageDirs) {
    const tsconfig = readTsconfig(dir);
    if (!tsconfig) continue;
    const compilerOptions = tsconfig.compilerOptions ?? {};
    for (const [flag, value] of Object.entries(compilerOptions)) {
      if (governedFlags.has(flag) && value === false) {
        violations.push(
          `${dir}/tsconfig.json: compilerOptions."${flag}" = false — governed strictness flags may not be overridden to false`,
        );
      }
    }
  }
  return violations;
}

function readPackageJson(dir) {
  const filePath = path.join(repoRoot, dir, "package.json");
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function readTsconfig(dir) {
  const filePath = path.join(repoRoot, dir, "tsconfig.json");
  try {
    // tsconfig.json is JSON here (no comments used in this repository); a real JSONC parser
    // is not needed for the files this script reads.
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function main() {
  const workspaceYamlText = readFileSync(
    path.join(repoRoot, "pnpm-workspace.yaml"),
    "utf8",
  );
  const packageDirs = findWorkspacePackageDirs(workspaceYamlText);

  const catalogViolations = checkCatalogDiscipline(
    workspaceYamlText,
    packageDirs,
    readPackageJson,
  );

  const baseTsconfig = JSON.parse(
    readFileSync(path.join(repoRoot, "tsconfig.base.json"), "utf8"),
  );
  const strictnessViolations = checkTsconfigStrictness(
    baseTsconfig,
    packageDirs,
    readTsconfig,
  );

  const violations = [...catalogViolations, ...strictnessViolations];

  if (violations.length > 0) {
    console.error("Catalog/strictness discipline violations:");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    process.exit(1);
  }

  console.log(
    `OK: catalog and tsconfig-strictness discipline hold across ${packageDirs.length} workspace package(s).`,
  );
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
