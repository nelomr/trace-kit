// Probe: does CDP HeapProfiler sampling attribute allocated bytes per call site?
// Speaks raw CDP over WebSocket. No dependencies.
const PORT = 9334;
const send = (() => { let id = 0; return (ws, method, params) => new Promise((res, rej) => {
  const myId = ++id;
  const onMsg = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id !== myId) return;
    ws.removeEventListener('message', onMsg);
    m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result);
  };
  ws.addEventListener('message', onMsg);
  ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
}); })();

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find(t => t.type === 'page');
if (!page) { console.error('no page target'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));

await send(ws, 'Runtime.enable');
await send(ws, 'HeapProfiler.enable');

// Two clearly-named call sites: one allocates per iteration, one does not.
const setup = `
  window.__out = new Float32Array(2000);
  window.allocatingRenderPath = function allocatingRenderPath(src, buckets) {
    const acc = [];
    const per = (src.length / buckets) | 0;
    for (let b = 0; b < buckets; b++) {
      let lo = Infinity, hi = -Infinity;
      for (let i = b*per; i < b*per+per; i++) { const v = src[i]; if (v<lo) lo=v; if (v>hi) hi=v; }
      acc.push({ lo, hi });
    }
    return acc.length;
  };
  window.cleanRenderPath = function cleanRenderPath(src, out, buckets) {
    const per = (src.length / buckets) | 0; let w = 0;
    for (let b = 0; b < buckets; b++) {
      let lo = Infinity, hi = -Infinity;
      for (let i = b*per; i < b*per+per; i++) { const v = src[i]; if (v<lo) lo=v; if (v>hi) hi=v; }
      out[w++] = lo; out[w++] = hi;
    }
    return w;
  };
  window.__src = new Float32Array(200000);
  for (let i=0;i<window.__src.length;i++) window.__src[i] = Math.sin(i*0.01);
  'ready';
`;
console.log('setup:', (await send(ws, 'Runtime.evaluate', { expression: setup })).result.value);

async function measure(label, expr) {
  await send(ws, 'HeapProfiler.startSampling', { samplingInterval: 128 });
  await send(ws, 'Runtime.evaluate', { expression: expr, awaitPromise: false });
  const { profile } = await send(ws, 'HeapProfiler.stopSampling');
  // Walk the sampling tree, summing selfSize per function name.
  const per = new Map();
  (function walk(node) {
    const n = node.callFrame.functionName || '(anonymous)';
    if (node.selfSize) per.set(n, (per.get(n) || 0) + node.selfSize);
    (node.children || []).forEach(walk);
  })(profile.head);
  const rows = [...per.entries()].filter(([, b]) => b > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const total = [...per.values()].reduce((a, b) => a + b, 0);
  console.log(`\n--- ${label} ---`);
  console.log('  total sampled bytes:', total);
  console.log('  samples recorded:', (profile.samples || []).length);
  for (const [fn, bytes] of rows) console.log(`    ${bytes.toString().padStart(9)} B  <- ${fn}`);
  return per;
}

const A = await measure('allocating call site (300 x 200k samples)',
  'for (let i=0;i<300;i++) window.allocatingRenderPath(window.__src, 1000);');
const B = await measure('allocation-free call site (300 x 200k samples)',
  'for (let i=0;i<300;i++) window.cleanRenderPath(window.__src, window.__out, 1000);');

console.log('\n=== verdict ===');
console.log('attributed to allocatingRenderPath:', A.get('allocatingRenderPath') || 0, 'bytes');
console.log('attributed to cleanRenderPath:     ', B.get('cleanRenderPath') || 0, 'bytes');
ws.close();
