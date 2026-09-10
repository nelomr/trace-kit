[🇪🇸 Leer en español](./README.es.md)

# ⚡ TraceKit

> **High-throughput, headless telemetry and physical signal visualization engine.**  
> Engineered for mission-critical hardware characterization, massive time-series sweeps, and semiconductor wafer yield analytics.

[![CI Status](https://github.com/nelomr/trace-kit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nelomr/trace-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@trace-kit/core?style=flat-square)](https://www.npmjs.com/package/@trace-kit/core)
[![PRs - Not accepting yet](https://img.shields.io/badge/PRs-Not_accepting_yet-red.svg?style=flat-square)](CONTRIBUTING.md)

---

## 🔬 Overview

**TraceKit** eliminates the memory leaks, main-thread blocking, and rendering bottlenecks typical of traditional charting libraries when processing laboratory sweeps and streaming hardware telemetry.

Built upon a decoupled architecture, **TraceKit** isolates computational decimation and data transformation from the graphics pipeline. It features an isomorphic headless engine alongside zero-overhead reactive wrappers for **Vue 3** and **React**, sustaining **60 FPS** during continuous pan/zoom operations across $10^5$ to $10^6$ raw data points without Garbage Collection overhead.

### Key Performance Pillars

* **True Zero-Copy Ingestion:** Dedicated Web Workers execute mathematical decimation via Transferable Objects (`postMessage(msg, [buffer])`), eliminating serialization delays and UI thread contention.
* **Hybrid Dual-Engine Strategy:** Dynamic execution switching between a low-latency **Canvas 2D batch renderer** (sub-80k points) and a high-density **WebGL2 pipeline** (80k–1M+ points) utilizing dual Vertex Buffer Objects (VBOs) to eliminate CPU interleaving.
* **Physics-Preserving Decimation:** Combines standard **LTTB** (perceptual trace fidelity) with **Min-Max Envelope** algorithms to prevent the suppression of sub-picometer resonance dips, insertion losses, and high-frequency noise floors.
* **Semiconductor Wafer Map Engine:** Integrated 2D instanced rendering pipeline (`gl.drawArraysInstanced`) for multi-die quality inspection supporting up to 60,000 active dies with $O(1)$ analytical hit-testing.
* **Cross-Chart Synchronized Telemetry:** Decoupled `BroadcastChannel` / `EventTarget` bus syncing multiple telemetry channels (e.g., optical power, temperature, bias currents) across isolated canvases with GPU-accelerated CSS crosshair transforms.
* **Lossless Vector Reporting:** Standalone mathematical generator exporting sub-sampled views to clean, publication-grade SVG paths without canvas rasterization artifacts.

---

## 🏛️ Architecture

TraceKit is structured as an enterprise-grade monorepo powered by `pnpm` workspaces and `Turborepo`:

```text
trace-kit/
├── packages/
│   ├── core/           # 100% Isomorphic TS: Typed branded buffers, LTTB, Min-Max, Workers
│   ├── renderers/      # Headless Vanilla JS: Canvas2D (Path2D) & WebGL2 (Dual-VBO Shaders)
│   ├── vue/            # Vue 3: shallowRef/markRaw wrappers, useSpectrumEngine composable
│   └── react/          # React: Unmanaged canvas hooks, useSpectrumEngine, Next.js SSR-safe
├── apps/
│   ├── docs/           # VitePress interactive docs with runtime framework switcher
│   └── playground/     # Real-time stress workbench with FPS telemetry and Tweakpane controls
└── tests/
    ├── unit/           # 100% Vitest coverage over pure math & decimation algorithms
    └── e2e/            # Playwright cross-engine visual regression testing
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
│  (< 80k points)    │   │   (> 80k points)   │
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
import { WebGLRenderer } from '@trace-kit/renderers';

// Server-side decimation (100% isomorphic, Node.js compatible)
const { reducedX, reducedY } = minMaxEnvelope(rawX, rawY, { targetPoints: 2000 });

// Client-side direct renderer mounting
const canvas = document.getElementById('plot') as HTMLCanvasElement;
const renderer = new WebGLRenderer();
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

Benchmarked on Apple Silicon / Chrome 128+ under continuous real-time pan/zoom execution:

| Dataset Size (Points) | Engine | Decimation | Frame Time (Render) | JS Heap Delta | Sustained Framerate |
|------------------------|--------|------------|---------------------|---------------|---------------------|
| 50,000 | Canvas 2D (Path2D) | None | 4.2 ms | 0.0 MB | 60 FPS |
| 200,000 | WebGL2 (Dual-VBO) | LTTB (Worker) | 1.8 ms | 0.0 MB | 60 FPS |
| 1,000,000 | WebGL2 (Dual-VBO) | Min-Max (Worker) | 2.6 ms | 0.0 MB | 60 FPS |
| 60,000 Dies | WebGL2 (Instanced) | None ($O(1)$ Hit-Test) | 5.1 ms | 0.0 MB | 60 FPS |

Interactive benchmarks are available locally via `pnpm --filter playground dev` under the `/stress-test-lab` route.

---

## 🛠️ Development & Tooling Workflow

This project strictly adheres to **Spec-Driven Development (SDD)** and **Test-Driven Development (TDD)**.

```bash
# Install dependencies across all workspace packages
pnpm install

# Run unit tests across all isomorphic packages (Vitest)
pnpm test:unit

# Execute visual regression suite against actual WebGL/Canvas backends (Playwright)
pnpm test:visual

# Start the interactive documentation (VitePress)
pnpm --filter docs dev

# Launch the stress-test workbench (Vite + Tweakpane)
pnpm --filter playground dev

# Compile universal distribution bundles (tsup)
pnpm build
```

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for complete terms.
