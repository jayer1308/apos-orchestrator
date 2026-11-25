// Live runner entry point (GOAL-002, R-2; drive mode GOAL-003, R-1;
// Multi-WP drive GOAL-004, WP-DRIVE):
// `npm run live -- --repo <project> --goal <id> [--drive
// [--handover <sha> | --handover <pkg>:<sha> ...]]` reads the real Goal
// state through the APOS CLI (`readGoalState`), calls the state machine
// (`nextStep` / `nextStepForPackage`) and prints the next step. It only
// calls read-only CLI commands and stops (prints, does not run) at human
// gates; it never runs a human-gated command and never passes --on-behalf.
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
// Multi-WP drive (GOAL-004): `--handover <pkg>:<sha>` may repeat, once
// per package; `--handover <sha>` bare is still the Solo package. Each
// per-package handover is verified with git for its own package (a
// commit that went red for ANY package is never submitted again) and
// kept in drive-state under its own package; the top-level submitted /
// red lists stay the union across packages. The runner answers a
// verified handover first (in `--handover` order) as `package-submit`
// with that package's commit, and when every package is green it
// answers `integration-gate` (the driver runs `apos integration gate`
// on the integration commit, then `integration complete` when it is
// green — the reader cannot report the gate outcome, see
// src/state-reader.ts — so the gate and the complete are the two halves
// of executing that one printed step).
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
  applyHandoverForPackage,
  consumeHandover,
  consumeHandoverForPackage,
  createRunState,
  markRed,
  markRedForPackage,
  recordHandover,
  recordHandoverForPackage,
  verifyHandover,
  verifyHandoverForPackage,
} from "./loop.js";
import { nextStep, nextStepForPackage, type GoalState, type Step } from "./state-machine.js";
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

/** Parse `--repo <project> --goal <id> [--drive] [--handover <sha> | --handover <pkg>:<sha> ...]` (any order) from argv. */
function parseArgv(argv: readonly string[]): {
  repo: string;
  goalId: string;
  drive: boolean;
  handovers: ParsedHandover[];
} {
  let repo: string | undefined;
  let goalId: string | undefined;
  let drive = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo" && i + 1 < argv.length) {
      repo = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--goal" && i + 1 < argv.length) {
      goalId = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--drive") {
      drive = true;
    }
  }
  if (repo === undefined || goalId === undefined) {
    throw new Error(
      "usage: npm run live -- --repo <project> --goal <id> [--drive] [--handover <sha>]",
    );
  }
  return { repo, goalId, drive, handovers: parseHandoverArgs(argv) };
}

/** One `--handover` value, parsed per package (GOAL-004, WP-DRIVE). */
export interface ParsedHandover {
  /**
   * The package the handover is for, or `null` for the bare Solo form
   * `--handover <sha>` (the Goal's only package).
   */
  packageId: string | null;
  /** The Worker commit SHA handed over for that package. */
  commit: string;
}

/**
 * Parse every `--handover` flag from argv. The per-package form
 * `--handover <pkg>:<sha>` may repeat, once per package; the bare form
 * `--handover <sha>` is the Solo package. Throws on a malformed value
 * (missing value, empty package, empty or non-hex commit) or on the same
 * package given twice — the driver must never guess which package a
 * handover belongs to.
 */
export function parseHandoverArgs(argv: readonly string[]): ParsedHandover[] {
  const parsed: ParsedHandover[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== "--handover") {
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error("--handover needs a value: --handover <sha> or --handover <pkg>:<sha>");
    }
    i += 1;
    const colon = value.indexOf(":");
    const packageId = colon === -1 ? null : value.slice(0, colon);
    const commit = colon === -1 ? value : value.slice(colon + 1);
    if (packageId !== null && packageId.trim() === "") {
      throw new Error(`malformed --handover value "${value}": empty package id`);
    }
    if (!/^[0-9a-fA-F]{7,64}$/.test(commit)) {
      throw new Error(`malformed --handover value "${value}": commit must be a hex SHA`);
    }
    const key = packageId ?? "";
    if (seen.has(key)) {
      throw new Error(
        `--handover given twice for package ${packageId ?? "(Solo)"}: the driver must not guess which handover belongs to which package`,
      );
    }
    seen.add(key);
    parsed.push(packageId === null ? { packageId: null, commit } : { packageId, commit });
  }
  return parsed;
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
  const { repo, goalId, drive, handovers } = parseArgv(argv);
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

  // Multi-WP when the reader lists at least two packages; otherwise
  // Solo (one package, or no packages map at all, e.g. an older
  // recorded-output executor).
  const packageIds =
    rawState.packages === undefined ? [] : Object.keys(rawState.packages);
  const isMulti = packageIds.length >= 2;

  // Reconcile with the reader: a handover the previous call verified
  // and printed as package-submit is consumed once the reader shows a
  // package was submitted (pending/red/green) — the submit ran, so the
  // commit must never be submitted again; a red package also marks it
  // red. (Gated on codeReady: only a verified handover could have been
  // printed as package-submit; an unverified handover was never
  // submitted, so it stays recorded.) In Multi-WP this runs per
  // package; the Solo scalar reconcile below it is kept for the bare
  // `--handover <sha>` form.
  if (isMulti) {
    for (const packageId of packageIds) {
      const pkgRun = runState.packages?.[packageId];
      const readerStatus = rawState.packages?.[packageId]?.status;
      const pending = pkgRun?.handoverCommit ?? null;
      if (
        pending !== null &&
        pkgRun?.codeReady === true &&
        readerStatus !== undefined &&
        readerStatus !== "none"
      ) {
        consumeHandoverForPackage(runState, packageId, pending);
        if (readerStatus === "red") {
          markRedForPackage(runState, packageId, pending);
        }
        print(
          `drive: reconciled submitted handover ${pending} for ${packageId} ` +
            `(package ${readerStatus})`,
        );
      }
    }
  }
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
  // machine (worker-write-code), never submitted. Per-package
  // handovers are verified for their own package, against the union
  // of every package's red commits.
  if (handovers.length > 0 && runState.baseCommit === null) {
    print(
      `cảnh báo: ${fromExecution.reason} — bỏ qua kiểm tra hậu duệ ` +
        "(descendant) của baseCommit khi kiểm chứng handover; chỉ kiểm tra " +
        "commit tồn tại và chưa submit/chưa đỏ.",
    );
  }
  for (const handover of handovers) {
    if (handover.packageId === null) {
      recordHandover(runState, handover.commit);
      const verification = await verifyHandover(runState, repo);
      print(`handover verification: ${verification.reason}`);
    } else {
      recordHandoverForPackage(runState, handover.packageId, handover.commit);
      const verification = await verifyHandoverForPackage(
        runState,
        handover.packageId,
        repo,
      );
      print(`handover verification ${handover.packageId}: ${verification.reason}`);
    }
  }

  let state = applyHandover(rawState, runState);
  for (const packageId of packageIds) {
    state = applyHandoverForPackage(state, runState, packageId);
  }
  const step = isMulti ? nextMultiStep(state, packageIds, handovers) : nextStep(state);
  const stoppedAtHumanGate = step.humanGate;
  print(`goal: ${goalId} (status: ${state.status})`);
  printAttemptsMax(print, state);
  printStep(print, step, stoppedAtHumanGate);
  saveDriveState(repo, goalId, runState);
  return { goalId, state, step, stoppedAtHumanGate };
}

