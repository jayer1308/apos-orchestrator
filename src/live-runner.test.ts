// Acceptance tests for GOAL-002 AC-2 (live runner) and the AC-3 default
// notice — through the public entry `runLive` of src/index.ts only.
//
// Tester-defined contract (execution-002.json fixes the behaviour but not
// the signature; the Worker implements this exact signature):
// - `runLive(argv, options?)`: parses `--repo <project> --goal <id>` from
//   argv, reads the real state through `readGoalState` (the injected
//   `options.executor` stands in for the APOS CLI in tests), calls
//   `nextStep`, and prints the next step (via `options.print`, default
//   console.log). It returns `{ goalId, state, step, stoppedAtHumanGate }`.
// - At a human gate it only prints and stops (`stoppedAtHumanGate` true);
//   it never runs a human-gated command (only read calls reach the CLI).
// - It prints the attemptsMax source: when the CLI exposes no appetite it
//   says explicitly that the default is in use ("đang dùng mặc định" /
//   "using the default"); when the CLI exposes one it uses that value and
//   says no such thing.
// - Missing --repo/--goal rejects with a usage error naming both flags.
// `runLive` does not exist yet (src/index.ts is still the placeholder),
// so the tests reach it through a namespace import and fail on the
// "must be a function" assertion until the Worker implements it — red for
// the right reason, without a load error.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as indexModule from "./index.js";
import type { CliExecutor } from "./state-reader.js";
import type { GoalState, Step } from "./state-machine.js";

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

/** Fixtures with GOAL-001 moved to status `selected` (value-only edits). */
function selectedGoal001Fixtures(): FixtureSet {
  const fixtures = recordedFixtures();
  const plan = JSON.parse(fixtures.plan) as { goals: Array<Record<string, unknown>> };
  const goal = plan.goals.find((g) => g["id"] === "GOAL-001");
  if (goal === undefined) throw new Error("GOAL-001 missing from plan fixture");
  goal["status"] = "selected";
  return {
    ...fixtures,
    plan: JSON.stringify(plan),
    goalList: fixtures.goalList.replace("executing", "selected"),
    goalShow: fixtures.goalShow.replace("executing", "selected"),
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

interface LiveResult {
  goalId: string;
  state: GoalState;
  step: Step;
  stoppedAtHumanGate: boolean;
}

type RunLive = (
  argv: readonly string[],
  options?: { executor?: CliExecutor; print?: (line: string) => void },
) => Promise<LiveResult>;

/** The entry under test; fails the test (not the load) while it is missing. */
function requireRunLive(): RunLive {
  const runLive = (indexModule as unknown as { runLive?: unknown }).runLive;
  expect(typeof runLive).toBe("function");
  return runLive as RunLive;
}

function attemptsMaxSource(result: LiveResult): string | undefined {
  return (result.state as unknown as { attemptsMaxSource?: string }).attemptsMaxSource;
}

/** Tokens no runner call may ever contain (human-only commands, R-4). */
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

const PROJECT = "/home/hatch/workspace/apos-orchestrator";

describe("AC-2 (GOAL-002): live runner reads real state and prints the next step", () => {
  it("AC-2: runLive on an executing goal without setup prints worker-write-code", async () => {
    const lines: string[] = [];
    const result = await requireRunLive()(["--repo", PROJECT, "--goal", "GOAL-001"], {
      executor: fakeExecutor(recordedFixtures()),
      print: (line) => lines.push(line),
    });
    expect(result.goalId).toBe("GOAL-001");
    expect(result.step.action).toBe("worker-write-code");
    expect(result.stoppedAtHumanGate).toBe(false);
    expect(lines.join("\n")).toContain("worker-write-code");
  });

  it("AC-2: runLive accepts --repo/--goal in either order", async () => {
    const lines: string[] = [];
    const result = await requireRunLive()(["--goal", "GOAL-001", "--repo", PROJECT], {
      executor: fakeExecutor(recordedFixtures()),
      print: (line) => lines.push(line),
    });
    expect(result.goalId).toBe("GOAL-001");
    expect(result.step.action).toBe("worker-write-code");
    expect(lines.join("\n")).toContain("worker-write-code");
  });

  it("AC-2: runLive on a selected goal prints lead-propose", async () => {
    const lines: string[] = [];
    const result = await requireRunLive()(["--repo", PROJECT, "--goal", "GOAL-001"], {
      executor: fakeExecutor(selectedGoal001Fixtures()),
      print: (line) => lines.push(line),
    });
    expect(result.step.action).toBe("lead-propose");
    expect(result.stoppedAtHumanGate).toBe(false);
    expect(lines.join("\n")).toContain("lead-propose");
  });

  it("AC-2: runLive rejects when --repo is missing", async () => {
    await expect(
      requireRunLive()(["--goal", "GOAL-001"], { executor: fakeExecutor(recordedFixtures()) }),
    ).rejects.toThrow(/--repo.*--goal|--goal.*--repo/);
  });

  it("AC-2: runLive rejects when --goal is missing", async () => {
    await expect(
      requireRunLive()(["--repo", PROJECT], { executor: fakeExecutor(recordedFixtures()) }),
    ).rejects.toThrow(/--repo.*--goal|--goal.*--repo/);
  });

  it("AC-2: src/index.ts has no placeholder left", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./index.ts", import.meta.url)),
      "utf-8",
    );
    expect(source.toLowerCase()).not.toContain("placeholder");
  });

  it("AC-2: package.json has a `live` script running the real entry", () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8"),
    ) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["live"]).toBeDefined();
    expect(pkg.scripts?.["live"]).toContain("index");
  });
});

