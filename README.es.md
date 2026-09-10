[🇬🇧 Read in English](./README.md)

# ⚡ TraceKit

> **Motor de visualización de señales físicas y telemetría headless de alto rendimiento.**  
> Diseñado para caracterización de hardware de misión crítica, barridos masivos de series temporales y analítica de rendimiento de obleas semiconductoras.

[![CI Status](https://github.com/nelomr/trace-kit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nelomr/trace-kit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Status: pre-alpha](https://img.shields.io/badge/Status-pre--alpha-orange.svg?style=flat-square)](#-project-status)
[![Version: 0.0.0](https://img.shields.io/badge/Version-0.0.0_(unpublished)-lightgrey.svg?style=flat-square)](#-project-status)
[![PRs - Not accepting yet](https://img.shields.io/badge/PRs-Not_accepting_yet-red.svg?style=flat-square)](CONTRIBUTING.md)

---

## 🚧 Estado del proyecto

> **TraceKit está en pre-alpha. Nada está publicado en npm todavía, y la mayor parte de lo que
> describe este documento no está implementado.** Este README documenta la arquitectura y la API
> *previstas*. Es un documento de diseño, no una guía de uso.
>
> **Lo que existe hoy:** `packages/core` con una única exportación `VERSION`, el workspace de
> pnpm + Turborepo, y CI. Nada más.
>
> **Lo que todavía no existe:** `packages/renderers`, `packages/vue`, `packages/react`,
> `apps/docs`, `apps/playground`, las suites de tests, y todos los paquetes publicados. Los
> comandos de instalación y los ejemplos de inicio rápido de abajo no funcionan.
>
> El desarrollo sigue Spec-Driven Development; la secuencia de trabajo prevista y su orden están
> en [`openspec/roadmap.yaml`](openspec/roadmap.yaml), y el alcance y la justificación en
> `openspec/changes/`.

---

## 🔬 Descripción general

**TraceKit** elimina las fugas de memoria, el bloqueo del hilo principal y los cuellos de botella de renderizado típicos de las bibliotecas de gráficos tradicionales al procesar barridos de laboratorio y telemetría de hardware en streaming.

Construido sobre una arquitectura desacoplada, **TraceKit** aísla la decimación computacional y la transformación de datos del pipeline gráfico. Presenta un motor headless isomórfico junto con wrappers reactivos de sobrecarga cero para **Vue 3** y **React**, manteniendo **60 FPS** durante operaciones continuas de pan/zoom sobre $10^5$ a $10^6$ puntos de datos sin sobrecarga del Garbage Collector.

### Pilares clave de rendimiento

* **Ingestión sin copia con propiedad explícita:** Web Workers dedicados ejecutan la decimación sobre `ArrayBuffer` transferidos, eliminando el coste de serialización. Como una transferencia *desvincula* (detach) el buffer en el emisor, el transporte es un round-trip agrupado con un único propietario en cada instante y contrapresión que descarta en lugar de asignar. El hilo principal conserva siempre una copia autoritativa, que es lo que hace posible la restauración del contexto WebGL.
* **Estrategia de motor dual híbrido:** Conmutación estabilizada por histéresis entre un **renderizador Canvas 2D por lotes** y un **pipeline WebGL2** de alta densidad con Vertex Buffer Objects duales para evitar la intercalación en CPU. El umbral de conmutación es una constante medida y configurable, evaluada sobre el conteo de puntos *decimado* y no sobre un número fijo de puntos crudos, con dos umbrales y un tiempo mínimo de permanencia para que un stream en vivo no pueda oscilar entre motores.
* **Decimación que preserva la física:** Combina **LTTB** estándar (fidelidad perceptual de la traza) con algoritmos de **envolvente Min-Max** para evitar la supresión de caídas de resonancia sub-picométricas, pérdidas de inserción y pisos de ruido de alta frecuencia.
* **Motor de mapa de obleas semiconductoras:** Pipeline de renderizado instanciado (`gl.drawArraysInstanced`) para inspección multi-die con objetivo de 60.000 dies activos, y hit-testing analítico en $O(1)$ para retícula uniforme que degrada a $O(\log n)$ mediante tablas de pitch acumulado cuando los anchos de street no son uniformes. Las obleas circulares y los dies parciales de borde se mantienen en $O(1)$ mediante una rejilla densa de ocupación.
* **Telemetría sincronizada entre gráficos:** Bus desacoplado `BroadcastChannel` / `EventTarget` sincronizando múltiples canales de telemetría (p. ej., potencia óptica, temperatura, corrientes de bias) a través de canvas aislados con transformaciones CSS de cruceta aceleradas por GPU.
* **Reportes vectoriales sin pérdida:** Generador matemático independiente que exporta vistas sub-muestreadas a paths SVG limpios, con calidad de publicación, sin artefactos de rasterización del canvas.

---

## 🏛️ Arquitectura

TraceKit está estructurado como un monorepo de grado empresarial impulsado por workspaces de `pnpm` y `Turborepo`:

```text
trace-kit/
├── packages/
│   ├── core/           # [EXISTE, mínimo] TS isomórfico. Hoy solo exporta VERSION
│   ├── renderers/      # [PREVISTO] Canvas2D (Path2D) y WebGL2 headless
│   ├── vue/            # [PREVISTO] Vue 3: shallowRef/markRaw, composable useSpectrumEngine
│   └── react/          # [PREVISTO] React: hooks de canvas, SSR-safe en Next.js
├── apps/
│   ├── docs/           # [PREVISTO] Docs VitePress con selector de framework
│   └── playground/     # [PREVISTO] Banco de estrés con telemetría de FPS y Tweakpane
└── tests/              # [PREVISTO] Los tests viven junto a cada paquete, no en una raíz común
    ├── unit/           # [PREVISTO] Vitest sobre matemática pura y decimación
    └── e2e/            # [PREVISTO] Regresión visual con Playwright
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
│  (bajo el umbral)  │   │ (sobre el umbral)  │
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

> **Ninguno de estos paquetes está publicado todavía.** Los comandos siguientes
> fallarán con un 404 del registry. Se documentan como la superficie de instalación
> prevista.

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

> **Los ejemplos de esta sección no son ejecutables todavía.** Describen la API
> prevista y sirven como referencia de diseño. Los nombres y las firmas pueden cambiar:
> el contrato vigente vive en los specs bajo `openspec/changes/`.


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
import { WebGL2Renderer } from '@trace-kit/renderers';

// Decimación del lado del servidor (100% isomórfico, compatible con Node.js)
const { reducedX, reducedY } = minMaxEnvelope(rawX, rawY, { targetPoints: 2000 });

// Montaje directo del renderizador en el cliente
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

## 📊 Benchmarks y verificación técnica

Todavía no hay benchmarks publicados, porque no hay nada implementado que medir.

Una revisión anterior de este README contenía una tabla de rendimiento con tiempos de frame
concretos, una columna `JS Heap Delta` con `0.0 MB` y tasas de refresco sostenidas, descritas
como medidas en Apple Silicon durante paneo y zoom continuos. Esas cifras nunca se midieron: los
renderizadores que describían no existen. La tabla se ha eliminado en lugar de corregirse.

Dos compromisos para cuando lleguen cifras reales:

- Toda cifra publicada nombrará el hardware exacto, la build del navegador, el dataset y la
  metodología (warm-up, número de iteraciones, mediana y p95), y será reproducible desde un
  script de benchmark versionado.
- El comportamiento de asignación de memoria **no** se reportará con `performance.memory`. Es
  exclusiva de Chromium, no estándar y está cuantizada deliberadamente, así que no puede
  demostrar cero asignaciones por frame. Las medidas en Node asertan cero eventos de GC en N
  iteraciones; las del navegador asertan cero bytes atribuidos a la función concreta del camino
  caliente en un perfil de muestreo de CDP. Ambos enfoques están ya demostrados con probes
  re-ejecutables en `openspec/changes/00-roadmap-decomposition/evidence/`.

Los benchmarks interactivos están previstos en la ruta `/stress-test-lab` del playground.

---

## 🛠️ Desarrollo y flujo de herramientas

Este proyecto se adhiere estrictamente a **Spec-Driven Development (SDD)** y **Test-Driven Development (TDD)**.

```bash
# Instalar dependencias en todos los paquetes del workspace
pnpm install

# Comprobación de tipos en todo el workspace
pnpm typecheck

# Compilar los paquetes del workspace
pnpm build

# Tests unitarios (el script existe, pero todavía no hay ningún test que ejecutar)
pnpm test:unit

# --- Todavía no disponibles: los workspaces y scripts no existen ---
# pnpm test:visual              (regresión visual con Playwright)
# pnpm --filter docs dev        (documentación VitePress)
# pnpm --filter playground dev  (banco de pruebas de estrés)
```

---

## 📄 Licencia

Distribuido bajo la **Licencia MIT**. Consulta [LICENSE](LICENSE) para los términos completos.
