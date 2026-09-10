#!/usr/bin/env node
// Vacuity guard (design.md §D2). Spawns `turbo run <task> --dry=json`, parses stdout as JSON
// (stdout is pure JSON; the "• turbo <ver>" banner goes to stderr), and fails when no planned
// task belonging to the requested task name has a runnable command.
//
// Exit codes:
//   0 — at least one runnable task matching the requested task name exists.
//   1 — vacuous task: every planned task for this name has command "<NONEXISTENT>", or none
//       of the runnable tasks' `task` field matches the requested name (e.g. `turbo run test`
//       plans a runnable `core#build` alongside a nonexistent `core#test` — a bare
//       `tasks.length > 0` check would incorrectly pass on that alone).
//   2 — schema drift: the dry-run JSON does not carry the shape this guard depends on. Exit 2
//       is deliberately distinct from exit 1 so "the guard broke" is never confused with "the
//       task set is empty".
import { spawn } from "node:child_process";

const NONEXISTENT = "<NONEXISTENT>";
const SUPPORTED_TURBO_MAJOR = "2";

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

function runTurboDry(taskName) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "pnpm",
      ["exec", "turbo", "run", taskName, "--dry=json"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });
}

export function evaluateDrySummary(summary, taskName) {
  if (summary === null || typeof summary !== "object") {
    return { code: 2, message: "SCHEMA DRIFT: dry-run output is not a JSON object." };
  }
  if (summary.version !== "1") {
    return {
      code: 2,
      message: `SCHEMA DRIFT: expected summary.version === "1", got ${JSON.stringify(summary.version)}.`,
    };
  }
  if (!Array.isArray(summary.tasks)) {
    return { code: 2, message: "SCHEMA DRIFT: summary.tasks is not an array." };
  }
  for (const task of summary.tasks) {
    if (
      task === null ||
      typeof task !== "object" ||
      typeof task.command !== "string" ||
      typeof task.task !== "string"
    ) {
      return {
        code: 2,
        message:
          "SCHEMA DRIFT: every planned task must carry a string `command` and a string `task` field.",
      };
    }
  }
  const turboVersion =
    typeof summary.turboVersion === "string" ? summary.turboVersion : "";
  const turboMajor = turboVersion.split(".")[0];
  if (turboMajor !== SUPPORTED_TURBO_MAJOR) {
    return {
      code: 2,
      message: `SCHEMA DRIFT: unsupported turbo major version ${JSON.stringify(summary.turboVersion)}; expected major ${SUPPORTED_TURBO_MAJOR}.`,
    };
  }

  const runnable = summary.tasks.filter((task) => task.command !== NONEXISTENT);
  const requestedIsRunnable = runnable.some((task) => task.task === taskName);

  if (!requestedIsRunnable) {
    return {
      code: 1,
      message: `VACUOUS TASK: no runnable "${taskName}" task in the plan (planned tasks: ${summary.tasks
        .map((task) => `${task.task}=${task.command}`)
        .join(", ")}).`,
    };
  }

  return { code: 0, message: `OK: "${taskName}" is runnable.` };
}

async function main() {
  const taskName = process.argv[2];
  if (!taskName) {
    fail(2, "USAGE: verify-turbo-ran.mjs <task>");
    return;
  }

  const { stdout, exitCode: turboExitCode } = await runTurboDry(taskName);

  let summary;
  try {
    summary = JSON.parse(stdout);
  } catch {
    fail(2, `SCHEMA DRIFT: dry-run stdout is not valid JSON (turbo exited ${turboExitCode}).`);
    return;
  }

  const { code, message } = evaluateDrySummary(summary, taskName);
  if (code === 0) {
    console.log(message);
  } else {
    console.error(message);
  }
  process.exit(code);
}

// Only run when invoked directly (not when imported for testing).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
