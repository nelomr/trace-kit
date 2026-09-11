import fc from "fast-check";

// Global fast-check configuration (design.md §D8). Seeds are deliberately NOT fixed here — a
// fixed seed converts a property test into an expensive unit test. `VerbosityLevel.VeryVerbose`
// ensures a failure prints the shrunk counterexample together with the `seed` and `path` needed
// to replay it locally via `fc.assert(prop, { seed, path })`.
fc.configureGlobal({
  numRuns: 200,
  verbose: fc.VerbosityLevel.VeryVerbose,
});
