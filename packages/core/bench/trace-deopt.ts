import { spawnSync } from "node:child_process";
import path from "node:path";

// Supervisor for `--trace-deopt` mode. `--trace-deopt` is a V8 flag that must be set at
// process start, so this spawns a fresh child process rather than toggling anything from
// inside the current one, captures its stdout+stderr, and parses the trace for
// deoptimization entries naming either decimation target (a real failure, exit 1) or missing
// the sentinel fixture entirely (the instrument itself is broken, exit 2 — distinct from exit 1
// so a parser that stops matching after a V8 upgrade cannot report false-clean forever).

const DEOPT_LINE_PATTERN = /\[(?:deoptimizing|bailout)[^\n]*<JSFunction (\w+)/g;
const TARGET_FUNCTIONS = ["minMaxEnvelope", "lttb"];
const SENTINEL_FUNCTION = "injectedDeoptFixture";

export function runTraceDeoptCheck(): number {
  const workloadPath = path.join(import.meta.dirname, "deopt-workload.ts");
  const tsxLoaderUrl = import.meta.resolve("tsx");

  const result = spawnSync(
    process.execPath,
    ["--trace-deopt", "--import", tsxLoaderUrl, workloadPath],
    { encoding: "utf8" },
  );

  const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const namedFunctions = new Set<string>();
  for (const match of combinedOutput.matchAll(DEOPT_LINE_PATTERN)) {
    const functionName = match[1];
    if (functionName !== undefined) {
      namedFunctions.add(functionName);
    }
  }

  const deoptimizedTargets = TARGET_FUNCTIONS.filter((name) =>
    namedFunctions.has(name),
  );
  if (deoptimizedTargets.length > 0) {
    console.error(
      `--trace-deopt reported a real deoptimization for: ${deoptimizedTargets.join(", ")}`,
    );
    console.error(combinedOutput);
    return 1;
  }

  if (!namedFunctions.has(SENTINEL_FUNCTION)) {
    console.error(
      `--trace-deopt did not detect the ${SENTINEL_FUNCTION} sentinel deopt; the parser or ` +
        "fixture is broken, so a clean report here cannot be trusted.",
    );
    console.error(combinedOutput);
    return 2;
  }

  console.log(
    "--trace-deopt: no deoptimization reported for minMaxEnvelope or lttb; " +
      `sentinel ${SENTINEL_FUNCTION} detected as expected.`,
  );
  console.log(combinedOutput);
  return 0;
}
