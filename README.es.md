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

> **TraceKit está en pre-alpha. Nada está publicado en npm todavía.** Este README documenta tanto
> la implementación actual como, allí donde se marca `[PREVISTO]`, la arquitectura y la API
> previstas.
>
> **Lo que existe hoy:**
> - `packages/core` — sustancial: buffers tipados con marca, decimación LTTB y envolvente
>   Min-Max (camino caliente sin asignaciones, con benchmarks), el contrato de transporte sin
>   copia para Web Workers (protocolo de propiedad, detección de capacidad `SharedArrayBuffer`,
>   contrapresión), y la capa de transformación de viewport: proyección de eje Y lineal y
>   logarítmica (base 10), soporte de viewport multi-eje (N ejes Y independientes apilados a la
>   izquierda compartiendo un dominio X), y selección de ticks para ambas escalas.
> - `packages/renderers` — **únicamente un renderizador Canvas2D** (`Canvas2DRenderer`, batching
>   con Path2D, gutters con soporte multi-eje, líneas de rejilla por década para ejes
>   logarítmicos) más el contrato headless `FigureRenderer`. **Todavía no existe ningún
>   renderizador WebGL2.**
> - `apps/playground` — una app Vite en funcionamiento, con una ruta de inicio y una ruta
>   `core-math` que visualiza los algoritmos de decimación.
> - El workspace de pnpm + Turborepo, cientos de tests unitarios/de integración con Vitest en
>   verde, una suite de regresión visual basada en Chromium (exclusiva de CI en Linux por
>   diseño), comprobaciones de asignación cero en Node, y una puerta de calidad de CI
>   (comprobación de tipos, lint, tests unitarios, regresión visual, comprobación de
>   dependencias obsoletas) que se ejecuta y pasa en `main`.
>
> **Lo que todavía no existe:** `packages/vue`, `packages/react`, `apps/docs`, y ningún
> renderizador WebGL2. Todos los paquetes siguen sin publicar (`0.0.0`, privados). Los ejemplos
> de Vue/React del inicio rápido de abajo describen una API que todavía no existe; los comandos
> de instalación no funcionan.
>
> El desarrollo sigue Spec-Driven Development; el progreso se registra en
> [`openspec/roadmap.yaml`](openspec/roadmap.yaml). A fecha de esta revisión, los pasos 1 a
> **5.6** del roadmap (`core-scale-transforms` — transformaciones de viewport logarítmicas y
> multi-eje) están archivados y completos. El siguiente paso previsto es **5.7**
> (`core-gap-and-multi-trace-model` — semántica de huecos/NaN en la decimación y soporte de
> payload multi-traza), todavía no iniciado.

---

## 🔬 Descripción general

**TraceKit** elimina las fugas de memoria, el bloqueo del hilo principal y los cuellos de botella de renderizado típicos de las bibliotecas de gráficos tradicionales al procesar barridos de laboratorio y telemetría de hardware en streaming.

Construido sobre una arquitectura desacoplada, **TraceKit** aísla la decimación computacional y la transformación de datos del pipeline gráfico. Presenta un motor headless isomórfico junto con wrappers reactivos de sobrecarga cero para **Vue 3** y **React**, manteniendo **60 FPS** durante operaciones continuas de pan/zoom sobre $10^5$ a $10^6$ puntos de datos sin sobrecarga del Garbage Collector.

### Pilares clave de rendimiento

* **Ingestión sin copia con propiedad explícita:** Web Workers dedicados ejecutan la decimación sobre `ArrayBuffer` transferidos, eliminando el coste de serialización. Como una transferencia *desvincula* (detach) el buffer en el emisor, el transporte es un round-trip agrupado con un único propietario en cada instante y contrapresión que descarta en lugar de asignar. El hilo principal conserva siempre una copia autoritativa, que es lo que hace posible la restauración del contexto WebGL.
* **Estrategia de motor dual híbrido `[PARCIAL]`:** El diseño prevé una conmutación estabilizada por histéresis entre un **renderizador Canvas 2D por lotes** y un **pipeline WebGL2** de alta densidad con Vertex Buffer Objects duales para evitar la intercalación en CPU, con un umbral de conmutación evaluado sobre el conteo de puntos *decimado* y un tiempo mínimo de permanencia para evitar oscilaciones. **Hoy solo existe el renderizador Canvas2D; WebGL2 todavía no está implementado**, por lo que actualmente hay un único motor, no un sistema híbrido.
* **Decimación que preserva la física:** Combina **LTTB** estándar (fidelidad perceptual de la traza) con algoritmos de **envolvente Min-Max** para evitar la supresión de caídas de resonancia sub-picométricas, pérdidas de inserción y pisos de ruido de alta frecuencia. Implementado y con benchmarks en `@trace-kit/core`.
* **Viewport logarítmico y multi-eje:** La capa de proyección de `@trace-kit/core` soporta transformaciones de eje Y logarítmicas en base 10 (con selección de ticks por década/mantisa) junto con la transformación lineal, y viewports multi-eje con N ejes Y independientes apilados a la izquierda que comparten un dominio X — base directa para instrumentación en escala dBm y comparación multi-traza.
* **Arnés de regresión visual:** Una suite de regresión visual basada en Chromium (`packages/renderers/test/visual/`) compara la salida renderizada de Canvas2D contra capturas de pantalla de referencia (goldens) versionadas. Los goldens se generan y comparan exclusivamente en `ubuntu-latest` en CI (una comprobación de plataforma impide que las ejecuciones locales se traten como autoritativas), y solo pueden regenerarse mediante un workflow separado, disparado manualmente — una ejecución de tests ordinaria nunca puede sobrescribir un golden en silencio.
* **Motor de mapa de obleas semiconductoras:** Pipeline de renderizado instanciado (`gl.drawArraysInstanced`) para inspección multi-die con objetivo de 60.000 dies activos, y hit-testing analítico en $O(1)$ para retícula uniforme que degrada a $O(\log n)$ mediante tablas de pitch acumulado cuando los anchos de street no son uniformes. Las obleas circulares y los dies parciales de borde se mantienen en $O(1)$ mediante una rejilla densa de ocupación.
* **Telemetría sincronizada entre gráficos:** Bus desacoplado `BroadcastChannel` / `EventTarget` sincronizando múltiples canales de telemetría (p. ej., potencia óptica, temperatura, corrientes de bias) a través de canvas aislados con transformaciones CSS de cruceta aceleradas por GPU.
* **Reportes vectoriales sin pérdida:** Generador matemático independiente que exporta vistas sub-muestreadas a paths SVG limpios, con calidad de publicación, sin artefactos de rasterización del canvas.

