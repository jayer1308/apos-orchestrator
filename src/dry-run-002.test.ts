// Acceptance tests for GOAL-002 AC-5 (stays green) — the pre-existing
// dry-run behaviour must not change, and the dry run gains a code-ready
// scenario that walks real states instead of injecting "pending" from
// nowhere (execution-002.json).
import { describe, expect, it } from "vitest";
import { runDryRun } from "./loop.js";

interface ScenarioView {
  name: string;
  steps: Array<{ action: string; humanGate: boolean }>;
  humanGatedAttempted: boolean;
}

function scenarios(): ScenarioView[] {
  return runDryRun().scenarios as unknown as ScenarioView[];
}

function actions(name: string): string[] {
  const found = scenarios().find((s) => s.name === name);
  expect(found).toBeDefined();
  return found!.steps.map((s) => s.action);
}

describe("AC-5 (GOAL-002): pre-existing dry-run sequences stay green", () => {
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
});

describe("AC-5 (GOAL-002): dry run gains a code-ready scenario", () => {
  it("AC-5: a code-ready scenario walks worker-write-code -> package-submit without an injected pending", () => {
    const found = scenarios().find((s) => s.name.includes("code-ready"));
    expect(found).toBeDefined();
    expect(found!.steps.map((s) => s.action)).toEqual([
      "lead-propose",
      "lead-commit",
      "worker-write-code",
      "package-submit",
      "wait-human-close",
    ]);
    expect(found!.humanGatedAttempted).toBe(false);
  });
});