/**
 * The next step for a Multi-WP Goal in drive mode (GOAL-004, WP-DRIVE),
 * from the folded state (reader state + verified handovers):
 * - A non-executing status, and the all-green integration steps, come
 *   straight from `nextStepForPackage` for the first package.
 * - Otherwise a package with a verified handover (code-ready, commit
 *   never submitted / never red for any package, package not green)
 *   answers first — in `--handover` order, then reader order — as
 *   `package-submit` with that package's commit. This is what makes a
 *   fresh handover submit even when the reader still shows the package
 *   as pending (the recorded fixture for that case has 0 submits);
 *   the machine on its own returns a pending package's submit without
 *   a handover commit.
 * - Otherwise the first package's per-package step (a green package
 *   redirects to the unfinished package's step, see
 *   `nextStepForPackage`).
 * - A bare Solo handover verified on the scalar fields is the last
 *   resort, answered for the first package.
 */
function nextMultiStep(
  state: GoalState,
  packageIds: readonly string[],
  handovers: readonly ParsedHandover[],
): Step {
  const firstPackage = packageIds[0];
  if (firstPackage === undefined) {
    return nextStep(state);
  }
  if (state.status !== "executing") {
    return nextStep(state);
  }
  const packages = state.packages ?? {};
  if (packageIds.every((id) => packages[id]?.status === "green")) {
    return nextStepForPackage(state, firstPackage);
  }
  const submitted = [
    ...new Set([
      ...(state.submittedCommits ?? []),
      ...Object.values(packages).flatMap((pkg) => pkg.submittedCommits ?? []),
    ]),
  ];
  const red = [
    ...new Set([
      ...(state.redCommits ?? []),
      ...Object.values(packages).flatMap((pkg) => pkg.redCommits ?? []),
    ]),
  ];
  const orderedIds = [
    ...handovers
      .map((h) => h.packageId)
      .filter((id): id is string => id !== null && packageIds.includes(id)),
    ...packageIds.filter(
      (id) => !handovers.some((h) => h.packageId === id),
    ),
  ];
  for (const packageId of orderedIds) {
    const pkg = packages[packageId];
    const commit = pkg?.handoverCommit ?? null;
    if (
      pkg?.codeReady === true &&
      commit !== null &&
      pkg.status !== "green" &&
      !submitted.includes(commit) &&
      !red.includes(commit)
    ) {
      return {
        action: "package-submit",
        reason:
          `Worker handed over commit ${commit} for ${packageId}; the code is ready, ` +
          "so the Lead submits that commit for the gate check.",
        humanGate: false,
        packageId,
        handoverCommit: commit,
      };
    }
  }
  const soloCommit = state.handoverCommit ?? null;
  if (
    state.codeReady === true &&
    soloCommit !== null &&
    !submitted.includes(soloCommit) &&
    !red.includes(soloCommit)
  ) {
    return {
      action: "package-submit",
      reason:
        `Worker handed over commit ${soloCommit}; the code is ready, ` +
        "so the Lead submits that commit for the gate check.",
      humanGate: false,
      packageId: firstPackage,
      handoverCommit: soloCommit,
    };
  }
  return nextStepForPackage(state, firstPackage);
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
  if (step.packageId !== undefined) {
    print(`package: ${step.packageId}`);
  }
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
