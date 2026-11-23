import { parentPort, workerData } from "node:worker_threads";
import { attachNodeDecimationWorker } from "../../dist/node/index.js";

if (parentPort === null) {
  throw new Error("node-decimation-worker.mjs must run inside a node:worker_threads Worker");
}

const mode =
  typeof workerData === "object" && workerData !== null && "mode" in workerData
    ? workerData.mode
    : "normal";

if (mode === "throw-on-first-work") {
  parentPort.on("message", (msg) => {
    if (typeof msg === "object" && msg !== null && "type" in msg && msg.type === "work") {
      throw new Error("injected uncaught worker throw");
    }
  });
} else if (mode === "exit-on-first-work") {
  parentPort.on("message", (msg) => {
    if (typeof msg === "object" && msg !== null && "type" in msg && msg.type === "work") {
      process.exit(1);
    }
  });
} else {
  attachNodeDecimationWorker(parentPort);
}
