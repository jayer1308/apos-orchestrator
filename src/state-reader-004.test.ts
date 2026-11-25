// Acceptance tests for GOAL-004 AC-1 (state reader per package) and
// AC-5 (Solo reader behaviour stays green) — through the public entry
// `readGoalState` of src/state-reader.ts only, with a fake
// `CliExecutor` fed recorded APOS CLI output.
//
// Where the per-package state comes from (verified live 25/11, not
// guessed): `goal show GOAL-004` prints NO package table, and
// `metrics show` only has totals (`submitsByPackage`, `redGates`).
// The per-package source is `package list <goalId>`, which returns
// JSON keyed by package id — recorded verbatim in
// src/test-fixtures/package-list-GOAL-004.json (both packages
// "pending", attempts 0). The reader must make that sixth read-only
// call and map each entry to `GoalState.packages[id]`.
// Status vocabulary is APOS's own (`src/domain/transitions.ts`:
// 'pending' | 'submitted' | 'green' | 'red' | 'needs-human'):
//   APOS "pending" (registered, never submitted) -> orchestrator "none"
//   APOS "submitted" (submitted, no outcome yet) -> "pending"
//   "green" -> "green", "red" -> "red", "needs-human" -> "needs-human"
// Derived variants below are value-only edits of the recorded
// package-list shape (same convention as src/test-fixtures/README.md):
// only `status` / `attempts` change, and the matching `metrics show`
// totals change with them. The "green"/"red"/"submitted" values were
// NOT observed live on GOAL-004 (no package has been submitted yet);
// they pin the mapping the Worker must implement.
//
// `readGoalState` does not call `package list` yet, so the AC-1
// tests are red for the right reason (`packages` is undefined) until
// the Worker implements it. The AC-5 tests pin only the scalar
// fields, which the current reader already returns, and stay green.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readGoalState, type CliExecutor, type CliResult } from "./state-reader.js";
import type { PackageState } from "./state-machine.js";

const fixturesDir = fileURLToPath(new URL("./test-fixtures/", import.meta.url));
const PROJECT = "/home/hatch/workspace/apos-orchestrator";
const GOAL_ID = "GOAL-004";

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

/** The recorded `package list GOAL-004` output, parsed. */
type PackageListEntry = { status: string; attempts: number; spec?: unknown };
type PackageList = Record<string, PackageListEntry>;

function recordedPackageList(): PackageList {
  return JSON.parse(readFixture("package-list-GOAL-004.json")) as PackageList;
}

/** Value-only edit of the recorded package list: change statuses/attempts. */
function packageListWith(entries: Record<string, { status: string; attempts: number }>): string {
  const list = recordedPackageList();
  for (const [id, patch] of Object.entries(entries)) {
    const entry = list[id];
    if (entry === undefined) throw new Error(`no such package in fixture: ${id}`);
    entry.status = patch.status;
    entry.attempts = patch.attempts;
  }
  return JSON.stringify(list);
}

function metricsWith(submitsByPackage: Record<string, number>, redGates: number): string {
  return JSON.stringify({ goalId: GOAL_ID, status: "executing", submitsByPackage, redGates, minutes: 10 });
}

/** Fake APOS CLI: the five existing read calls plus `package list`. */
function fakeExecutor(packageListStdout: string, metricsStdout: string, calls: Array<readonly string[]>): CliExecutor {
  const goalList = readFixture("goal-list.txt").replaceAll("GOAL-001", GOAL_ID);
  const goalShow = readFixture("goal-show-GOAL-001.txt").replaceAll("GOAL-001", GOAL_ID);
  return async (args) => {
    calls.push(args);
    let stdout: string | undefined;
    if (args[0] === "inbox") stdout = readFixture("inbox.json");
    else if (args[0] === "plan") stdout = readFixture("plan.json");
    else if (args[0] === "package" && args[1] === "list") stdout = packageListStdout;
    else if (args[0] === "goal" && args[1] === "list") stdout = goalList;
    else if (args[0] === "goal" && args[1] === "show") stdout = goalShow;
    else if (args[0] === "metrics") stdout = metricsStdout;
    if (stdout === undefined) {
      throw new Error(`unexpected APOS call: ${args.join(" ")}`);
    }
    return { stdout, stderr: "", exitCode: 0 } as CliResult;
  };
}

function packagesOf(result: { packages?: Record<string, PackageState> }): Record<string, PackageState> {
  expect(result.packages).toBeDefined();
  return result.packages as Record<string, PackageState>;
}

const HUMAN_TOKENS = [
  "approve",
  "appetite",
  "select",
  "close",
  "revise",
  "stop",
  "confirm",
  "resolve",
  "hotfix",
];

