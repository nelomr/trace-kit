# Side-Effects Audit — `@trace-kit/core`

`package.json` declares `"sideEffects": false`. Per design.md §D3/proposal.md, that is a
**correctness assertion**, not a formality: a false claim here produces silently broken
consumer builds once a bundler tree-shakes modules on the assumption that importing them for
side effects alone is safe to elide. This file is the audit backing that assertion.

**Rule**: every file listed below must perform no top-level side effect — no code that runs
at module-evaluation time and has an externally observable effect (mutating a global, writing
to `console`, registering a listener, touching `process`, throwing, etc.) outside of defining
and exporting bindings.

`packages/core/test/side-effects-audit.test.ts` asserts **set equality in both directions**
between the file list below and the actual files under `src/`: a file removed from `src` but
left listed here fails the check, exactly as a file added to `src` but missing from this list
does. The audit cannot silently go stale in either direction.

## Audited files

| File | Side-effect-free? | Notes |
|---|---|---|
| `src/index.ts` | Yes | Declares and exports the `VERSION` constant only. No side effect at module scope. |
