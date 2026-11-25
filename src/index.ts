// Live runner entry point (GOAL-002, R-2; drive mode GOAL-003, R-1):
// `npm run live -- --repo <project> --goal <id> [--drive
// [--handover <sha>]]` reads the real Goal state through the APOS CLI
// (`readGoalState`), calls the state machine (`nextStep`) and prints the
// next step. It only calls read-only CLI commands and stops (prints, does
// not run) at human gates; it never runs a human-gated command and never
// passes --on-behalf.
//
// Drive mode (`--drive`) keeps the loop run state (`LoopRunState`) in a
// file outside the repo (`src/drive-state.ts`), so one invocation can
// pick up where the previous one left off without a long-running
// process. Each call loads the saved state, reconciles it with the
// reader state (a handover the previous call printed as package-submit
// is consumed into `submittedCommits` once the reader shows a
// pending/red/green package — and into `redCommits` when the package is
// red — because the runner only prints the step; the driver runs the
// submit), records + verifies `--handover` with git when given, then
// `applyHandover` + `nextStep`, prints the step and saves the state.
// Without `--drive` the runner keeps its read-only behaviour:
// `--handover` is ignored and no drive state file is created.
//
// The handover's `baseCommit` comes from the ```json block in the
// COMMITTED `<repo>/.apos/goals/<goal>/execution.md` of the target
// project. When that file is missing or unparseable, verification only
// checks that the commit exists and was never submitted / never red,
// and prints an explicit warning that the descendant check was
// skipped. The runner never guesses the handover commit from git log.
//
// `runLive` itself never calls `process.exit`, so tests can call it
// directly; only the CLI guard at the bottom of this file sets the exit
// code when the file is run as a script (`node dist/index.js`).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { driveStatePath, loadDriveState, saveDriveState } from "./drive-state.js";
import {
  applyHandover,
  consumeHandover,
  createRunState,
  markRed,
  recordHandover,
  verifyHandover,
} from "./loop.js";
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

/** Parse `--repo <project> --goal <id> [--drive] [--handover <sha>]` (any order) from argv. */
function parseArgv(argv: readonly string[]): {
  repo: string;
  goalId: string;
  drive: boolean;
  handover: string | undefined;
} {
  let repo: string | undefined;
  let goalId: string | undefined;
  let drive = false;
  let handover: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo" && i + 1 < argv.length) {
      repo = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--goal" && i + 1 < argv.length) {
      goalId = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--drive") {
      drive = true;
    } else if (argv[i] === "--handover" && i + 1 < argv.length) {
      handover = argv[i + 1];
      i += 1;
    }
  }
  if (repo === undefined || goalId === undefined) {
    throw new Error(
      "usage: npm run live -- --repo <project> --goal <id> [--drive] [--handover <sha>]",
    );
  }
  return { repo, goalId, drive, handover };
}

/**
 * Read the plan's `baseCommit` from the ```json block in
 * `<repo>/.apos/goals/<goalId>/execution.md`. Returns the baseCommit,
 * or `null` plus the reason it could not be read (missing file, no JSON
 * block, unparseable JSON, no baseCommit in the block).
 */
function readBaseCommitFromExecution(
  repo: string,
  goalId: string,
): { baseCommit: string | null; reason: string } {
  const path = join(repo, ".apos", "goals", goalId, "execution.md");
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return { baseCommit: null, reason: `không đọc được ${path}` };
  }
  const match = /```json\s*\n([\s\S]*?)\n```/.exec(content);
  if (match === null || match[1] === undefined) {
    return { baseCommit: null, reason: `không tìm thấy khối JSON trong ${path}` };
  }
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)["baseCommit"] === "string"
    ) {
      return {
        baseCommit: (parsed as Record<string, unknown>)["baseCommit"] as string,
        reason: "",
      };
    }
    return { baseCommit: null, reason: `khối JSON trong ${path} không có baseCommit` };
  } catch {
    return { baseCommit: null, reason: `không parse được khối JSON trong ${path}` };
  }
}

