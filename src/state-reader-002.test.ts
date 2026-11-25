// Acceptance tests for GOAL-002 AC-3 (appetite) — through the public
// entry `readGoalState` of src/state-reader.ts only, fed recorded CLI
// output through a fake `CliExecutor` (same pattern as the GOAL-001 reader
// tests; fixtures in src/test-fixtures/).
//
// Tester-defined contract (execution-002.json fixes the behaviour but not
// the field name; the Worker implements this exact name):
// - The reader best-effort scans the CLI outputs it already reads for an
//   exposed appetite under the key `maxAttempts` (metrics show, plan
//   --json). A present, valid (positive integer) value is used.
// - The result carries `attemptsMaxSource: "cli" | "default"` so the live
//   runner can print which one is in use. When no CLI output exposes an
//   appetite, attemptsMax is the default 3 and the source is "default".
// - An invalid exposed value (0, negative, non-integer, non-number) is
//   ignored and the default applies.
// New fields are read through casts so these tests compile against the
// current code and fail on assertions, not on load or type errors.
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

/** Fake APOS CLI: answers each subcommand from the fixture set. */
function fakeExecutor(
  fixtures: FixtureSet,
  calls: Array<readonly string[]> = [],
): CliExecutor {
  return async (args) => {
    calls.push(args);
    let stdout: string | undefined;
    if (args.includes("inbox")) stdout = fixtures.inbox;
    else if (args.includes("plan")) stdout = fixtures.plan;
    else if (args.includes("goal") && args.includes("list")) stdout = fixtures.goalList;
    else if (args.includes("goal") && args.includes("show")) stdout = fixtures.goalShow;
    else if (args.includes("metrics")) stdout = fixtures.metrics;
    if (stdout === undefined) {
      throw new Error(`unexpected APOS call: ${args.join(" ")}`);
    }
    return { stdout, stderr: "", exitCode: 0 };
  };
}

const PROJECT = "/home/hatch/workspace/apos-orchestrator";

/** The appetite source the reader reports (new GoalState field). */
function attemptsMaxSource(result: unknown): string | undefined {
  return (result as { attemptsMaxSource?: string }).attemptsMaxSource;
}

/** Fixtures with `maxAttempts` added to the metrics JSON. */
function metricsWithAppetite(value: unknown): FixtureSet {
  const fixtures = recordedFixtures();
  const metrics = JSON.parse(fixtures.metrics) as Record<string, unknown>;
  metrics["maxAttempts"] = value;
  return { ...fixtures, metrics: JSON.stringify(metrics) };
}

/** Fixtures with `maxAttempts` added to the GOAL-001 entry of plan --json. */
function planWithAppetite(value: unknown): FixtureSet {
  const fixtures = recordedFixtures();
  const plan = JSON.parse(fixtures.plan) as {
    goals: Array<Record<string, unknown>>;
  };
  const goal = plan.goals.find((g) => g["id"] === "GOAL-001");
  if (goal === undefined) throw new Error("GOAL-001 missing from plan fixture");
  goal["maxAttempts"] = value;
  return { ...fixtures, plan: JSON.stringify(plan) };
}

describe("AC-3 (GOAL-002): reader takes appetite from CLI output when exposed", () => {
  it("AC-3: metrics show exposing maxAttempts 2 gives attemptsMax 2 (not the default 3)", async () => {
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(metricsWithAppetite(2)));
    expect(result.attemptsMax).toBe(2);
    expect(attemptsMaxSource(result)).toBe("cli");
  });

  it("AC-3: plan --json exposing maxAttempts 5 for the goal gives attemptsMax 5", async () => {
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(planWithAppetite(5)));
    expect(result.attemptsMax).toBe(5);
    expect(attemptsMaxSource(result)).toBe("cli");
  });

  it("AC-3: an exposed appetite below attemptsUsed still returns at least attemptsUsed", async () => {
    const fixtures = {
      ...recordedFixtures(),
      metrics: readFixture("metrics-show-submits.json"),
    };
    const metrics = JSON.parse(fixtures.metrics) as Record<string, unknown>;
    metrics["maxAttempts"] = 1;
    fixtures.metrics = JSON.stringify(metrics);
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(fixtures));
    expect(result.attemptsUsed).toBe(2);
    expect(result.attemptsMax).toBe(2);
    expect(attemptsMaxSource(result)).toBe("cli");
  });

  it.each([0, -1, 1.5, "3", null])(
    "AC-3: invalid exposed appetite %s is ignored and the default 3 applies",
    async (value) => {
      const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(metricsWithAppetite(value)));
      expect(result.attemptsMax).toBe(3);
      expect(attemptsMaxSource(result)).toBe("default");
    },
  );
});

describe("AC-3 (GOAL-002): no exposed appetite means default 3, said so explicitly", () => {
  it("AC-3: CLI exposing no appetite gives attemptsMax 3 with source default", async () => {
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(recordedFixtures()));
    expect(result.attemptsMax).toBe(3);
    expect(attemptsMaxSource(result)).toBe("default");
  });

  it("AC-3: explicit options.attemptsMax still applies when the CLI exposes nothing", async () => {
    const result = await readGoalState(PROJECT, "GOAL-001", fakeExecutor(recordedFixtures()), {
      attemptsMax: 5,
    });
    expect(result.attemptsMax).toBe(5);
    expect(attemptsMaxSource(result)).toBe("default");
  });

  it("AC-3: reader never reads appetite from anywhere but CLI output (no direct controller-file reads)", async () => {
    const calls: Array<readonly string[]> = [];
    const result = await readGoalState(
      "/tmp/apos-orchestrator-no-such-project-7f3a",
      "GOAL-001",
      fakeExecutor(recordedFixtures(), calls),
    );
    expect(result.attemptsMax).toBe(3);
    expect(attemptsMaxSource(result)).toBe("default");
    expect(calls.length).toBeGreaterThan(0);
  });
});
