// Live runner entry point (GOAL-002, R-2): `npm run live -- --repo
// <project> --goal <id>` reads the real Goal state through the APOS CLI
// (`readGoalState`), calls the state machine (`nextStep`) and prints the
// next step. It only calls read-only CLI commands and stops (prints, does
// not run) at human gates; it never runs a human-gated command and never
// passes --on-behalf.
//
// `runLive` itself never calls `process.exit`, so tests can call it
// directly; only the CLI guard at the bottom of this file sets the exit
// code when the file is run as a script (`node dist/index.js`).
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nextStep, type GoalState, type Step } from "./state-machine.js";
import { readGoalState, type CliExecutor } from "./state-reader.js";

export const ORCHESTRATOR_NAME = "apos-orchestrator";

export interface RunLiveOptions {
  /** Injected APOS CLI executor (tests); defaults to the real CLI. */
  executor?: CliExecutor;
  /** Print sink; defaults to console.log. */
  print?: (line: string) => void;
}

export interface RunLiveResult {
  goalId: string;
  state: GoalState;
  step: Step;
  /** True when the next step is a human gate (the runner only printed and stopped). */
  stoppedAtHumanGate: boolean;
}

/** Parse `--repo <project> --goal <id>` (either order) from argv. */
function parseArgv(argv: readonly string[]): { repo: string; goalId: string } {
  let repo: string | undefined;
  let goalId: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo" && i + 1 < argv.length) {
      repo = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--goal" && i + 1 < argv.length) {
      goalId = argv[i + 1];
      i += 1;
    }
  }
  if (repo === undefined || goalId === undefined) {
    throw new Error("usage: npm run live -- --repo <project> --goal <id>");
  }
  return { repo, goalId };
}

/**
 * Read the real state of a Goal through the APOS CLI and print the next
 * step. At a human gate it only prints and stops. It prints the
 * attemptsMax source: when the CLI exposes no appetite it says
 * explicitly that the default 3 is in use (APOS #69).
 */
export async function runLive(
  argv: readonly string[],
  options?: RunLiveOptions,
): Promise<RunLiveResult> {
  const print = options?.print ?? console.log;
  const { repo, goalId } = parseArgv(argv);
  const state = await readGoalState(repo, goalId, options?.executor);
  const step = nextStep(state);
  const stoppedAtHumanGate = step.humanGate;
  print(`goal: ${goalId} (status: ${state.status})`);
  if (state.attemptsMaxSource === "cli") {
    print(`attemptsMax: ${state.attemptsMax} (appetite read from CLI output)`);
  } else {
    print(
      `attemptsMax: ${state.attemptsMax} — đang dùng mặc định (using the default): ` +
        "CLI không lộ appetite (xem APOS #69), nên dùng mặc định 3",
    );
  }
  print(`next step: ${step.action} — ${step.reason}`);
  if (step.handoverCommit !== undefined) {
    print(`handover commit: ${step.handoverCommit}`);
  }
  if (stoppedAtHumanGate) {
    print(
      "stopped at human gate: the loop only prints and stops here; " +
        "a human runs the gated command.",
    );
  }
  return { goalId, state, step, stoppedAtHumanGate };
}

/** CLI entry for `npm run live` (see src/dry-run.ts for the pattern). */
export async function main(): Promise<void> {
  const result = await runLive(process.argv.slice(2));
  if (result.stoppedAtHumanGate) {
    console.log("live: stopped at human gate");
  } else {
    console.log(`live: next step is ${result.step.action}`);
  }
}

// CLI guard: run `main()` only when this file is the script being run
// (`node dist/index.js`). Importing it (e.g. from tests) does nothing.
const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
