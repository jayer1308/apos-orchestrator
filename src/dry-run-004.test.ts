// Acceptance tests for GOAL-004 AC-2 (dry run gains a multi-wp
// scenario) and AC-5 (the four Solo dry-run sequences stay green) —
// through the public entry `runDryRun` of src/loop.ts only.
//
// Tester-defined contract (execution-004.json §1): the dry run gains
// a "multi-wp" scenario — WP-A code-ready + WP-B red -> package-submit
// for WP-A, worker-fix for WP-B; then, once every package is green,
// integration-gate -> integration-complete. Steps in that scenario
// carry `packageId`, so the walk proves the steps belong to the right
// package. The scenario stops at the first human gate and never
// attempts a human-gated command, like the four Solo scenarios.
//
// `runDryRun` has no multi-wp scenario yet, so the AC-2 test is red
// for the right reason (no such scenario) until the Worker adds it.
// The AC-5 tests pin the four existing sequences exactly and stay
// green.
import { describe, expect, it } from "vitest";
import { runDryRun } from "./loop.js";

interface ScenarioView {
  name: string;
  steps: Array<{ action: string; humanGate: boolean; packageId?: string }>;
  humanGatedAttempted: boolean;
}

function scenarios(): ScenarioView[] {
  return runDryRun().scenarios as unknown as ScenarioView[];
}

function actions(name: string): string[] {
  const found = scenarios().find((s) => s.name === name);
  expect(found).toBeDefined();
  return (found as ScenarioView).steps.map((s) => s.action);
}

function orderedSubsequence(steps: string[], wanted: string[]): boolean {
  let cursor = -1;
  for (const action of wanted) {
    const at = steps.indexOf(action, cursor + 1);
    if (at === -1) return false;
    cursor = at;
  }
  return true;
}

describe("AC-5 (GOAL-004): pre-existing dry-run sequences stay green", () => {
  it("AC-5: with-setup sequence is unchanged", () => {
    expect(actions("with-setup")).toEqual([
      "lead-propose",
      "lead-commit",
      "tests-submit",
      "package-submit",
      "wait-human-close",
    ]);
  });

  it("AC-5: without-setup sequence is unchanged", () => {
    expect(actions("without-setup")).toEqual([
      "lead-propose",
      "lead-commit",
      "worker-write-code",
      "package-submit",
      "wait-human-close",
    ]);
  });

  it("AC-5: red-gate sequence is unchanged", () => {
    expect(actions("red-gate")).toEqual([
      "lead-propose",
      "lead-commit",
      "worker-write-code",
      "package-submit",
      "worker-fix",
      "package-submit",
      "report-human-blocked",
    ]);
  });

  it("AC-5: code-ready sequence is unchanged", () => {
    expect(actions("code-ready")).toEqual([
      "lead-propose",
      "lead-commit",
      "worker-write-code",
      "package-submit",
      "wait-human-close",
    ]);
  });

  it("AC-5: no dry-run scenario attempts a human-gated command", () => {
    for (const scenario of scenarios()) {
      expect(scenario.humanGatedAttempted).toBe(false);
    }
    expect(runDryRun().humanGatedAttempted).toBe(false);
  });
});

describe("AC-2 (GOAL-004): dry run gains a multi-wp scenario", () => {
  it("AC-2: a multi-wp scenario walks WP-A package-submit, WP-B worker-fix, then integration-gate -> integration-complete", () => {
    const found = scenarios().find((s) => s.name === "multi-wp");
    expect(found).toBeDefined();
    const scenario = found as ScenarioView;
    const stepActions = scenario.steps.map((s) => s.action);
    // WP-A submits while WP-B is fixed; only once every package is
    // green does the integration gate run, then integration-complete.
    expect(
      orderedSubsequence(stepActions, [
        "package-submit",
        "worker-fix",
        "integration-gate",
        "integration-complete",
      ]),
    ).toBe(true);
    const submitIndex = stepActions.indexOf("package-submit");
    const fixIndex = stepActions.indexOf("worker-fix");
    expect(scenario.steps[submitIndex]?.packageId).toBe("WP-A");
    expect(scenario.steps[fixIndex]?.packageId).toBe("WP-B");
    expect(scenario.humanGatedAttempted).toBe(false);
  });
});
