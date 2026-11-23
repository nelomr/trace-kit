import { attachCurrentDecimationWorker } from "../../../src/worker.js";

const detach = attachCurrentDecimationWorker();

globalThis.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (
    typeof event.data === "object" &&
    event.data !== null &&
    "type" in event.data &&
    event.data.type === "__test_crash__"
  ) {
    detach();
    throw new Error("Simulated real Chromium worker crash");
  }
});
