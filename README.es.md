[🇬🇧 Read in English](./README.md)

# ⚡ TraceKit

> **Motor de visualización de señales físicas y telemetría headless de alto rendimiento.**  
> Diseñado para caracterización de hardware de misión crítica, barridos masivos de series temporales y analítica de rendimiento de obleas semiconductoras.

[![CI Status](https://github.com/nelomr/trace-kit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nelomr/trace-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@trace-kit/core?style=flat-square)](https://www.npmjs.com/package/@trace-kit/core)
[![PRs - Not accepting yet](https://img.shields.io/badge/PRs-Not_accepting_yet-red.svg?style=flat-square)](CONTRIBUTING.md)

---

## 🔬 Descripción general

**TraceKit** elimina las fugas de memoria, el bloqueo del hilo principal y los cuellos de botella de renderizado típicos de las bibliotecas de gráficos tradicionales al procesar barridos de laboratorio y telemetría de hardware en streaming.

Construido sobre una arquitectura desacoplada, **TraceKit** aísla la decimación computacional y la transformación de datos del pipeline gráfico. Presenta un motor headless isomórfico junto con wrappers reactivos de sobrecarga cero para **Vue 3** y **React**, manteniendo **60 FPS** durante operaciones continuas de pan/zoom sobre $10^5$ a $10^6$ puntos de datos sin sobrecarga del Garbage Collector.

### Pilares clave de rendimiento

* **Ingestión real sin copia (Zero-Copy):** Web Workers dedicados ejecutan decimación matemática mediante Transferable Objects (`postMessage(msg, [buffer])`), eliminando retrasos de serialización y la contención del hilo de UI.
* **Estrategia de motor dual híbrido:** Conmutación dinámica de ejecución entre un **renderizador Canvas 2D por lotes** de baja latencia (menos de 80k puntos) y un **pipeline WebGL2** de alta densidad (80k–1M+ puntos) utilizando Vertex Buffer Objects (VBOs) duales para eliminar la intercalación en CPU.
* **Decimación que preserva la física:** Combina **LTTB** estándar (fidelidad perceptual de la traza) con algoritmos de **envolvente Min-Max** para evitar la supresión de caídas de resonancia sub-picométricas, pérdidas de inserción y pisos de ruido de alta frecuencia.
* **Motor de mapa de obleas semiconductoras:** Pipeline de renderizado 2D instanciado integrado (`gl.drawArraysInstanced`) para inspección de calidad multi-die soportando hasta 60.000 dies activos con hit-testing analítico en $O(1)$.
* **Telemetría sincronizada entre gráficos:** Bus desacoplado `BroadcastChannel` / `EventTarget` sincronizando múltiples canales de telemetría (p. ej., potencia óptica, temperatura, corrientes de bias) a través de canvas aislados con transformaciones CSS de cruceta aceleradas por GPU.
* **Reportes vectoriales sin pérdida:** Generador matemático independiente que exporta vistas sub-muestreadas a paths SVG limpios, con calidad de publicación, sin artefactos de rasterización del canvas.

---

## 🏛️ Arquitectura

TraceKit está estructurado como un monorepo de grado empresarial impulsado por workspaces de `pnpm` y `Turborepo`:

```text
trace-kit/
├── packages/
│   ├── core/           # 100% TS isomórfico: Buffers tipados, LTTB, Min-Max, Workers
│   ├── renderers/      # Headless Vanilla JS: Canvas2D (Path2D) y WebGL2 (Shaders Dual-VBO)
│   ├── vue/            # Vue 3: wrappers shallowRef/markRaw, composable useSpectrumEngine
│   └── react/          # React: Hooks de canvas no gestionado, useSpectrumEngine, SSR-safe Next.js
├── apps/
│   ├── docs/           # Documentación interactiva VitePress con selector de framework en runtime
│   └── playground/     # Banco de pruebas de estrés en tiempo real con telemetría FPS y controles Tweakpane
└── tests/
    ├── unit/           # Cobertura 100% Vitest sobre algoritmos matemáticos y de decimación puros
    └── e2e/            # Pruebas de regresión visual Playwright cross-engine
```

### Pipeline gráfico desacoplado

```text
[ Fuente de datos / Stream ]
          │
          ▼  (Transferencia ArrayBuffer)
┌──────────────────────────────────────┐
│        @trace-kit/core Worker        │  ← Decimación LTTB y Min-Max sin copia
└──────────────────┬───────────────────┘
                   │  Float32Array
                   ▼
┌──────────────────────────────────────┐
│       @trace-kit/renderers           │  ← Interfaz headless (FigureRenderer)
│   - setData()  [Carga en memoria]    │
│   - render()   [Solo Draw Call]      │
└──────────┬────────────────┬──────────┘
           │                │
           ▼                ▼
┌────────────────────┐   ┌────────────────────┐
│  Canvas2DRenderer  │   │   WebGL2Renderer   │  ← Dual-VBO, matemáticas ClipSpace en GPU
│  (< 80k puntos)    │   │   (> 80k puntos)   │
└────────────────────┘   └────────────────────┘
           ▲                        ▲
           └────────────┬───────────┘
                        │ Ciclo de vida controlado
┌───────────────────────┴───────────────────────┐
│     @trace-kit/vue   |   @trace-kit/react     │  ← Aislamiento reactivo (shallowRef / useRef)
└───────────────────────────────────────────────┘
```

---

## 📦 Paquetes y exportaciones por subruta

Todos los módulos incluyen flags estrictos de tree-shaking (`"sideEffects": false`) y soportan builds duales ESM (`.mjs`) y CommonJS (`.cjs`):

```bash
# Motor matemático core (sin dependencias, compatible con Node.js y SSR)
pnpm add @trace-kit/core

# Renderizadores headless Canvas2D y WebGL2
pnpm add @trace-kit/renderers

# Integraciones específicas por framework
pnpm add @trace-kit/vue
pnpm add @trace-kit/react
```

---

## 🚀 Inicio rápido

### 1. Integración Vue 3 (Composition API)

El componente utiliza `shallowRef` para evitar los Proxies profundos de Vue, manteniendo los datos de telemetría fuera del bucle de reconciliación del Virtual DOM:

```vue
<script setup lang="ts">
import { shallowRef, onMounted } from 'vue';
import { TraceSpectrumViewer } from '@trace-kit/vue';
import type { WavelengthBuffer, PowerDbmBuffer } from '@trace-kit/core';

// Buffers tipados con marca
const wavelengths = shallowRef<WavelengthBuffer>(new Float32Array(150_000) as WavelengthBuffer);
const powers = shallowRef<PowerDbmBuffer>(new Float32Array(150_000) as PowerDbmBuffer);

onMounted(async () => {
  // Ingestar barrido óptico de alta densidad
  const response = await fetch('/api/telemetry/sweep-01');
  const buffer = await response.arrayBuffer();
  // Decodificar directamente en buffers tipados...
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

### 2. Integración React (TSX)

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

### 3. Uso headless con Vanilla JS / Node.js

Ejecutar algoritmos de decimación en el servidor o integrar directamente con canvas no gestionados:

```ts
import { lttb, minMaxEnvelope } from '@trace-kit/core';
import { WebGLRenderer } from '@trace-kit/renderers';

// Decimación del lado del servidor (100% isomórfico, compatible con Node.js)
const { reducedX, reducedY } = minMaxEnvelope(rawX, rawY, { targetPoints: 2000 });

// Montaje directo del renderizador en el cliente
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

## 📊 Benchmarks y verificación técnica

Medido en Apple Silicon / Chrome 128+ bajo ejecución continua de pan/zoom en tiempo real:

| Tamaño del dataset (puntos) | Motor | Decimación | Tiempo de frame (render) | Delta heap JS | Framerate sostenido |
|------------------------------|-------|------------|--------------------------|---------------|---------------------|
| 50.000 | Canvas 2D (Path2D) | Ninguna | 4,2 ms | 0,0 MB | 60 FPS |
| 200.000 | WebGL2 (Dual-VBO) | LTTB (Worker) | 1,8 ms | 0,0 MB | 60 FPS |
| 1.000.000 | WebGL2 (Dual-VBO) | Min-Max (Worker) | 2,6 ms | 0,0 MB | 60 FPS |
| 60.000 Dies | WebGL2 (Instanciado) | Ninguna ($O(1)$ Hit-Test) | 5,1 ms | 0,0 MB | 60 FPS |

Los benchmarks interactivos están disponibles localmente mediante `pnpm --filter playground dev` en la ruta `/stress-test-lab`.

---

## 🛠️ Desarrollo y flujo de herramientas

Este proyecto se adhiere estrictamente a **Spec-Driven Development (SDD)** y **Test-Driven Development (TDD)**.

```bash
# Instalar dependencias en todos los paquetes del workspace
pnpm install

# Ejecutar tests unitarios en todos los paquetes isomórficos (Vitest)
pnpm test:unit

# Ejecutar suite de regresión visual contra backends WebGL/Canvas reales (Playwright)
pnpm test:visual

# Iniciar la documentación interactiva (VitePress)
pnpm --filter docs dev

# Lanzar el banco de pruebas de estrés (Vite + Tweakpane)
pnpm --filter playground dev

# Compilar bundles de distribución universal (tsup)
pnpm build
```

---

## 📄 Licencia

Distribuido bajo la **Licencia MIT**. Consulta [LICENSE](LICENSE) para los términos completos.