/**
 * Read the real state of a Goal through the APOS CLI and print the next
 * step. At a human gate it only prints and stops. It prints the
 * attemptsMax source: when the CLI exposes no appetite it says
 * explicitly that the default 3 is in use (APOS #69).
 *
 * In drive mode (`--drive`) it additionally loads the saved loop run
 * state, reconciles it with the reader state, verifies `--handover`
 * with git when given, and saves the state — see the header note.
 */
export async function runLive(
  argv: readonly string[],
  options?: RunLiveOptions,
): Promise<RunLiveResult> {
  const print = options?.print ?? console.log;
  const { repo, goalId, drive, handover } = parseArgv(argv);
  const rawState = await readGoalState(repo, goalId, options?.executor);
  if (!drive) {
    const step = nextStep(rawState);
    const stoppedAtHumanGate = step.humanGate;
    print(`goal: ${goalId} (status: ${rawState.status})`);
    printAttemptsMax(print, rawState);
    printStep(print, step, stoppedAtHumanGate);
    return { goalId, state: rawState, step, stoppedAtHumanGate };
  }

  // --- Drive mode: load the saved run state for this project + goal.
  const runState = loadDriveState(repo, goalId) ?? createRunState();
  print(`drive: state file ${driveStatePath(repo, goalId)}`);

  // baseCommit for handover verification: the committed execution.md
  // of the target project wins; the saved state is the fallback. When
  // neither has one, verification skips the descendant check (with an
  // explicit warning, printed only when a handover needs verifying).
  const fromExecution = readBaseCommitFromExecution(repo, goalId);
  if (fromExecution.baseCommit !== null) {
    runState.baseCommit = fromExecution.baseCommit;
  }

  // Reconcile with the reader: a handover the previous call verified
  // and printed as package-submit is consumed once the reader shows a
  // package was submitted (pending/red/green) — the submit ran, so the
  // commit must never be submitted again; a red package also marks it
  // red. (Gated on codeReady: only a verified handover could have been
  // printed as package-submit; an unverified handover was never
  // submitted, so it stays recorded.)
  const pendingHandover = runState.handoverCommit;
  if (
    pendingHandover !== null &&
    runState.codeReady &&
    rawState.packageStatus !== "none"
  ) {
    consumeHandover(runState, pendingHandover);
    if (rawState.packageStatus === "red") {
      markRed(runState, pendingHandover);
    }
    print(
      `drive: reconciled submitted handover ${pendingHandover} ` +
        `(package ${rawState.packageStatus})`,
    );
  }

  // A handover given on this call: record it, verify it with git, and
  // say so. An unverified handover is treated as no code by the
  // machine (worker-write-code), never submitted.
  if (handover !== undefined) {
    recordHandover(runState, handover);
    if (runState.baseCommit === null) {
      print(
        `cảnh báo: ${fromExecution.reason} — bỏ qua kiểm tra hậu duệ ` +
          "(descendant) của baseCommit khi kiểm chứng handover; chỉ kiểm tra " +
          "commit tồn tại và chưa submit/chưa đỏ.",
      );
    }
    const verification = await verifyHandover(runState, repo);
    print(`handover verification: ${verification.reason}`);
  }

  const state = applyHandover(rawState, runState);
  const step = nextStep(state);
  const stoppedAtHumanGate = step.humanGate;
  print(`goal: ${goalId} (status: ${state.status})`);
  printAttemptsMax(print, state);
  printStep(print, step, stoppedAtHumanGate);
  saveDriveState(repo, goalId, runState);
  return { goalId, state, step, stoppedAtHumanGate };
}

function printAttemptsMax(print: (line: string) => void, state: GoalState): void {
  if (state.attemptsMaxSource === "cli") {
    print(`attemptsMax: ${state.attemptsMax} (appetite read from CLI output)`);
  } else {
    print(
      `attemptsMax: ${state.attemptsMax} — đang dùng mặc định (using the default): ` +
        "CLI không lộ appetite (xem APOS #69), nên dùng mặc định 3",
    );
  }
}

function printStep(
  print: (line: string) => void,
  step: Step,
  stoppedAtHumanGate: boolean,
): void {
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
