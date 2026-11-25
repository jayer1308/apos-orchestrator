// Acceptance tests for AC-1 (state machine), AC-3 (human gates) and AC-4
// (red gate) — through the public entries of src/state-machine.ts only.
// The state table is the one in the Goal task (AC-1/AC-4/AC-5); precedence
// when conditions overlap is pinned here and reported to the Lead:
// a non-"none" package status decides before the tests/worker branches
// (a pending/red/green package means tests were already submitted).
import { describe, expect, it } from "vitest";
import {
  HUMAN_GATED_COMMANDS,
  isHumanGated,
  nextStep,
  type GoalState,
  type StepAction,
} from "./state-machine.js";

/** The fourteen human-only commands from R-4, in the Goal's order. */
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

function state(overrides: Partial<GoalState> = {}): GoalState {
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

describe("AC-1: state machine returns the next Solo step for every Goal state", () => {
  it("AC-1: draft goal waits for human approve", () => {
    const step = nextStep(state({ status: "draft" }));
    expect(step.action).toBe("wait-human-approve");
    expect(step.humanGate).toBe(true);
    expect(step.reason.trim().length).toBeGreaterThan(0);
  });

  it("AC-1: approved goal waits for human select", () => {
    const step = nextStep(state({ status: "approved" }));
    expect(step.action).toBe("wait-human-select");
    expect(step.humanGate).toBe(true);
    expect(step.reason.trim().length).toBeGreaterThan(0);
  });

  it("AC-1: selected goal goes to lead-propose", () => {
    const step = nextStep(state({ status: "selected" }));
    expect(step.action).toBe("lead-propose");
    expect(step.humanGate).toBe(false);
    expect(step.reason.trim().length).toBeGreaterThan(0);
  });

  it("AC-1: testing goal goes to tests-submit (Lead decision: testing is the Tester writing tests)", () => {
    const step = nextStep(state({ status: "testing", hasSetup: true, testsLocked: false }));
    expect(step.action).toBe("tests-submit");
    expect(step.humanGate).toBe(false);
    expect(step.reason.trim().length).toBeGreaterThan(0);
  });

  it("AC-1: executing with setup and unlocked tests goes to tests-submit", () => {
    const step = nextStep(
      state({ status: "executing", hasSetup: true, testsLocked: false, packageStatus: "none" }),
    );
    expect(step.action).toBe("tests-submit");
    expect(step.humanGate).toBe(false);
  });

  it("AC-1: executing without setup and no package goes to worker-write-code", () => {
    const step = nextStep(
      state({ status: "executing", hasSetup: false, testsLocked: false, packageStatus: "none" }),
    );
    expect(step.action).toBe("worker-write-code");
    expect(step.humanGate).toBe(false);
  });

  it("AC-1: executing with locked tests and no package goes to worker-write-code", () => {
    const step = nextStep(
      state({ status: "executing", hasSetup: true, testsLocked: true, packageStatus: "none" }),
    );
    expect(step.action).toBe("worker-write-code");
    expect(step.humanGate).toBe(false);
  });

  it("AC-1: executing with pending package goes to package-submit", () => {
    const step = nextStep(state({ status: "executing", packageStatus: "pending" }));
    expect(step.action).toBe("package-submit");
    expect(step.humanGate).toBe(false);
  });

  it("AC-1: executing with green package waits for human close", () => {
    const step = nextStep(state({ status: "executing", packageStatus: "green" }));
    expect(step.action).toBe("wait-human-close");
    expect(step.humanGate).toBe(true);
  });

  it("AC-1: executing with needs-human package reports blocked for human", () => {
    const step = nextStep(state({ status: "executing", packageStatus: "needs-human" }));
    expect(step.action).toBe("report-human-blocked");
    expect(step.humanGate).toBe(true);
  });

  it("AC-1: verified goal waits for human close", () => {
    const step = nextStep(state({ status: "verified" }));
    expect(step.action).toBe("wait-human-close");
    expect(step.humanGate).toBe(true);
  });

  it("AC-1: blocked goal reports blocked for human", () => {
    const step = nextStep(state({ status: "blocked" }));
    expect(step.action).toBe("report-human-blocked");
    expect(step.humanGate).toBe(true);
  });

  it("AC-1: closed goal is done", () => {
    const step = nextStep(state({ status: "closed" }));
    expect(step.action).toBe("done");
    expect(step.humanGate).toBe(false);
  });

  it("AC-1: same state on different goals gives the same next step", () => {
    // AC-1 boundary: no hardcoding per goal. Same state, three goal ids.
    const cases: Array<Partial<GoalState>> = [
      { status: "draft" },
      { status: "selected" },
      { status: "executing", hasSetup: true, testsLocked: false, packageStatus: "none" },
      { status: "executing", packageStatus: "red", attemptsUsed: 1, attemptsMax: 3 },
      { status: "executing", packageStatus: "red", attemptsUsed: 3, attemptsMax: 3 },
      { status: "verified" },
    ];
    for (const c of cases) {
      const first = nextStep(state({ ...c, goalId: "GOAL-001" }));
      for (const goalId of ["GOAL-002", "GOAL-999"]) {
        const other = nextStep(state({ ...c, goalId }));
        expect(other.action).toBe(first.action);
        expect(other.humanGate).toBe(first.humanGate);
      }
    }
  });

  it("AC-1: next step is deterministic for the same state", () => {
    const input = state({ status: "executing", packageStatus: "red", attemptsUsed: 1 });
    expect(nextStep(input)).toEqual(nextStep(input));
  });

  it("AC-1: every step carries a non-empty reason", () => {
    const inputs: Array<Partial<GoalState>> = [
      { status: "draft" },
      { status: "approved" },
      { status: "selected" },
      { status: "executing", hasSetup: true, testsLocked: false, packageStatus: "none" },
      { status: "executing", hasSetup: false, packageStatus: "none" },
      { status: "executing", packageStatus: "pending" },
      { status: "executing", packageStatus: "red", attemptsUsed: 0 },
      { status: "executing", packageStatus: "red", attemptsUsed: 3 },
      { status: "executing", packageStatus: "needs-human" },
      { status: "executing", packageStatus: "green" },
      { status: "verified" },
      { status: "blocked" },
      { status: "closed" },
    ];
    for (const input of inputs) {
      expect(nextStep(state(input)).reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("AC-1: pending package beats the tests-submit branch", () => {
    // Overlap: setup pinned + tests unlocked would say tests-submit, but a
    // pending package means tests were already submitted.
    const step = nextStep(
      state({ status: "executing", hasSetup: true, testsLocked: false, packageStatus: "pending" }),
    );
    expect(step.action).toBe("package-submit");
  });

  it("AC-1: red package beats the tests-submit branch", () => {
    const step = nextStep(
      state({
        status: "executing",
        hasSetup: true,
        testsLocked: false,
        packageStatus: "red",
        attemptsUsed: 1,
        attemptsMax: 3,
      }),
    );
    expect(step.action).toBe("worker-fix");
  });

  it("AC-1: green package beats the tests-submit branch", () => {
    const step = nextStep(
      state({ status: "executing", hasSetup: true, testsLocked: false, packageStatus: "green" }),
    );
    expect(step.action).toBe("wait-human-close");
  });

  it("AC-3: each next step flags whether a human gate stops the loop", () => {
    // "integration-gate" / "integration-complete" are per-package
    // steps from `nextStepForPackage` (GOAL-004), not `nextStep`
    // results — excluded here like "lead-commit" below.
    type SoloAction = Exclude<StepAction, "lead-commit" | "integration-gate" | "integration-complete">;
    const inputs: Record<SoloAction, Partial<GoalState>> = {
      "wait-human-approve": { status: "draft" },
      "wait-human-select": { status: "approved" },
      "lead-propose": { status: "selected" },
      "tests-submit": {
        status: "executing",
        hasSetup: true,
        testsLocked: false,
        packageStatus: "none",
      },
      "worker-write-code": { status: "executing", hasSetup: false, packageStatus: "none" },
      "package-submit": { status: "executing", packageStatus: "pending" },
      "worker-fix": { status: "executing", packageStatus: "red", attemptsUsed: 0 },
      "wait-human-close": { status: "verified" },
      "report-human-blocked": { status: "blocked" },
      done: { status: "closed" },
    };
    // "lead-commit" is a dry-run phase step, not a nextStep result.
    const expectedWithoutLeadCommit: Record<SoloAction, boolean> = {
      "wait-human-approve": true,
      "wait-human-select": true,
      "lead-propose": false,
      "tests-submit": false,
      "worker-write-code": false,
      "package-submit": false,
      "worker-fix": false,
      "wait-human-close": true,
      "report-human-blocked": true,
      done: false,
    };
    for (const [action, input] of Object.entries(inputs) as Array<
      [SoloAction, Partial<GoalState>]
    >) {
      const step = nextStep(state(input));
      expect(step.action).toBe(action);
      expect(step.humanGate).toBe(expectedWithoutLeadCommit[action]);
    }
  });
});

describe("AC-4: red gate returns to worker-fix, exhausted attempts stop for human", () => {
  it("AC-4: red package with attempts left goes to worker-fix", () => {
    const step = nextStep(
      state({ status: "executing", packageStatus: "red", attemptsUsed: 1, attemptsMax: 3 }),
    );
    expect(step.action).toBe("worker-fix");
    expect(step.humanGate).toBe(false);
  });

  it("AC-4: red package with attempts exhausted reports blocked for human", () => {
    const step = nextStep(
      state({ status: "executing", packageStatus: "red", attemptsUsed: 3, attemptsMax: 3 }),
    );
    expect(step.action).toBe("report-human-blocked");
    expect(step.humanGate).toBe(true);
  });

  it("AC-4: red package exactly at the attempt limit stops for human", () => {
    const step = nextStep(
      state({ status: "executing", packageStatus: "red", attemptsUsed: 2, attemptsMax: 2 }),
    );
    expect(step.action).toBe("report-human-blocked");
    expect(step.humanGate).toBe(true);
  });

  it("AC-4: red package over the attempt limit stops for human", () => {
    const step = nextStep(
      state({ status: "executing", packageStatus: "red", attemptsUsed: 4, attemptsMax: 3 }),
    );
    expect(step.action).toBe("report-human-blocked");
    expect(step.humanGate).toBe(true);
  });

  it("AC-4: red package one attempt below the limit still retries", () => {
    const step = nextStep(
      state({ status: "executing", packageStatus: "red", attemptsUsed: 2, attemptsMax: 3 }),
    );
    expect(step.action).toBe("worker-fix");
    expect(step.humanGate).toBe(false);
  });
});

describe("AC-3: loop never runs a human-gated command", () => {
  it.each(R4_HUMAN_GATED_COMMANDS)("AC-3: %s is human-gated", (command) => {
    expect(isHumanGated(command)).toBe(true);
  });

  it.each([
    "goal list",
    "goal show",
    "inbox",
    "package submit",
    "tests submit",
    "lead propose",
    "lead commit",
    "metrics show",
    "plan",
    // Only the flagged variants are gated, not the bare commands.
    "gate run",
    "exception approve",
  ])("AC-3: %s is not human-gated", (command) => {
    expect(isHumanGated(command)).toBe(false);
  });

  it("AC-3: HUMAN_GATED_COMMANDS lists exactly the R-4 commands", () => {
    expect([...HUMAN_GATED_COMMANDS].sort()).toEqual([...R4_HUMAN_GATED_COMMANDS].sort());
  });
});
