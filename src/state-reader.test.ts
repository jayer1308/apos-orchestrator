// Acceptance tests for AC-2 (state reader) — through the public entry
// `readGoalState` of src/state-reader.ts only. The reader is fed recorded
// APOS CLI output through an injected fake `CliExecutor`, so tests never
// depend on live controller state. Fixtures live in src/test-fixtures/
// (see its README.md for provenance).
//
// Tester-defined mapping decisions (reported to the Lead):
// - attemptsUsed = total package submits (sum of `submitsByPackage`);
//   `redGates` alone does not count attempts.
// - packageStatus "pending" = packages submitted but no outcome recorded;
//   "red" = every submitted package hit a red gate (`redGates` equals the
//   submit total and is > 0); "none" = no submits at all.
// - attemptsMax comes from the Goal's appetite; no CLI output recorded
//   here exposes it, so tests only pin that it is a positive integer
//   no smaller than attemptsUsed.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readGoalState, type CliExecutor, type CliResult } from "./state-reader.js";

const fixturesDir = fileURLToPath(new URL("./test-fixtures/", import.meta.url));

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

interface FixtureSet {
  inbox: string;
  plan: string;
  goalList: string;
  goalShow: string;
  metrics: string;
}

function recordedFixtures(): FixtureSet {
  return {
    inbox: readFixture("inbox.json"),
    plan: readFixture("plan.json"),
    goalList: readFixture("goal-list.txt"),
    goalShow: readFixture("goal-show-GOAL-001.txt"),
    metrics: readFixture("metrics-show-GOAL-001.json"),
  };
}

function draftGoal002Fixtures(): FixtureSet {
  return {
    inbox: readFixture("inbox.json"),
    plan: readFixture("plan-GOAL-002-draft.json"),
    goalList: readFixture("goal-list-GOAL-002-draft.txt"),
    goalShow: readFixture("goal-show-GOAL-002-draft.txt"),
    metrics: readFixture("metrics-show-GOAL-002-draft.json"),
  };
}

/** Fake APOS CLI: answers each subcommand from the fixture set. */
function fakeExecutor(
  fixtures: FixtureSet,
  calls: Array<readonly string[]>,
  overrides: Partial<Record<"inbox" | "plan" | "goal-list" | "goal-show" | "metrics", CliResult>> = {},
): CliExecutor {
  return async (args) => {
    calls.push(args);
    let key: keyof typeof overrides | undefined;
    let stdout: string | undefined;
    if (args.includes("inbox")) {
      key = "inbox";
      stdout = fixtures.inbox;
    } else if (args.includes("plan")) {
      key = "plan";
      stdout = fixtures.plan;
    } else if (args.includes("goal") && args.includes("list")) {
      key = "goal-list";
      stdout = fixtures.goalList;
    } else if (args.includes("goal") && args.includes("show")) {
      key = "goal-show";
      stdout = fixtures.goalShow;
    } else if (args.includes("metrics")) {
      key = "metrics";
      stdout = fixtures.metrics;
    }
    if (key === undefined || stdout === undefined) {
      throw new Error(`unexpected APOS call: ${args.join(" ")}`);
    }
    return overrides[key] ?? { stdout, stderr: "", exitCode: 0 };
  };
}

const PROJECT = "/home/hatch/workspace/apos-orchestrator";

/** Tokens no reader call may ever contain (human-only commands, R-4). */
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

