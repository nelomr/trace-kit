import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

// Node-environment isomorphism tripwire (CLAUDE.md rule 5).
// This project is pinned to `environment: "node"` with no DOM globals configured
// (see root vitest.config.ts). Importing `@trace-kit/core` here and asserting it
// loads and evaluates is the first line of defense against a `document`/`window`
// reference creeping into the isomorphic core.
describe("isomorphism", () => {
  it("loads and evaluates @trace-kit/core under a plain Node environment", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });
});
