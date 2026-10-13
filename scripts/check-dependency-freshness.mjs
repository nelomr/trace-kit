#!/usr/bin/env node
// Dependency freshness check: reports every catalogued dependency that is behind the
// newest stable release published at least `FRESHNESS_WINDOW_DAYS` ago.
//
// This is a MANUAL procedure, deliberately not wired into CI (the maintainer chose manual
// enforcement over an automated gate). Run it by hand before performing a dependency update;
// nothing in this repository calls it automatically.
//
// The one rule this script exists to enforce mechanically, because a human check gets it wrong
// exactly once and then keeps getting it wrong: **never read a package's `latest` dist-tag**.
// `@types/node`'s own `latest` tag pointed at its 22.x line long after 26.x stable releases
// existed (this repository was on `^22.10.0` for that exact reason before P8 caught it) — a
// dist-tag is a publisher's choice about what to promote, not a freshness signal. This script
// instead reads the full version list and each version's publish time, filters out anything
// carrying a prerelease identifier (`-rc.`, `-beta.`, `-alpha.`, `-next.`, `-dev.` — string
// parsing, never a dist-tag lookup, since `vitest` alone carries `beta`/`rc`/`V3`/`V4` tags
// simultaneously and none of them says which release is stable), drops anything published
// inside the freshness window, and reports the newest release that remains.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWorkspaceYaml } from "./verify-catalog-discipline.mjs";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const FRESHNESS_WINDOW_DAYS = 2;
const PRERELEASE_PATTERN = /-(rc|beta|alpha|next|dev)(\.|$)/;
const STABLE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function fetchRegistryTimes(packageName) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(packageName).replace("%40", "@").replace("%2F", "/")}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`registry lookup failed for ${packageName}: HTTP ${response.status}`);
  }
  const body = await response.json();
  // `body.time` maps every published version to its ISO publish timestamp, plus two
  // non-version keys ("created", "modified") this function must not treat as versions.
  return body.time ?? {};
}

/**
 * The newest stable version published at or before `cutoff` (a Date), or `null` if none
 * qualifies. Never consults `body["dist-tags"].latest` — see the module comment above.
 */
function selectFreshnessTarget(times, cutoff) {
  const candidates = Object.entries(times).filter(
    ([version, publishedAt]) =>
      STABLE_VERSION_PATTERN.test(version) &&
      !PRERELEASE_PATTERN.test(version) &&
      new Date(publishedAt).getTime() <= cutoff.getTime(),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => compareVersions(a[0], b[0]));
  const newest = candidates[candidates.length - 1];
  return { version: newest[0], publishedAt: newest[1] };
}

function stripRangeOperators(specifier) {
  // Catalog entries are occasionally a caret/tilde range (e.g. `'^8.3.0'`), a bare exact
  // version, or `catalog:` itself (never present in `pnpm-workspace.yaml`'s own `catalog:`
  // block — that operator only appears in package.json files). Strip a leading operator so
  // the comparison below is against the version number the catalog actually names.
  return specifier.replace(/^[\^~]/, "");
}

export async function checkDependencyFreshness(catalog, cutoff, fetchTimes = fetchRegistryTimes) {
  const results = [];
  for (const [name, specifier] of Object.entries(catalog)) {
    const currentVersion = stripRangeOperators(specifier);
    let target;
    try {
      const times = await fetchTimes(name);
      target = selectFreshnessTarget(times, cutoff);
    } catch (error) {
      results.push({
        name,
        currentSpecifier: specifier,
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (target === null) {
      results.push({
        name,
        currentSpecifier: specifier,
        status: "error",
        message: "no stable version found at or before the freshness cutoff",
      });
      continue;
    }
    const isCurrent =
      STABLE_VERSION_PATTERN.test(currentVersion) &&
      compareVersions(currentVersion, target.version) >= 0;
    results.push({
      name,
      currentSpecifier: specifier,
      targetVersion: target.version,
      targetPublishedAt: target.publishedAt,
      status: isCurrent ? "current" : "behind",
    });
  }
  return results;
}

async function main() {
  const workspaceYamlText = readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const { catalog } = parseWorkspaceYaml(workspaceYamlText);

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FRESHNESS_WINDOW_DAYS);

  console.log(
    `Checking ${Object.keys(catalog).length} catalogued dependencies against the newest stable release published at or before ${cutoff.toISOString().slice(0, 10)} (${FRESHNESS_WINDOW_DAYS}-day freshness window)...\n`,
  );

  const results = await checkDependencyFreshness(catalog, cutoff);

  const behind = results.filter((r) => r.status === "behind");
  const errored = results.filter((r) => r.status === "error");
  const current = results.filter((r) => r.status === "current");

  for (const r of current) {
    console.log(`  OK       ${r.name}: ${r.currentSpecifier} (target ${r.targetVersion} is not newer)`);
  }
  for (const r of behind) {
    console.log(
      `  BEHIND   ${r.name}: ${r.currentSpecifier} -> ${r.targetVersion} (published ${r.targetPublishedAt.slice(0, 10)})`,
    );
  }
  for (const r of errored) {
    console.log(`  ERROR    ${r.name}: ${r.message}`);
  }

  console.log(
    `\n${current.length} current, ${behind.length} behind, ${errored.length} errored, out of ${results.length} total.`,
  );

  if (behind.length > 0 || errored.length > 0) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
