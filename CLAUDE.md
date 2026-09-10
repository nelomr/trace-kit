# CLAUDE.md — TraceKit

This file is the authoritative entry point for any Claude agent, subagent, or assistant working in this repository. Read it before writing or modifying any code. It states the non-negotiable architectural rules, engine strategies, and development lifecycle of **TraceKit**.

---

## ⚡ What TraceKit Is

TraceKit is a **high-throughput, headless telemetry and physical signal visualization engine**. Engineered for hardware characterization (optical spectrum analyzers, RF oscilloscopes), massive time-series sweeps, and semiconductor wafer yield analytics.

It is structured as a **PNPM + Turborepo monorepo**:
```text
packages/
  core/            100% Isomorphic TypeScript. Zero DOM dependencies.
                   Typed branded buffers, decimation algorithms (LTTB, Min-Max), Web Worker pipelines.
  renderers/       Headless rendering engines:
                   - Canvas2D (<80k points) via Path2D batching.
                   - WebGL2 (>80k points) via Dual-VBO shaders & instanced rendering.
  vue/             Vue 3 composables (`useSpectrumEngine`) and components (`TraceSpectrumViewer`).
  react/           React canvas hooks and SSR-safe wrappers.
apps/
  playground/      Live performance stress-test workbench with 60 FPS telemetry and Tweakpane controls.
  docs/            VitePress documentation with multi-framework switchers.
openspec/
  specs/           Authoritative capability specifications (Source of Truth).
  changes/         Active and archived SDD changes.
.agent/skills/     Canonical SDD and engineering skills index.
```

---

## 🛡️ Non-Negotiable Engineering Rules

1. **No `any`, anywhere, in production code.**
   - Not `: any`, not `as any`, not `<any>`, not `Record<string, any>`, not `as never` used to suppress type errors.
   - When verifying with grep, check both `: any|as any|<any>` **and** `, any>` (the latter catches `Record<string, any>`).
   - Use generics, discriminated unions, or branded types.

2. **Zero-Copy & Zero-GC in Render Hot Paths:**
   - Telemetry buffers must use typed branded buffers (`Float32Array`, `Float64Array`).
   - Never allocate objects (`new Object()`, `{ ... }`, array spreading) inside continuous render loops or pan/zoom sweeps.
   - Use `Transferable Objects` (`ArrayBuffer`) when communicating across Web Worker boundaries.

3. **Hybrid Dual-Engine Strategy:**
   - **Canvas2D (Path2D)** for low-to-medium point counts ($< 80{,}000$ points) to minimize GPU context overhead.
   - **WebGL2** for massive sweeps ($> 80{,}000$ points) with ping-pong VBOs and instanced geometry rendering.
   - Engine switching must be automatic and hysteresis-stabilized to avoid rapid oscillation at thresholds.

4. **Reactivity Isolation in Framework Wrappers:**
   - In Vue 3, telemetry buffers must NEVER be wrapped in deep reactive proxies. Always isolate with `shallowRef` or `markRaw`.
   - In React, manage canvas references and render loops outside state renders via `useRef`.

5. **Isomorphic Pure Core (`@trace-kit/core`):**
   - Must execute in Node.js, Web Workers, and browsers.
   - Absolutely zero imports or references to `document`, `window`, `HTMLCanvasElement`, or browser globals.

6. **Physics-Preserving Decimation:**
   - Decimation algorithms (LTTB, Min-Max Envelope) must mathematically preserve critical resonance peaks, optical dips, and noise floor baselines. Never apply naive uniform sub-sampling to high-frequency signals.

7. **Storage & Persistence Policy (Zero-Engram Guarantee):**
   - TraceKit uses **pure filesystem-based OpenSpec storage** (`openspec/changes/{change}/`).
   - Do NOT use or call any external persistent memory tools (`mem_*`). State is tracked via `resume-apply.md`, `tasks.md`, and `verify-report.md`.

8. **Low-Velocity Versioning Pacing:**
   - Starts at `0.0.0` and bumps deliberately via `patch` (`0.0.1`, `0.0.2`, ...).
   - Use Changesets (`.changeset/`) for any release-triggering fix or feature.
   - External PRs are not accepted until `1.0.0` stable release.

---

## 🔄 SDD Lifecycle & Commands

All development follows Spec-Driven Development (SDD) via unified commands:

| Command | Phase | Role |
|---|---|---|
| `/sdd:explore <topic>` | Exploration | Brainstorm approaches, inspect tradeoffs with ASCII diagrams |
| `/sdd:propose <name>` | Proposal | Draft `proposal.md` with scope, intent, and capabilities contract |
| `/sdd:spec [name]` | Specification | Write delta specs with RFC 2119 (**MUST/SHALL**) and testable scenarios |
| `/sdd:design [name]` | Design | Resolve architecture decisions (Zero-Copy, dual-engine, branded buffers) |
| `/sdd:tasks [name]` | Tasks | Implementation checklist ordered by layers with strict TDD sequence |
| `/sdd:apply [name]` | Implementation | TDD loop (**RED → GREEN → REFACTOR**) with real test execution |
| `/sdd:verify [name]` | Verification | Live test execution, typecheck, and scenario compliance matrix |
| `/sdd:archive [name]` | Archive | Merge spec deltas into `openspec/specs/` and archive change directory |
| `/sdd:judgment` | Quality Audit | Ruthless quality gate (zero `any`, allocation checks, full test pass) |

---

## 🧪 Verification Commands

Always verify changes with the project's real test and build tools:
```bash
# Typecheck all packages
pnpm exec turbo run typecheck

# Lint all packages
pnpm exec turbo run lint

# Run unit and integration tests
pnpm run test

# Build monorepo packages
pnpm exec turbo run build
```
