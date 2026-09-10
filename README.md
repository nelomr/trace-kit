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

> **TraceKit is pre-alpha. Nothing is published to npm yet, and most of what this document
> describes is not implemented.** This README documents the *intended* architecture and API. It
> is a design document, not a usage guide.
>
> **What exists today:** `packages/core` with a single `VERSION` export, the pnpm + Turborepo
> workspace, and CI. Nothing else.
>
> **What does not exist yet:** `packages/renderers`, `packages/vue`, `packages/react`,
> `apps/docs`, `apps/playground`, the test suites, and every published package. The install
> commands and Quickstart examples below will not work.
>
> Development follows Spec-Driven Development; the planned sequence of work and its ordering live
> in [`openspec/roadmap.yaml`](openspec/roadmap.yaml), with scope and rationale in
> `openspec/changes/`.

---

## 🔬 Overview

**TraceKit** eliminates the memory leaks, main-thread blocking, and rendering bottlenecks typical of traditional charting libraries when processing laboratory sweeps and streaming hardware telemetry.

Built upon a decoupled architecture, **TraceKit** isolates computational decimation and data transformation from the graphics pipeline. It features an isomorphic headless engine alongside zero-overhead reactive wrappers for **Vue 3** and **React**, sustaining **60 FPS** during continuous pan/zoom operations across $10^5$ to $10^6$ raw data points without Garbage Collection overhead.

### Key Performance Pillars

* **Zero-Copy Ingestion with Explicit Ownership:** Dedicated Web Workers execute decimation over transferred `ArrayBuffer`s, eliminating serialization cost. Because a transfer *detaches* the buffer in the sender, transport is a pooled round trip with a single owner at any instant and back-pressure that drops rather than allocates — the main thread always retains an authoritative copy, which is what makes WebGL context restoration possible at all.
* **Hybrid Dual-Engine Strategy:** Hysteresis-stabilized switching between a **Canvas 2D batch renderer** and a high-density **WebGL2 pipeline** using dual Vertex Buffer Objects to avoid CPU interleaving. The switch threshold is a measured, configurable constant evaluated on the *decimated* point count — not a fixed raw-point number — with two thresholds and a minimum dwell time so a live stream cannot oscillate between engines.
* **Physics-Preserving Decimation:** Combines standard **LTTB** (perceptual trace fidelity) with **Min-Max Envelope** algorithms to prevent the suppression of sub-picometer resonance dips, insertion losses, and high-frequency noise floors.
* **Semiconductor Wafer Map Engine:** Instanced rendering pipeline (`gl.drawArraysInstanced`) for multi-die inspection targeting 60,000 active dies, with analytical hit-testing that is $O(1)$ for a uniform reticle and degrades to $O(\log n)$ via cumulative pitch tables when street widths are non-uniform. Circular wafers and partial edge dies stay $O(1)$ through a dense occupancy grid.
* **Cross-Chart Synchronized Telemetry:** Decoupled `BroadcastChannel` / `EventTarget` bus syncing multiple telemetry channels (e.g., optical power, temperature, bias currents) across isolated canvases with GPU-accelerated CSS crosshair transforms.
* **Lossless Vector Reporting:** Standalone mathematical generator exporting sub-sampled views to clean, publication-grade SVG paths without canvas rasterization artifacts.

---

## 🏛️ Architecture

TraceKit is structured as an enterprise-grade monorepo powered by `pnpm` workspaces and `Turborepo`:

```text
trace-kit/
├── packages/
│   ├── core/           # [EXISTS, minimal] Isomorphic TS. Today it only exports VERSION
│   ├── renderers/      # [PLANNED] Headless Canvas2D (Path2D) and WebGL2
│   ├── vue/            # [PLANNED] Vue 3: shallowRef/markRaw, useSpectrumEngine composable
│   └── react/          # [PLANNED] React: canvas hooks, Next.js SSR-safe
├── apps/
│   ├── docs/           # [PLANNED] VitePress docs with a runtime framework switcher
│   └── playground/     # [PLANNED] Stress workbench with FPS telemetry and Tweakpane
└── tests/              # [PLANNED] Tests live beside each package, not under a shared root
    ├── unit/           # [PLANNED] Vitest over pure math and decimation
    └── e2e/            # [PLANNED] Playwright cross-engine visual regression
```

### Decoupled Graphics Pipeline

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

Execute decimation algorithms server-side or integrate directly with unmanaged canvases:

```ts
import { lttb, minMaxEnvelope } from '@trace-kit/core';
import { WebGL2Renderer } from '@trace-kit/renderers';

// Server-side decimation (100% isomorphic, Node.js compatible)
const { reducedX, reducedY } = minMaxEnvelope(rawX, rawY, { targetPoints: 2000 });

// Client-side direct renderer mounting
const canvas = document.getElementById('plot') as HTMLCanvasElement;
const renderer = new WebGL2Renderer();
renderer.initialize(canvas);
renderer.setData({ id: 'trace-1', wavelengths: rawX, powers: rawY });
renderer.setTransform({
  width: 1024,
  height: 600,
  dpr: window.devicePixelRatio,
  domainX: [1500, 1600],
  domainY: [-40, 10],
});
renderer.render();
```

---

## 📊 Benchmarks & Technical Verification

No benchmarks are published yet, because nothing is implemented to benchmark.

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

# Unit tests (the script exists, but there are no tests to run yet)
pnpm test:unit

# --- Not available yet: these workspaces and scripts do not exist ---
# pnpm test:visual              (Playwright visual regression)
# pnpm --filter docs dev        (VitePress documentation)
# pnpm --filter playground dev  (stress-test workbench)
```

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for complete terms.
