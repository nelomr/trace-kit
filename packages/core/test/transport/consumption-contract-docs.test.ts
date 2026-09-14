import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// buffer-ownership-protocol spec's "Explicit Buffer-Consumption Contract on the Public API":
// `submit`/`viewX`/`viewY`/`viewOut`/`viewIndices` must document, in JSDoc directly above their
// declarations, that reading through a consumed (submitted) lease is a caller contract
// violation rather than undocumented behaviour a consumer has to discover at runtime.
const sourcePath = path.resolve(
  fileURLToPath(import.meta.url),
  "../../../src/transport/decimation-port.ts",
);
const source = readFileSync(sourcePath, "utf8");

function docCommentBefore(memberSignature: string): string {
  const memberIndex = source.indexOf(memberSignature);
  expect(memberIndex, `expected to find "${memberSignature}" in decimation-port.ts`).toBeGreaterThan(-1);
  const before = source.slice(0, memberIndex);
  const lastDocEnd = before.lastIndexOf("*/");
  const lastDocStart = before.lastIndexOf("/**");
  expect(lastDocStart, `expected a JSDoc block before "${memberSignature}"`).toBeGreaterThan(-1);
  return before.slice(lastDocStart, lastDocEnd + 2);
}

describe("consumption contract documented in JSDoc", () => {
  it("submit documents that it consumes the acquired-phase handle", () => {
    const doc = docCommentBefore("submit(lease: Lease<\"acquired\">)");
    expect(doc).toMatch(/consum/i);
    expect(doc).toMatch(/OwnershipViolations/);
  });

  it("viewX/viewY/viewOut/viewIndices document the illegal-read contract", () => {
    const doc = docCommentBefore('viewX(lease: Lease<"acquired"> | Lease<"settled">)');
    expect(doc).toMatch(/contract violation/i);
    expect(doc).toMatch(/OwnershipViolations/);
  });
});
