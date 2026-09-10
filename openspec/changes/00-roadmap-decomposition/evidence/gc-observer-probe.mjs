import { PerformanceObserver, constants } from 'node:perf_hooks';
import v8 from 'node:v8';

let events = [];
const obs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    events.push({ name: e.name, kind: e.detail?.kind, flags: e.detail?.flags, dur: e.duration });
  }
});
obs.observe({ entryTypes: ['gc'] });

// Hot path A: allocation-free numeric loop over a preallocated typed array.
function minMaxNoAlloc(src, out, buckets) {
  const per = (src.length / buckets) | 0;
  let w = 0;
  for (let b = 0; b < buckets; b++) {
    let lo = Infinity, hi = -Infinity;
    const start = b * per, end = start + per;
    for (let i = start; i < end; i++) {
      const v = src[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    out[w++] = lo; out[w++] = hi;
  }
  return w;
}

// Hot path B: deliberately allocating variant (object per bucket).
function minMaxAlloc(src, buckets) {
  const per = (src.length / buckets) | 0;
  const res = [];
  for (let b = 0; b < buckets; b++) {
    let lo = Infinity, hi = -Infinity;
    for (let i = b * per; i < b * per + per; i++) {
      const v = src[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    res.push({ lo, hi });
  }
  return res;
}

const N = 1_000_000, B = 1000;
const src = new Float32Array(N);
for (let i = 0; i < N; i++) src[i] = Math.sin(i * 0.001);
const out = new Float32Array(B * 2);

// warm up both
for (let i = 0; i < 20; i++) { minMaxNoAlloc(src, out, B); minMaxAlloc(src, B); }

globalThis.gc?.();
await new Promise(r => setTimeout(r, 30));

events = [];
const h0 = v8.getHeapStatistics().used_heap_size;
const t0 = performance.now();
for (let i = 0; i < 200; i++) minMaxNoAlloc(src, out, B);
const t1 = performance.now();
await new Promise(r => setTimeout(r, 30));
const noAllocEvents = events.length;
const h1 = v8.getHeapStatistics().used_heap_size;

events = [];
for (let i = 0; i < 200; i++) minMaxAlloc(src, B);
await new Promise(r => setTimeout(r, 30));
const allocEvents = events.length;

console.log('gc entryType observable:', typeof constants.NODE_PERFORMANCE_GC_MINOR === 'number');
console.log('GC constants:', Object.keys(constants).filter(k => k.includes('GC')).join(', '));
console.log('--- 200 iterations, zero-alloc variant ---');
console.log('  GC events:', noAllocEvents);
console.log('  used_heap delta bytes:', h1 - h0);
console.log('  median-ish ms/iter:', ((t1 - t0) / 200).toFixed(3));
console.log('--- 200 iterations, allocating variant ---');
console.log('  GC events:', allocEvents);
if (events.length) console.log('  sample entry:', JSON.stringify(events[0]));
