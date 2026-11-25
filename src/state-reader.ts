// State reader: reads a Goal's current state through the APOS CLI and
// returns it as JSON. It never reads the controller journal or SQLite
// directly; the CLI is the only interface.
//
// Sources (verified against this APOS build; see src/test-fixtures/README.md):
// - `inbox --json` (primary, JSON)
// - `plan --json` (JSON)
// - `goal list` (text — no `--json` flag exists)
// - `goal show <goalId>` (text — no `--json` flag exists)
// - `metrics show <goalId>` (JSON by default — no `--json` flag exists)
// - `package list <goalId>` (JSON by default — the per-package source,
//   GOAL-004: `goal show` prints no package table and `metrics show`
//   only has totals, so the per-package statuses come from here)
//
// Mapping (pinned by the reader tests):
// - `status` comes from `goal show` (cross-checked against `goal list`).
// - `hasSetup` is false when `goal show` says "không có setup".
// - `testsLocked` is false when `goal show` says "không có khoá test"
//   (Goal without a pinned setup); otherwise it follows the "Test đã khoá"
//   row, which is locked when its value is anything but "không có".
// - `attemptsUsed` is the total package submits (sum of `submitsByPackage`
//   in `metrics show`); `redGates` alone does not count attempts.
// - `packageStatus` is "none" with no submits, "red" when every submitted
//   package hit a red gate (`redGates` equals the submit total and is > 0),
//   and "pending" otherwise (submitted, no outcome recorded yet).
// - `packages` maps each entry of `package list` to a `PackageState`:
//   APOS "pending" (registered, never submitted) -> "none", APOS
//   "submitted" (submitted, no outcome yet) -> "pending", "green" ->
//   "green", "red" -> "red", "needs-human" -> "needs-human".
// - `integrationStatus` is always "none" from the reader. DECISION
//   (GOAL-004, Tester finding b): no APOS CLI read exposes the
//   integration gate outcome — `integration prepare` only proves every
//   package is green and lists the green commits / conflicts, and
//   neither `goal show` nor `metrics show` carries a gate result — so
//   the reader cannot know the gate went green, and it never edits
//   APOS state by hand to record it. The driver that ran
//   `integration gate` knows it went green and runs
//   `integration complete` in the same drive step; the machine's
//   `gate-green` -> `integration-complete` transition is exercised by
//   its unit tests and by that driver, not by the reader. (APOS
//   finding: a read such as `integration status`, or the latest gate
//   in `goal show` / `metrics show`, would let the reader report it.)
// - `attemptsMax`: best-effort scan of the CLI outputs already read
//   (`inbox --json`, `plan --json`, `goal show`, `metrics show`) for an
//   exposed appetite under the key `maxAttempts` (GOAL-002, APOS #69).
//   NOTE: the key name is a GUESS — no APOS CLI command exposes appetite
//   today, so `maxAttempts` is the field name the reader looks for if a
//   future CLI version exposes it (see APOS #69). A present, valid
//   (positive integer) value is used and reported with source "cli";
//   otherwise it defaults to 3 with source "default", and the live
//   runner prints explicitly that the default is in use. An explicit
//   `options.attemptsMax` override still wins over a CLI value. The
//   value returned is always at least `attemptsUsed`.

import { execFile } from "node:child_process";
import type { GoalState, GoalStatus, PackageState, PackageStatus } from "./state-machine.js";
import { resolveAposCli } from "./apos-cli.js";

/** One APOS CLI invocation: its stdout, stderr and exit code. */
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Runs one APOS CLI call. `args` are the APOS subcommand arguments, e.g.
 * `["inbox", "--json"]`; the default executor prepends the CLI entry point
 * and `--repo <projectPath>`. Tests inject a fake executor returning
 * recorded CLI output so results never depend on live controller state.
 */
export type CliExecutor = (args: readonly string[]) => Promise<CliResult>;

/** Options for `readGoalState`. */
export interface ReadGoalStateOptions {
  /**
   * Maximum number of package-submit attempts for the Goal. The reader
   * first looks for an appetite exposed by the CLI under `maxAttempts`
   * (APOS #69); this option overrides both the CLI value and the
   * default 3. Must be a positive integer when given.
   */
  attemptsMax?: number;
}

/** Default maximum attempts when the CLI exposes no appetite. */
export const DEFAULT_ATTEMPTS_MAX = 3;

const GOAL_STATUSES: readonly string[] = [
  "draft",
  "approved",
  "selected",
  "executing",
  "testing",
  "verified",
  "blocked",
  "closed",
];

function isGoalStatus(value: string): value is GoalStatus {
  return GOAL_STATUSES.includes(value);
}

