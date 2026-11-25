// Acceptance tests for AC-7 (ORCHESTRATOR.md) — the doc must describe the
// loop, the state -> next-step table, and the human-gated command list,
// matching the behaviour pinned by the state-machine tests. The doc is
// read from the repo root; this test is the one allowed to fail because
// the file does not exist yet (the Worker writes it).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nextStep, type GoalState } from "./state-machine.js";

/** The fourteen human-only commands from R-4. */
const R4_HUMAN_GATED_COMMANDS = [
  "goal approve",
  "goal appetite",
  "goal select",
  "outcome close",
  "outcome revise",
  "outcome stop",
  "gate confirm",
  "gate run --base",
  "blocker resolve",
  "setup approve",
  "exception approve --human",
  "bug approve",
  "maintenance approve",
  "hotfix",
] as const;

/** State rows the doc's table must show, with the step the code returns. */
const TABLE_ROWS: Array<{ state: Partial<GoalState>; stateToken: string; action: string }> = [
  { state: { status: "draft" }, stateToken: "draft", action: "wait-human-approve" },
  { state: { status: "approved" }, stateToken: "approved", action: "wait-human-select" },
  { state: { status: "selected" }, stateToken: "selected", action: "lead-propose" },
  {
    state: { status: "executing", hasSetup: true, testsLocked: false, packageStatus: "none" },
    stateToken: "executing",
    action: "tests-submit",
  },
  {
    state: { status: "executing", hasSetup: false, packageStatus: "none" },
    stateToken: "executing",
    action: "worker-write-code",
  },
  {
    state: { status: "executing", packageStatus: "pending" },
    stateToken: "executing",
    action: "package-submit",
  },
  {
    state: { status: "executing", packageStatus: "red", attemptsUsed: 1, attemptsMax: 3 },
    stateToken: "executing",
    action: "worker-fix",
  },
  {
    state: { status: "executing", packageStatus: "red", attemptsUsed: 3, attemptsMax: 3 },
    stateToken: "executing",
    action: "report-human-blocked",
  },
  {
    state: { status: "executing", packageStatus: "green" },
    stateToken: "executing",
    action: "wait-human-close",
  },
  { state: { status: "verified" }, stateToken: "verified", action: "wait-human-close" },
  { state: { status: "blocked" }, stateToken: "blocked", action: "report-human-blocked" },
  { state: { status: "closed" }, stateToken: "closed", action: "done" },
];

function readDoc(): string {
  return readFileSync(fileURLToPath(new URL("../ORCHESTRATOR.md", import.meta.url)), "utf-8");
}

function baseState(overrides: Partial<GoalState>): GoalState {
  return {
    goalId: "GOAL-001",
    status: "executing",
    hasSetup: false,
    testsLocked: false,
    attemptsUsed: 0,
    attemptsMax: 3,
    packageStatus: "none",
    ...overrides,
  };
}

describe("AC-7: ORCHESTRATOR.md documents the loop, the state table and the human-gated list", () => {
  it("AC-7: ORCHESTRATOR.md exists and describes the loop", () => {
    const doc = readDoc();
    expect(doc.trim().length).toBeGreaterThan(0);
    expect(doc.toLowerCase()).toContain("loop");
    expect(doc).toContain("human");
  });

  it("AC-7: ORCHESTRATOR.md lists every human-gated command", () => {
    const doc = readDoc();
    for (const command of R4_HUMAN_GATED_COMMANDS) {
      expect(doc).toContain(command);
    }
  });

  it("AC-7: state table in ORCHESTRATOR.md matches the state machine", () => {
    const doc = readDoc();
    const lines = doc.split("\n");
    for (const row of TABLE_ROWS) {
      // The code's answer for this state must be the table's answer.
      expect(nextStep(baseState(row.state)).action).toBe(row.action);
      // And the doc must show that state next to that step on one line
      // (table row, list item or prose — format-tolerant).
      expect(
        lines.some((line) => line.includes(row.stateToken) && line.includes(row.action)),
      ).toBe(true);
    }
  });
});