describe("AC-2 (GOAL-002): runner stops at a human gate and never runs a human command", () => {
  it("AC-2: runLive on a draft goal stops at wait-human-approve and only reads", async () => {
    const calls: Array<readonly string[]> = [];
    const lines: string[] = [];
    const result = await requireRunLive()(["--repo", PROJECT, "--goal", "GOAL-002"], {
      executor: fakeExecutor(draftGoal002Fixtures(), calls),
      print: (line) => lines.push(line),
    });
    expect(result.step.action).toBe("wait-human-approve");
    expect(result.step.humanGate).toBe(true);
    expect(result.stoppedAtHumanGate).toBe(true);
    expect(lines.join("\n")).toContain("wait-human-approve");
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.some((arg) => HUMAN_TOKENS.includes(arg))).toBe(false);
      expect(call.includes("--on-behalf")).toBe(false);
    }
  });
});

describe("AC-3 (GOAL-002): live runner says which appetite is in use", () => {
  it("AC-3: CLI exposing no appetite prints that the default 3 is in use", async () => {
    const lines: string[] = [];
    const result = await requireRunLive()(["--repo", PROJECT, "--goal", "GOAL-001"], {
      executor: fakeExecutor(recordedFixtures()),
      print: (line) => lines.push(line),
    });
    expect(result.state.attemptsMax).toBe(3);
    expect(attemptsMaxSource(result)).toBe("default");
    expect(lines.join("\n")).toMatch(/đang dùng mặc định|using the default/i);
  });

  it("AC-3: CLI exposing an appetite uses it and prints no default notice", async () => {
    const fixtures = recordedFixtures();
    const metrics = JSON.parse(fixtures.metrics) as Record<string, unknown>;
    metrics["maxAttempts"] = 2;
    fixtures.metrics = JSON.stringify(metrics);
    const lines: string[] = [];
    const result = await requireRunLive()(["--repo", PROJECT, "--goal", "GOAL-001"], {
      executor: fakeExecutor(fixtures),
      print: (line) => lines.push(line),
    });
    expect(result.state.attemptsMax).toBe(2);
    expect(attemptsMaxSource(result)).toBe("cli");
    expect(lines.join("\n")).not.toMatch(/đang dùng mặc định|using the default/i);
  });
});
