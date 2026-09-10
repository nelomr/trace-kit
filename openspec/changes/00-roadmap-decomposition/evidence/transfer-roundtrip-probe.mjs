// Does a transfer round-trip allocate, and do scavenges scale with delta size?
// This is the P5 falsification condition of the design, tested before implementation.
import { PerformanceObserver } from 'node:perf_hooks';

let gcEvents = 0;
new PerformanceObserver((l) => { gcEvents += l.getEntries().length; })
  .observe({ entryTypes: ['gc'] });

// Simulates one pooled round-trip: main -> responder -> main, with real detach semantics.
function roundTrip(pair) {
  // main -> responder: transfer ownership away
  const sent = structuredClone({ x: pair.x, y: pair.y }, { transfer: [pair.x.buffer, pair.y.buffer] });
  // responder writes into the buffers it now owns
  const rx = sent.x, ry = sent.y;
  for (let i = 0; i < rx.length; i++) { ry[i] = rx[i]; }
  // responder -> main: transfer back
  const back = structuredClone({ x: rx, y: ry }, { transfer: [rx.buffer, ry.buffer] });
  pair.x = back.x; pair.y = back.y;
  return pair;
}

function run(deltaSamples, iterations) {
  let pair = { x: new Float32Array(deltaSamples), y: new Float32Array(deltaSamples) };
  for (let i = 0; i < pair.x.length; i++) pair.x[i] = Math.sin(i * 0.001);
  for (let i = 0; i < 30; i++) pair = roundTrip(pair); // warm
  globalThis.gc();
  gcEvents = 0;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) pair = roundTrip(pair);
  const t1 = performance.now();
  return { gcEvents, msPerRoundTrip: (t1 - t0) / iterations };
}

const ITER = 3600; // 60 s at 60 Hz
console.log('iterations per case:', ITER, '(60 s at 60 Hz)');
console.log('deltaSamples |  GC events | ms/round-trip');
for (const delta of [4096, 16384, 65536, 262144]) {
  const r = run(delta, ITER);
  console.log(
    String(delta).padStart(12),
    '|', String(r.gcEvents).padStart(10),
    '|', r.msPerRoundTrip.toFixed(4)
  );
}
console.log('\nP5 reads: if GC events scale with deltaSamples, the O(1)-per-round-trip claim is false.');
