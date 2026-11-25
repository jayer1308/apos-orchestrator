// Acceptance tests for AC-5 (dry run), AC-3 (human gates) and AC-4 (red
// gate) — through the public entry `runDryRun` of src/loop.ts only.
//
// The dry run walks scripted sample states; it creates no commit, runs no
// human-gated command and edits no real file. Tester-defined composition
// (reported to the Lead): the lead phase of a selected Goal yields two
// consecutive actions, lead-propose then lead-commit; `nextStep(selected)`
// is the entry to that phase. In the red-gate scenario the first
// package-submit goes red with attempts left (worker-fix, submit again)
// and the second goes red with attempts exhausted (report-human-blocked).
import { describe, expect, it } from "vitest";
import { runDryRun, type DryRunResult, type DryRunScenarioName } from "./loop.js";

function scenario(result: DryRunResult, name: DryRunScenarioName) {
  const found = result.scenarios.find((s) => s.name === name);
  expect(found).toBeDefined();
  return found!;
}

function actions(result: DryRunResult, name: DryRunScenarioName): string[] {
  return scenario(result, name).steps.map((s) => s.action);
}

describe("AC-5: dry run on a sample project gives the Solo step sequence", () => {
  it("AC-5: dry run with setup gives lead-propose -> lead-commit -> tests-submit -> package-submit -> wait-human-close", () => {
    const result = runDryRun();
    expect(actions(result, "with-setup")).toEqual([
      "lead-propose",
      "lead-commit",
      "tests-submit",
      "package-submit",
      "wait-human-close",
    ]);
    const last = scenario(result, "with-setup").steps.at(-1);
    expect(last?.humanGate).toBe(true);
    expect(scenario(result, "with-setup").humanGatedAttempted).toBe(false);
  });

  it("AC-5: dry run without setup goes through worker-write-code", () => {
    const result = runDryRun();
    expect(actions(result, "without-setup")).toEqual([
      "lead-propose",
      "lead-commit",
      "worker-write-code",
      "package-submit",
      "wait-human-close",
    ]);
    expect(scenario(result, "without-setup").humanGatedAttempted).toBe(false);
  });

  it("AC-5: dry run covers the with-setup, without-setup, red-gate and code-ready scenarios", () => {
    const result = runDryRun();
    // GOAL-002 AC-5 (approved criterion) adds the "code-ready" scenario
    // to the dry run; the old exact list of three names contradicted
    // that criterion, so the criterion wins and this list is updated
    // (see _core/execute.md §1: a test contradicting an approved
    // acceptance criterion is updated and the reason cited).
    expect(result.scenarios.map((s) => s.name).sort()).toEqual([
      "code-ready",
      "red-gate",
      "with-setup",
      "without-setup",
    ]);
    expect(result.humanGatedAttempted).toBe(false);
  });
});

describe("AC-4: red gate retries with worker-fix, exhausted attempts stop for human", () => {
  it("AC-4: dry run red gate retries with worker-fix then submits again, then stops for human when attempts are exhausted", () => {
    const result = runDryRun();
    expect(actions(result, "red-gate")).toEqual([
      "lead-propose",
      "lead-commit",
      "worker-write-code",
      "package-submit",
      "worker-fix",
      "package-submit",
      "report-human-blocked",
    ]);
    const steps = scenario(result, "red-gate").steps;
    expect(steps.at(-1)?.action).toBe("report-human-blocked");
    expect(steps.at(-1)?.humanGate).toBe(true);
    expect(scenario(result, "red-gate").humanGatedAttempted).toBe(false);
  });
});

describe("AC-3: loop never runs a human-gated command and stops at human gates", () => {
  it("AC-3: dry run never attempts a human-gated command in any scenario", () => {
    const result = runDryRun();
    expect(result.humanGatedAttempted).toBe(false);
    for (const s of result.scenarios) {
      expect(s.humanGatedAttempted).toBe(false);
    }
  });

  it("AC-3: dry run stops at the first human gate in each scenario", () => {
    const result = runDryRun();
    for (const s of result.scenarios) {
      // A humanGate step ends the scenario: it is the last step, and no
      // earlier step is a human gate (the loop does not run past a gate).
      expect(s.steps.length).toBeGreaterThan(0);
      expect(s.steps.at(-1)?.humanGate).toBe(true);
      for (const step of s.steps.slice(0, -1)) {
        expect(step.humanGate).toBe(false);
      }
    }
  });
});