---

## 🏛️ Arquitectura

TraceKit está estructurado como un monorepo de grado empresarial impulsado por workspaces de `pnpm` y `Turborepo`:

```text
trace-kit/
├── packages/
│   ├── core/           # [IMPLEMENTADO] TS isomórfico. Decimación (LTTB, Min-Max), contrato
│   │                   #   de transporte, transformación de viewport (lineal + logarítmica,
│   │                   #   multi-eje)
│   ├── renderers/      # [IMPLEMENTADO, solo Canvas2D] Batching con Path2D, gutters
│   │                   #   multi-eje. Todavía sin WebGL2.
│   ├── vue/            # [PREVISTO] Vue 3: shallowRef/markRaw, composable useSpectrumEngine
│   └── react/          # [PREVISTO] React: hooks de canvas, SSR-safe en Next.js
├── apps/
│   ├── docs/           # [PREVISTO] Docs VitePress con selector de framework
│   └── playground/     # [IMPLEMENTADO] App Vite: ruta de inicio + ruta de visualización core-math
└── tests/              # Los tests viven junto a cada paquete, no en una raíz común
    ├── unit/           # [IMPLEMENTADO] Vitest sobre core y renderers (cientos de tests)
    └── visual/          # [IMPLEMENTADO] Regresión visual Playwright/Chromium de Canvas2D,
                          #   exclusiva de CI en Linux, goldens actualizados manualmente
```

### Pipeline gráfico desacoplado

> El diagrama siguiente muestra el pipeline completo previsto. Hoy solo está implementada la
> rama `Canvas2DRenderer`; `WebGL2Renderer`, `@trace-kit/vue` y `@trace-kit/react` están
> `[PREVISTO]`.

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

La matemática de decimación y de viewport en `@trace-kit/core`, y el `Canvas2DRenderer` de
`@trace-kit/renderers`, son reales e implementados hoy; este ejemplo se acerca más a la
superficie de API real que los ejemplos de Vue/React anteriores, aunque los nombres y firmas
pueden cambiar antes de una publicación. `WebGL2Renderer` todavía no existe — Canvas2D es el
único renderizador disponible:

```ts
import { minMaxEnvelope } from '@trace-kit/core';
import { Canvas2DRenderer } from '@trace-kit/renderers';

// Decimación del lado del servidor (100% isomórfico, compatible con Node.js)
const { reducedX, reducedY } = minMaxEnvelope(rawX, rawY, { targetPoints: 2000 });

// Montaje directo del renderizador en el cliente (solo Canvas2D — WebGL2 está [PREVISTO])
const canvas = document.getElementById('plot') as HTMLCanvasElement;
const renderer = new Canvas2DRenderer();
renderer.initialize(canvas);
renderer.setData({ id: 'trace-1', wavelengths: rawX, powers: rawY });
renderer.setTransform({
  width: 1024,
  height: 600,
  dpr: window.devicePixelRatio,
  domainX: [1500, 1600],
  domainY: [-40, 10], // también soporta escala Y logarítmica (base 10)
});
renderer.render();
```

---

## 📊 Benchmarks y verificación técnica

Todavía no hay *cifras* de benchmark publicadas. El comportamiento de asignación de memoria ya
se verifica de forma continua, solo que no se reporta como cifras: comprobaciones en Node con
`--expose-gc` + `PerformanceObserver({entryTypes:["gc"]})` aseveran cero eventos de GC en N
iteraciones para las funciones de decimación del camino caliente, con controles positivos que
demuestran que la comprobación puede realmente fallar.

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

# Tests unitarios y de integración (Vitest, cientos de tests en verde en core y renderers)
pnpm run test

# Lint
pnpm exec turbo run lint

# Ejecutar la app del playground localmente
pnpm --filter playground dev

# --- Todavía no disponible: este workspace no existe ---
# pnpm --filter docs dev        (documentación VitePress — apps/docs está [PREVISTO])

# --- Exclusivo de CI por diseño, no autoritativo en local ---
# La regresión visual (Chromium vía Playwright) se ejecuta contra goldens generados en
# ubuntu-latest; ver .github/workflows/ci.yml. Los goldens solo se (re)generan mediante el
# workflow separado y disparado manualmente update-visual-goldens.yml.
```

---

## 📄 Licencia

Distribuido bajo la **Licencia MIT**. Consulta [LICENSE](LICENSE) para los términos completos.