describe("AC-2: state reader returns the Goal state as JSON from APOS CLI output", () => {
  it("AC-2: reader returns GOAL-001 state as JSON from recorded CLI output", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(recordedFixtures(), calls));
    expect(result.goalId).toBe("GOAL-001");
    expect(result.status).toBe("executing");
    expect(result.hasSetup).toBe(false);
    expect(result.testsLocked).toBe(false);
    expect(result.packageStatus).toBe("none");
    expect(result.attemptsUsed).toBe(0);
    expect(typeof result.attemptsMax).toBe("number");
    expect(result.attemptsMax).toBeGreaterThanOrEqual(1);
    expect(result.attemptsUsed).toBeLessThanOrEqual(result.attemptsMax);
    // The result is plain JSON (AC-2: "trả về ... dưới dạng JSON").
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("AC-2: reader uses inbox --json as its primary source", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(recordedFixtures(), calls));
    expect(result.goalId).toBe("GOAL-001");
    expect(calls.some((c) => c.includes("inbox") && c.includes("--json"))).toBe(true);
  });

  it("AC-2: reader calls plan --json", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(recordedFixtures(), calls));
    expect(result.status).toBe("executing");
    expect(calls.some((c) => c.includes("plan") && c.includes("--json"))).toBe(true);
  });

  it("AC-2: reader parses goal list as text because it has no --json flag", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(recordedFixtures(), calls));
    expect(result.goalId).toBe("GOAL-001");
    expect(result.status).toBe("executing");
    expect(calls.some((c) => c.includes("goal") && c.includes("list"))).toBe(true);
    expect(
      calls.some((c) => c.includes("goal") && c.includes("list") && c.includes("--json")),
    ).toBe(false);
  });

  it("AC-2: reader parses goal show text (no --json flag) for setup and test lock", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(recordedFixtures(), calls));
    expect(result.hasSetup).toBe(false);
    expect(result.testsLocked).toBe(false);
    expect(calls.some((c) => c.includes("goal") && c.includes("show"))).toBe(true);
    expect(
      calls.some((c) => c.includes("goal") && c.includes("show") && c.includes("--json")),
    ).toBe(false);
  });

  it("AC-2: reader parses metrics show output without a --json flag", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(recordedFixtures(), calls));
    expect(result.attemptsUsed).toBe(0);
    expect(result.packageStatus).toBe("none");
    expect(calls.some((c) => c.includes("metrics"))).toBe(true);
    expect(calls.some((c) => c.includes("metrics") && c.includes("--json"))).toBe(false);
  });

  it("AC-2: reader returns the same shape for a different goal (GOAL-002 draft)", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(
      PROJECT,
      "GOAL-002",
      fakeExecutor(draftGoal002Fixtures(), calls),
    );
    expect(result.goalId).toBe("GOAL-002");
    expect(result.status).toBe("draft");
    expect(result.hasSetup).toBe(false);
    expect(result.testsLocked).toBe(false);
    expect(result.packageStatus).toBe("none");
    expect(result.attemptsUsed).toBe(0);
    expect(result.attemptsMax).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it("AC-2: reader counts submitted packages as attempts used", async () => {
    const fixtures = { ...recordedFixtures(), metrics: readFixture("metrics-show-submits.json") };
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(fixtures, calls));
    expect(result.attemptsUsed).toBe(2);
    expect(result.attemptsMax).toBeGreaterThanOrEqual(2);
    expect(result.packageStatus).toBe("pending");
  });

  it("AC-2: reader reports red when every submitted package hit a red gate", async () => {
    const fixtures = { ...recordedFixtures(), metrics: readFixture("metrics-show-red.json") };
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(fixtures, calls));
    expect(result.attemptsUsed).toBe(2);
    expect(result.packageStatus).toBe("red");
  });

  it("AC-2: reader works from CLI output alone, not from files under the project path", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(
      "/tmp/apos-orchestrator-no-such-project-7f3a",
      "GOAL-001",
      fakeExecutor(recordedFixtures(), calls),
    );
    expect(result.goalId).toBe("GOAL-001");
    expect(result.status).toBe("executing");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("AC-2: reader never runs a human-gated command", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(recordedFixtures(), calls));
    expect(result.goalId).toBe("GOAL-001");
    for (const call of calls) {
      expect(call.some((arg) => HUMAN_TOKENS.includes(arg))).toBe(false);
      expect(call.includes("--on-behalf")).toBe(false);
    }
  });

  it("AC-2: reader rejects when inbox output is not JSON", async () => {
    const calls: Array<readonly string[]> = [];
    const executor = fakeExecutor(recordedFixtures(), calls, {
      inbox: { stdout: "not json {", stderr: "", exitCode: 0 },
    });
    await expect(readGoalState(PROJECT, "GOAL-001", executor)).rejects.toThrow(/inbox/i);
  });

  it("AC-2: reader rejects when the goal is missing from CLI output", async () => {
    const calls: Array<readonly string[]> = [];
    await expect(
      readGoalState(PROJECT, "GOAL-999", fakeExecutor(recordedFixtures(), calls)),
    ).rejects.toThrow(/GOAL-999/);
  });

  it("AC-2: reader rejects when a CLI command fails", async () => {
    const calls: Array<readonly string[]> = [];
    const executor = fakeExecutor(recordedFixtures(), calls, {
      metrics: { stdout: "", stderr: "boom", exitCode: 1 },
    });
    await expect(readGoalState(PROJECT, "GOAL-001", executor)).rejects.toThrow(/metrics/i);
  });
});
