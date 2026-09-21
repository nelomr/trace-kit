[🇪🇸 Leer en español](./README.es.md)

# ⚡ TraceKit

> **High-throughput, headless telemetry and physical signal visualization engine.**  
> Engineered for mission-critical hardware characterization, massive time-series sweeps, and semiconductor wafer yield analytics.

[![CI Status](https://github.com/nelomr/trace-kit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nelomr/trace-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Status: pre-alpha](https://img.shields.io/badge/Status-pre--alpha-orange.svg?style=flat-square)](#-project-status)
[![Version: 0.0.0](https://img.shields.io/badge/Version-0.0.0_(unpublished)-lightgrey.svg?style=flat-square)](#-project-status)
[![PRs - Not accepting yet](https://img.shields.io/badge/PRs-Not_accepting_yet-red.svg?style=flat-square)](CONTRIBUTING.md)

---

## 🚧 Project Status

> **TraceKit is pre-alpha. Nothing is published to npm yet.** This README documents both the
> current implementation and, where marked `[PLANNED]`, the intended architecture and API.
>
> **What exists today:**
> - `packages/core` — substantial: branded typed buffers, LTTB and Min-Max Envelope decimation
>   (allocation-free hot path, benchmarked), the zero-copy Web Worker transport contract
>   (ownership protocol, `SharedArrayBuffer` capability detection, backpressure), and the
>   viewport transform layer — linear and logarithmic (base-10) Y-axis projection, multi-axis
>   viewport support (N independent left-stacked Y axes sharing one X domain), and tick
>   selection for both scales.
> - `packages/renderers` — a **Canvas2D renderer only** (`Canvas2DRenderer`, Path2D batching,
>   multi-axis-aware gutters, decade gridlines for log axes) plus the headless `FigureRenderer`
>   contract. **No WebGL2 renderer exists yet.**
> - `apps/playground` — a running Vite app with a home route and a `core-math` route
>   visualizing the decimation algorithms.
> - The pnpm + Turborepo workspace, hundreds of passing Vitest unit/integration tests, a
>   Chromium-based visual regression suite (Linux-CI-only by design), Node-side zero-GC
>   allocation gates, and a CI quality gate (typecheck, lint, unit tests, visual regression,
>   dependency-deprecation checks) that runs and passes on `main`.
>
> **What does not exist yet:** `packages/vue`, `packages/react`, `apps/docs`, and any WebGL2
> renderer. Every package is still unpublished (`0.0.0`, private). The Vue/React Quickstart
> examples below describe an API that does not exist yet; the install commands will not work.
>
> Development follows Spec-Driven Development; progress is tracked in
> [`openspec/roadmap.yaml`](openspec/roadmap.yaml). As of this writing, roadmap steps 1 through
> **5.6** (`core-scale-transforms` — logarithmic and multi-axis viewport transforms) are archived
> and complete. The next planned step is **5.7** (`core-gap-and-multi-trace-model` — gap/NaN
> semantics in decimation and multi-trace payload support), not yet started.

---

## 🔬 Overview

**TraceKit** eliminates the memory leaks, main-thread blocking, and rendering bottlenecks typical of traditional charting libraries when processing laboratory sweeps and streaming hardware telemetry.

Built upon a decoupled architecture, **TraceKit** isolates computational decimation and data transformation from the graphics pipeline. It features an isomorphic headless engine alongside zero-overhead reactive wrappers for **Vue 3** and **React**, sustaining **60 FPS** during continuous pan/zoom operations across $10^5$ to $10^6$ raw data points without Garbage Collection overhead.

### Key Performance Pillars

* **Zero-Copy Ingestion with Explicit Ownership:** Dedicated Web Workers execute decimation over transferred `ArrayBuffer`s, eliminating serialization cost. Because a transfer *detaches* the buffer in the sender, transport is a pooled round trip with a single owner at any instant and back-pressure that drops rather than allocates — the main thread always retains an authoritative copy, which is what makes WebGL context restoration possible at all.
* **Hybrid Dual-Engine Strategy `[PARTIAL]`:** The design targets hysteresis-stabilized switching between a **Canvas 2D batch renderer** and a high-density **WebGL2 pipeline** using dual Vertex Buffer Objects to avoid CPU interleaving, with a switch threshold evaluated on the *decimated* point count and a minimum dwell time so a live stream cannot oscillate between engines. **Only the Canvas2D renderer exists today; WebGL2 is not implemented yet**, so there is currently one engine, not a hybrid.
* **Physics-Preserving Decimation:** Combines standard **LTTB** (perceptual trace fidelity) with **Min-Max Envelope** algorithms to prevent the suppression of sub-picometer resonance dips, insertion losses, and high-frequency noise floors. Implemented and benchmarked in `@trace-kit/core`.
* **Logarithmic & Multi-Axis Viewport:** `@trace-kit/core`'s projection layer supports base-10 logarithmic Y-axis transforms (with decade/mantissa tick selection) alongside the linear transform, and multi-axis viewports with N independent, left-stacked Y axes sharing one X domain — direct groundwork for dBm-scale instrumentation and multi-trace comparison.
* **Visual Regression Harness:** A Chromium-based visual regression suite (`packages/renderers/test/visual/`) compares rendered Canvas2D output against committed golden screenshots. Goldens are generated and compared exclusively on `ubuntu-latest` in CI (a platform guard prevents local runs from being treated as authoritative), and can only be regenerated through a separate, human-triggered workflow — an ordinary test run can never silently overwrite a golden.
* **Semiconductor Wafer Map Engine:** Instanced rendering pipeline (`gl.drawArraysInstanced`) for multi-die inspection targeting 60,000 active dies, with analytical hit-testing that is $O(1)$ for a uniform reticle and degrades to $O(\log n)$ via cumulative pitch tables when street widths are non-uniform. Circular wafers and partial edge dies stay $O(1)$ through a dense occupancy grid.
* **Cross-Chart Synchronized Telemetry:** Decoupled `BroadcastChannel` / `EventTarget` bus syncing multiple telemetry channels (e.g., optical power, temperature, bias currents) across isolated canvases with GPU-accelerated CSS crosshair transforms.
* **Lossless Vector Reporting:** Standalone mathematical generator exporting sub-sampled views to clean, publication-grade SVG paths without canvas rasterization artifacts.

---

## 🏛️ Architecture

TraceKit is structured as an enterprise-grade monorepo powered by `pnpm` workspaces and `Turborepo`:

```text
trace-kit/
├── packages/
│   ├── core/           # [IMPLEMENTED] Isomorphic TS. Decimation (LTTB, Min-Max), transport
│   │                   #   contract, viewport transform (linear + logarithmic, multi-axis)
│   ├── renderers/      # [IMPLEMENTED, Canvas2D only] Path2D batching, multi-axis gutters.
│   │                   #   No WebGL2 yet.
│   ├── vue/            # [PLANNED] Vue 3: shallowRef/markRaw, useSpectrumEngine composable
│   └── react/          # [PLANNED] React: canvas hooks, Next.js SSR-safe
├── apps/
│   ├── docs/           # [PLANNED] VitePress docs with a runtime framework switcher
│   └── playground/     # [IMPLEMENTED] Vite app: home route + core-math visualization route
└── tests/              # Tests live beside each package, not under a shared root
    ├── unit/           # [IMPLEMENTED] Vitest over core and renderers (hundreds of tests)
    └── visual/          # [IMPLEMENTED] Playwright/Chromium Canvas2D visual regression,
                          #   Linux-CI-only, human-triggered golden updates
```

### Decoupled Graphics Pipeline

> The diagram below shows the intended full pipeline. Today only the `Canvas2DRenderer` branch
> is implemented; `WebGL2Renderer`, `@trace-kit/vue`, and `@trace-kit/react` are `[PLANNED]`.

```text
[ Data Source / Stream ]
          │
          ▼  (ArrayBuffer Transfer)
┌──────────────────────────────────────┐
│        @trace-kit/core Worker        │  ← Zero-Copy LTTB & Min-Max Decimation
└──────────────────┬───────────────────┘
                   │  Float32Array
                   ▼
┌──────────────────────────────────────┐
│       @trace-kit/renderers           │  ← Headless Interface (FigureRenderer)
│   - setData()  [Memory Upload]       │
│   - render()   [Draw Call Only]      │
└──────────┬────────────────┬──────────┘
           │                │
           ▼                ▼
┌────────────────────┐   ┌────────────────────┐
│  Canvas2DRenderer  │   │   WebGL2Renderer   │  ← Dual-VBO, GPU-side ClipSpace Math
│  (below threshold) │   │  (above threshold) │
└────────────────────┘   └────────────────────┘
           ▲                        ▲
           └────────────┬───────────┘
                        │ Controlled Lifecycle
┌───────────────────────┴───────────────────────┐
│     @trace-kit/vue   |   @trace-kit/react     │  ← Reactive isolation (shallowRef / useRef)
└───────────────────────────────────────────────┘
```

---

## 📦 Packages & Subpath Exports

All modules feature strict tree-shaking flags (`"sideEffects": false`) and support dual ESM (`.mjs`) and CommonJS (`.cjs`) builds:

> **None of these packages are published yet.** The commands below will fail with a
> registry 404. They document the intended install surface.

```bash
# Core mathematical engine (zero dependencies, Node.js and SSR safe)
pnpm add @trace-kit/core

# Headless Canvas2D and WebGL2 renderers
pnpm add @trace-kit/renderers

# Framework-specific integrations
pnpm add @trace-kit/vue
pnpm add @trace-kit/react
```

---

## 🚀 Quickstart

> **The examples in this section are not runnable yet.** They describe the intended
> API and serve as a design reference. Names and signatures may still change; the
> current contract lives in the specs under `openspec/changes/`.


### 1. Vue 3 Integration (Composition API)

The component relies on `shallowRef` to bypass deep Vue Proxies, keeping telemetry data out of the Virtual DOM reconciliation loop:

```vue
<script setup lang="ts">
import { shallowRef, onMounted } from 'vue';
import { TraceSpectrumViewer } from '@trace-kit/vue';
import type { WavelengthBuffer, PowerDbmBuffer } from '@trace-kit/core';

// Branded typed buffers
const wavelengths = shallowRef<WavelengthBuffer>(new Float32Array(150_000) as WavelengthBuffer);
const powers = shallowRef<PowerDbmBuffer>(new Float32Array(150_000) as PowerDbmBuffer);

onMounted(async () => {
  // Ingest high-density optical sweep
  const response = await fetch('/api/telemetry/sweep-01');
  const buffer = await response.arrayBuffer();
  // Decode directly into typed buffers...
});
</script>

<template>
  <div class="h-[500px] w-full bg-slate-950">
    <TraceSpectrumViewer
      :domain-x="[1500, 1600]"
      :domain-y="[-60, 5]"
      :powers="powers"
      :wavelengths="wavelengths"
      threshold-mode="auto"
    >
      <template #overlay="{ cursorX, cursorY }">
        <div class="pointer-events-none absolute top-2 right-2 text-xs font-mono text-cyan-400">
          λ: {{ cursorX?.toFixed(3) }} nm | P: {{ cursorY?.toFixed(2) }} dBm
        </div>
      </template>
    </TraceSpectrumViewer>
  </div>
</template>
```

### 2. React Integration (TSX)

```tsx
import React, { useRef } from 'react';
import { TraceSpectrumViewer } from '@trace-kit/react';
import type { WavelengthBuffer, PowerDbmBuffer } from '@trace-kit/core';

export const OpticalBenchMonitor: React.FC = () => {
  const xData = useRef<WavelengthBuffer>(new Float32Array(500_000) as WavelengthBuffer);
  const yData = useRef<PowerDbmBuffer>(new Float32Array(500_000) as PowerDbmBuffer);

  return (
    <div style={{ width: '100%', height: '450px' }}>
      <TraceSpectrumViewer
        domainX={[1520, 1580]}
        domainY={[-50, 0]}
        wavelengths={xData.current}
        powers={yData.current}
        thresholdMode="webgl"
      />
    </div>
  );
};
```

### 3. Headless Vanilla JS / Node.js Usage

The decimation and viewport math in `@trace-kit/core` and the `Canvas2DRenderer` in
`@trace-kit/renderers` are real and implemented today; this example is closer to the actual API
surface than the Vue/React examples above, though names and signatures may still change before a
publish. `WebGL2Renderer` does not exist yet — Canvas2D is the only renderer available:

```ts
import { minMaxEnvelope } from '@trace-kit/core';
import { Canvas2DRenderer } from '@trace-kit/renderers';

// Server-side decimation (100% isomorphic, Node.js compatible)
const { reducedX, reducedY } = minMaxEnvelope(rawX, rawY, { targetPoints: 2000 });

// Client-side direct renderer mounting (Canvas2D only — WebGL2 is [PLANNED])
const canvas = document.getElementById('plot') as HTMLCanvasElement;
const renderer = new Canvas2DRenderer();
renderer.initialize(canvas);
renderer.setData({ id: 'trace-1', wavelengths: rawX, powers: rawY });
renderer.setTransform({
  width: 1024,
  height: 600,
  dpr: window.devicePixelRatio,
  domainX: [1500, 1600],
  domainY: [-40, 10], // also supports a logarithmic (base-10) Y scale
});
renderer.render();
```

---

## 📊 Benchmarks & Technical Verification

No benchmark *numbers* are published yet. Allocation behaviour is already continuously verified,
just not reported as figures: Node `--expose-gc` + `PerformanceObserver({entryTypes:["gc"]})`
gates assert zero GC events over N iterations for hot-path decimation functions, with positive
controls proving the gate can actually fail.

A previous revision of this README contained a performance table with specific frame times, a
`JS Heap Delta` column reading `0.0 MB`, and sustained framerates, described as measured on
Apple Silicon under continuous pan/zoom. Those figures were never measured — the renderers they
described do not exist. The table has been removed rather than corrected.

Two commitments for when real numbers arrive:

- Every published figure will name the exact hardware, browser build, dataset and methodology
  (warm-up, iteration count, median and p95), and will be reproducible from a committed
  benchmark script.
- Allocation behaviour will **not** be reported via `performance.memory`. It is Chromium-only,
  non-standard, and deliberately quantized, so it cannot demonstrate zero allocation per frame.
  Node-side measurements assert zero GC events over N iterations; browser-side measurements
  assert zero bytes attributed to the named hot-path function in a CDP sampling profile. Both
  approaches are already demonstrated by re-runnable probes under
  `openspec/changes/00-roadmap-decomposition/evidence/`.

Interactive benchmarks are planned for the playground's `/stress-test-lab` route.

---

## 🛠️ Development & Tooling Workflow

This project strictly adheres to **Spec-Driven Development (SDD)** and **Test-Driven Development (TDD)**.

```bash
# Install dependencies across all workspace packages
pnpm install

# Type-check the whole workspace
pnpm typecheck

# Build the workspace packages
pnpm build

# Unit and integration tests (Vitest, hundreds of passing tests across core and renderers)
pnpm run test

# Lint
pnpm exec turbo run lint

# Run the playground app locally
pnpm --filter playground dev

# --- Not available yet: these workspaces do not exist ---
# pnpm --filter docs dev        (VitePress documentation — apps/docs is [PLANNED])

# --- CI-only by design, not locally authoritative ---
# Visual regression (Chromium via Playwright) runs against goldens generated on ubuntu-latest;
# see .github/workflows/ci.yml. Goldens are only ever (re)generated by the separate,
# human-triggered update-visual-goldens.yml workflow.
```

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for complete terms.