/** Default executor: runs `node <cli> --repo <projectPath> <args>`. The
 * CLI is resolved by the shared src/apos-cli.ts ($APOS_CLI, sibling,
 * $HOME/workspace/apos/dist/cli.js, `apos` on PATH). */
function defaultExecutor(projectPath: string): CliExecutor {
  const cli = resolveAposCli();
  return (args) =>
    new Promise<CliResult>((resolvePromise) => {
      execFile(
        "node",
        [cli, "--repo", projectPath, ...args],
        { encoding: "utf-8" },
        (error, stdout, stderr) => {
          if (error !== null) {
            const exitCode = typeof error.code === "number" ? error.code : 1;
            resolvePromise({ stdout, stderr: `${stderr}${error.message}`, exitCode });
          } else {
            resolvePromise({ stdout, stderr, exitCode: 0 });
          }
        },
      );
    });
}

/** Run one read-only CLI call; reject with the call's name on failure. */
async function runRead(
  executor: CliExecutor,
  name: string,
  args: readonly string[],
): Promise<string> {
  const result = await executor(args);
  if (result.exitCode !== 0) {
    throw new Error(
      `${name}: APOS CLI exited with code ${result.exitCode}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

function parseJson(name: string, stdout: string): unknown {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return parsed;
  } catch {
    throw new Error(`${name}: could not parse JSON output: ${stdout.slice(0, 120)}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * An exposed appetite value is usable only when it is a positive
 * integer; anything else (0, negative, non-integer, non-number) is
 * ignored and the default applies (GOAL-002 AC-3).
 */
function validMaxAttempts(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : undefined;
}

/** Best-effort scan of a text output for `maxAttempts: <n>`. */
function scanTextForAppetite(stdout: string): number | undefined {
  const match = /maxAttempts\s*[:=]\s*(\d+)/.exec(stdout);
  if (match === null) return undefined;
  return validMaxAttempts(Number(match[1]));
}

/** Parse `inbox --json`: validates the shape, items are not needed here. */
function parseInbox(stdout: string, goalId: string): number | undefined {
  const parsed = parseJson("inbox", stdout);
  if (!isRecord(parsed) || !Array.isArray(parsed["items"])) {
    throw new Error("inbox: unexpected JSON shape (expected an object with an items array)");
  }
  // Best-effort appetite scan (APOS #69): a top-level maxAttempts, or
  // one on the item for this goal.
  const topLevel = validMaxAttempts(parsed["maxAttempts"]);
  if (topLevel !== undefined) return topLevel;
  for (const item of parsed["items"]) {
    if (isRecord(item) && item["goalId"] === goalId) {
      const found = validMaxAttempts(item["maxAttempts"]);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Parse `plan --json`: the goal's status when the plan lists it. */
function parsePlan(
  stdout: string,
  goalId: string,
): { status: GoalStatus | undefined; maxAttempts: number | undefined } {
  const parsed = parseJson("plan", stdout);
  if (!isRecord(parsed) || !Array.isArray(parsed["goals"])) {
    throw new Error("plan: unexpected JSON shape (expected an object with a goals array)");
  }
  for (const goal of parsed["goals"]) {
    if (isRecord(goal) && goal["id"] === goalId && typeof goal["status"] === "string") {
      if (!isGoalStatus(goal["status"])) {
        throw new Error(`plan: unknown status "${goal["status"]}" for ${goalId}`);
      }
      return { status: goal["status"], maxAttempts: validMaxAttempts(goal["maxAttempts"]) };
    }
  }
  return { status: undefined, maxAttempts: undefined };
}

interface GoalListRow {
  status: GoalStatus;
}

/** Parse `goal list` (tab-separated text): find the goal's row. */
function parseGoalList(stdout: string, goalId: string): GoalListRow {
  for (const line of stdout.split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === goalId) {
      const statusField = fields[1];
      if (statusField === undefined || !isGoalStatus(statusField)) {
        throw new Error(`goal list: unknown status for ${goalId}: ${statusField ?? ""}`);
      }
      return { status: statusField };
    }
  }
  throw new Error(`Goal ${goalId} not found in goal list output`);
}

interface GoalShow {
  status: GoalStatus;
  hasSetup: boolean;
  testsLocked: boolean;
  /** Best-effort appetite from the text output (APOS #69), if present. */
  maxAttempts: number | undefined;
}

/** Parse `goal show <goalId>` (text): status, setup and test lock. */
function parseGoalShow(stdout: string, goalId: string): GoalShow {
  const lines = stdout.split("\n");
  const firstLine = lines[0];
  if (firstLine === undefined) {
    throw new Error(`goal show: empty output for ${goalId}`);
  }
  const fields = firstLine.split("\t");
  if (fields[0] !== goalId) {
    throw new Error(`Goal ${goalId} not found in goal show output`);
  }
  const statusField = fields[1];
  if (statusField === undefined || !isGoalStatus(statusField)) {
    throw new Error(`goal show: unknown status for ${goalId}: ${statusField ?? ""}`);
  }
  const hasSetup = !stdout.includes("không có setup");
  let testsLocked = false;
  if (!stdout.includes("không có khoá test")) {
    const lockedRow = lines.find((line) => line.includes("Test đã khoá"));
    if (lockedRow !== undefined) {
      const value = lockedRow.replace(/^.*Test đã khoá\s*/, "").trim();
      testsLocked = value !== "" && value !== "không có";
    }
  }
  return { status: statusField, hasSetup, testsLocked, maxAttempts: scanTextForAppetite(stdout) };
}

interface Metrics {
  attemptsUsed: number;
  packageStatus: PackageStatus;
  /** Best-effort appetite from the JSON output (APOS #69), if present. */
  maxAttempts: number | undefined;
}

/** Parse `metrics show <goalId>` (JSON by default): submits and red gates. */
function parseMetrics(stdout: string, goalId: string): Metrics {
  const parsed = parseJson("metrics", stdout);
  if (!isRecord(parsed)) {
    throw new Error("metrics: unexpected JSON shape (expected an object)");
  }
  if (parsed["goalId"] !== goalId) {
    throw new Error(`Goal ${goalId} not found in metrics show output`);
  }
  const submits = parsed["submitsByPackage"];
  if (!isRecord(submits)) {
    throw new Error("metrics: unexpected submitsByPackage (expected an object of counts)");
  }
  let attemptsUsed = 0;
  for (const count of Object.values(submits)) {
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new Error("metrics: unexpected submitsByPackage value (expected a non-negative integer)");
    }
    attemptsUsed += count;
  }
  const redGates = parsed["redGates"];
  if (typeof redGates !== "number" || !Number.isInteger(redGates) || redGates < 0) {
    throw new Error("metrics: unexpected redGates (expected a non-negative integer)");
  }
  const packageStatus: PackageStatus =
    attemptsUsed === 0 ? "none" : redGates === attemptsUsed ? "red" : "pending";
  return { attemptsUsed, packageStatus, maxAttempts: validMaxAttempts(parsed["maxAttempts"]) };
}

/** APOS package statuses (`src/domain/transitions.ts`) and their orchestrator mapping. */
const PACKAGE_STATUS_MAP: Record<string, PackageStatus> = {
  pending: "none",
  submitted: "pending",
  green: "green",
  red: "red",
  "needs-human": "needs-human",
};

/**
 * Parse `package list <goalId>` (JSON keyed by package id): each entry's
 * APOS status maps to a `PackageState` (see `PACKAGE_STATUS_MAP`). The
 * entry's `attempts` count is validated when present but is not kept —
 * the submit total already comes from `metrics show`. Rejects on
 * unparseable JSON, a wrong shape, or an unknown APOS status, like
 * every other source.
 */
function parsePackageList(stdout: string, goalId: string): Record<string, PackageState> {
  const parsed = parseJson("package list", stdout);
  if (!isRecord(parsed)) {
    throw new Error("package list: unexpected JSON shape (expected an object keyed by package id)");
  }
  const packages: Record<string, PackageState> = {};
  for (const [id, entry] of Object.entries(parsed)) {
    if (!isRecord(entry) || typeof entry["status"] !== "string") {
      throw new Error(`package list: unexpected entry for ${id} in ${goalId}`);
    }
    const mapped = PACKAGE_STATUS_MAP[entry["status"]];
    if (mapped === undefined) {
      throw new Error(`package list: unknown status "${entry["status"]}" for ${id} in ${goalId}`);
    }
    const attempts = entry["attempts"];
    if (
      attempts !== undefined &&
      (typeof attempts !== "number" || !Number.isInteger(attempts) || attempts < 0)
    ) {
      throw new Error(`package list: unexpected attempts for ${id} in ${goalId}`);
    }
    packages[id] = { status: mapped };
  }
  return packages;
}

/**
 * Read the per-package states from `package list <goalId>`. Returns
 * `undefined` when the call itself is unavailable (the executor throws
 * or the CLI exits non-zero — e.g. an older recorded-output executor
 * that predates this sixth call, or a Goal with no packages yet): the
 * caller then falls back to the scalar Solo fields. A call that
 * answers (exit 0) but with unparseable output still rejects, like
 * every other source.
 */
async function readPackageList(
  run: CliExecutor,
  goalId: string,
): Promise<Record<string, PackageState> | undefined> {
  let result: CliResult;
  try {
    result = await run(["package", "list", goalId]);
  } catch {
    return undefined;
  }
  if (result.exitCode !== 0) {
    return undefined;
  }
  return parsePackageList(result.stdout, goalId);
}

/**
 * Read the state of `goalId` in the project at `projectPath` via the APOS
 * CLI. Sources: `inbox --json` (primary), `plan --json`, `goal list`
 * (text — no `--json` flag exists), `goal show` (text — no `--json` flag
 * exists), `metrics show` (JSON by default — no `--json` flag exists)
 * and `package list` (JSON by default — the per-package source, GOAL-004).
 * Rejects when the CLI fails, its output cannot be parsed, or the goal is
 * not found. Never runs a human-gated command.
 *
 * `options.attemptsMax` overrides the default maximum attempts (3); see
 * `ReadGoalStateOptions`. The returned `attemptsMax` is always at least
 * `attemptsUsed`. `attemptsMaxSource` says where the value came from:
 * "cli" when a CLI output exposed a valid `maxAttempts` (APOS #69), else
 * "default" — including when `options.attemptsMax` overrode it.
 * `integrationStatus` is always "none" (see the header note: no CLI read
 * exposes the integration gate outcome).
 */
export async function readGoalState(
  projectPath: string,
  goalId: string,
  executor?: CliExecutor,
  options?: ReadGoalStateOptions,
): Promise<GoalState> {
  const attemptsMaxOption = options?.attemptsMax;
  if (
    attemptsMaxOption !== undefined &&
    (!Number.isInteger(attemptsMaxOption) || attemptsMaxOption < 1)
  ) {
    throw new Error("attemptsMax must be a positive integer");
  }
  const run = executor ?? defaultExecutor(projectPath);

  const inboxOut = await runRead(run, "inbox", ["inbox", "--json"]);
  const inboxAppetite = parseInbox(inboxOut, goalId);

  const planOut = await runRead(run, "plan", ["plan", "--json"]);
  // The plan is validated (JSON shape, goal listed when present), but the
  // status below comes from `goal show`, the most detailed source; `goal
  // list` and `plan` agree with it in the recorded output.
  const plan = parsePlan(planOut, goalId);

  const goalListOut = await runRead(run, "goal list", ["goal", "list"]);
  // Rejects when the goal is missing from the list.
  parseGoalList(goalListOut, goalId);

  const goalShowOut = await runRead(run, "goal show", ["goal", "show", goalId]);
  const goalShow = parseGoalShow(goalShowOut, goalId);

  const metricsOut = await runRead(run, "metrics show", ["metrics", "show", goalId]);
  const metrics = parseMetrics(metricsOut, goalId);

  // Per-package states (GOAL-004): the sixth read-only call. When the
  // call itself is unavailable the reader falls back to the scalar
  // Solo fields and leaves `packages` undefined (see readPackageList).
  const packages = await readPackageList(run, goalId);

  // Status comes from `goal show` (its row was already checked against
  // `goal list` by the parsers above, which reject a missing goal).
  const status = goalShow.status;

  // Appetite: an explicit option wins; else the first valid value the
  // CLI exposed (metrics, plan, inbox, goal show — in that order);
  // else the default 3. A valid CLI value below attemptsUsed is clamped
  // to attemptsUsed but still counts as "cli" (it was exposed).
  const cliAppetite =
    metrics.maxAttempts ?? plan.maxAttempts ?? inboxAppetite ?? goalShow.maxAttempts;
  const attemptsMaxSource: "cli" | "default" =
    attemptsMaxOption === undefined && cliAppetite !== undefined ? "cli" : "default";
  const attemptsMax = Math.max(
    attemptsMaxOption ?? cliAppetite ?? DEFAULT_ATTEMPTS_MAX,
    metrics.attemptsUsed,
  );

  return {
    goalId,
    status,
    hasSetup: goalShow.hasSetup,
    testsLocked: goalShow.testsLocked,
    attemptsUsed: metrics.attemptsUsed,
    attemptsMax,
    attemptsMaxSource,
    packageStatus: metrics.packageStatus,
    // Only present when `package list` answered; absent (not explicit
    // `undefined` — exactOptionalPropertyTypes) when it did not.
    ...(packages !== undefined ? { packages } : {}),
    // No CLI read exposes the integration gate outcome (see the header
    // note); the reader reports "none" and never guesses it.
    integrationStatus: "none",
  };
}