describe("AC-1 (GOAL-004): reader returns per-package state from `package list`", () => {
  it("AC-1: reader calls `package list <goalId>` (the sixth read-only call)", async () => {
    const calls: Array<readonly string[]> = [];
    await readGoalState(PROJECT, GOAL_ID, fakeExecutor(JSON.stringify(recordedPackageList()), metricsWith({}, 0), calls));
    expect(calls.some((c) => c.join(" ") === `package list ${GOAL_ID}`)).toBe(true);
  });

  it("AC-1: recorded package list (both pending, 0 attempts) maps to packages WP-CORE + WP-DRIVE, each status none", async () => {
    const result = await readGoalState(
      PROJECT,
      GOAL_ID,
      fakeExecutor(JSON.stringify(recordedPackageList()), metricsWith({}, 0), []),
    );
    const packages = packagesOf(result);
    expect(Object.keys(packages).sort()).toEqual(["WP-CORE", "WP-DRIVE"]);
    expect(packages["WP-CORE"]?.status).toBe("none");
    expect(packages["WP-DRIVE"]?.status).toBe("none");
  });

  it("AC-1: APOS green/red per package are reported per package (value-only edit of the recorded shape)", async () => {
    const packageList = packageListWith({
      "WP-CORE": { status: "green", attempts: 1 },
      "WP-DRIVE": { status: "red", attempts: 1 },
    });
    const result = await readGoalState(
      PROJECT,
      GOAL_ID,
      fakeExecutor(packageList, metricsWith({ "WP-CORE": 1, "WP-DRIVE": 1 }, 1), []),
    );
    const packages = packagesOf(result);
    expect(packages["WP-CORE"]?.status).toBe("green");
    expect(packages["WP-DRIVE"]?.status).toBe("red");
    // The scalar fields stay the metrics-derived Solo projection.
    expect(result.attemptsUsed).toBe(2);
    expect(result.packageStatus).toBe("pending");
  });

  it("AC-1: APOS submitted (submitted, no outcome yet) maps to orchestrator pending", async () => {
    const packageList = packageListWith({
      "WP-CORE": { status: "submitted", attempts: 1 },
      "WP-DRIVE": { status: "pending", attempts: 0 },
    });
    const result = await readGoalState(
      PROJECT,
      GOAL_ID,
      fakeExecutor(packageList, metricsWith({ "WP-CORE": 1 }, 0), []),
    );
    const packages = packagesOf(result);
    expect(packages["WP-CORE"]?.status).toBe("pending");
    expect(packages["WP-DRIVE"]?.status).toBe("none");
  });

  it("AC-1: APOS needs-human maps to needs-human for that package only", async () => {
    const packageList = packageListWith({
      "WP-CORE": { status: "needs-human", attempts: 0 },
      "WP-DRIVE": { status: "pending", attempts: 0 },
    });
    const result = await readGoalState(
      PROJECT,
      GOAL_ID,
      fakeExecutor(packageList, metricsWith({}, 0), []),
    );
    const packages = packagesOf(result);
    expect(packages["WP-CORE"]?.status).toBe("needs-human");
    expect(packages["WP-DRIVE"]?.status).toBe("none");
  });

  it("AC-1: reader rejects when `package list` output cannot be parsed (like every other source)", async () => {
    await expect(
      readGoalState(PROJECT, GOAL_ID, fakeExecutor("{not json", metricsWith({}, 0), [])),
    ).rejects.toThrow();
  });
});

describe("AC-5 (GOAL-004): Solo reader behaviour stays green", () => {
  it("AC-5: scalar fields for the recorded executing Goal are unchanged", async () => {
    const result = await readGoalState(
      PROJECT,
      GOAL_ID,
      fakeExecutor(JSON.stringify(recordedPackageList()), metricsWith({}, 0), []),
    );
    expect(result.goalId).toBe(GOAL_ID);
    expect(result.status).toBe("executing");
    expect(result.hasSetup).toBe(false);
    expect(result.testsLocked).toBe(false);
    expect(result.packageStatus).toBe("none");
    expect(result.attemptsUsed).toBe(0);
    expect(result.attemptsMax).toBeGreaterThanOrEqual(1);
    expect(result.attemptsUsed).toBeLessThanOrEqual(result.attemptsMax);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("AC-5: reader calls only read-only commands, never a human-gated one", async () => {
    const calls: Array<readonly string[]> = [];
    await readGoalState(
      PROJECT,
      GOAL_ID,
      fakeExecutor(JSON.stringify(recordedPackageList()), metricsWith({}, 0), calls),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      for (const token of HUMAN_TOKENS) {
        expect(call).not.toContain(token);
      }
    }
    expect(calls.join(" ")).not.toContain("--on-behalf");
  });
});
