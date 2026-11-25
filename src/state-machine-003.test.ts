// Acceptance tests for GOAL-003 AC-3 (red path) — through the public
// entry `nextStep` of src/state-machine.ts only.
//
// GOAL-003 changes the red branch (execution-003.json §2): executing +
// package red + attempts left + a NEW handover already verified
// (codeReady true, commit never submitted / never red) now returns
// `package-submit` with that commit instead of `worker-fix`. Red with
// no (or unverified) new handover still returns `worker-fix`, and a
// commit that already went red is never submitted again. The old
// GOAL-002 test that pinned "red + NEW handover -> worker-fix" is
// updated in src/state-machine-002.test.ts — the approved GOAL-003
// criterion AC-3 wins over it.
import { describe, expect, it } from "vitest";
import { nextStep, type GoalState, type Step } from "./state-machine.js";

const HANDOVER = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const NEW_HANDOVER = "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1";
const RED_COMMIT = "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2";

function state(overrides: Partial<GoalState> = {}): GoalState {
  return {
    goalId: "GOAL-003",
    status: "executing",
    hasSetup: false,
    testsLocked: false,
    attemptsUsed: 1,
    attemptsMax: 3,
    packageStatus: "red",
    codeReady: false,
    handoverCommit: null,
    submittedCommits: [],
    redCommits: [],
    ...overrides,
  };
}

function stepHandover(step: Step): string | undefined {
  return step.handoverCommit;
}

describe("AC-3 (GOAL-003): red gate + new verified handover goes to package-submit", () => {
  it("AC-3: red + attempts left + new verified handover returns package-submit with the new commit, not worker-fix", () => {
    const step = nextStep(
      state({
        packageStatus: "red",
        attemptsUsed: 1,
        attemptsMax: 3,
        codeReady: true,
        handoverCommit: NEW_HANDOVER,
        submittedCommits: [HANDOVER],
        redCommits: [HANDOVER],
      }),
    );
    expect(step.action).toBe("package-submit");
    expect(step.humanGate).toBe(false);
    expect(stepHandover(step)).toBe(NEW_HANDOVER);
  });

  it("AC-3: red + attempts left + new handover NOT verified returns worker-fix", () => {
    const step = nextStep(
      state({
        packageStatus: "red",
        attemptsUsed: 1,
        attemptsMax: 3,
        codeReady: false,
        handoverCommit: NEW_HANDOVER,
        redCommits: [HANDOVER],
      }),
    );
    expect(step.action).toBe("worker-fix");
    expect(stepHandover(step)).toBeUndefined();
  });

  it("AC-3: red + attempts left + no handover at all returns worker-fix", () => {
    const step = nextStep(
      state({ packageStatus: "red", attemptsUsed: 1, attemptsMax: 3, handoverCommit: null }),
    );
    expect(step.action).toBe("worker-fix");
    expect(stepHandover(step)).toBeUndefined();
  });

  it("AC-3: red + new handover that already went red returns worker-fix, never package-submit with it", () => {
    const step = nextStep(
      state({
        packageStatus: "red",
        attemptsUsed: 1,
        attemptsMax: 3,
        codeReady: true,
        handoverCommit: RED_COMMIT,
        redCommits: [RED_COMMIT],
      }),
    );
    expect(step.action).toBe("worker-fix");
    expect(stepHandover(step)).not.toBe(RED_COMMIT);
    expect(stepHandover(step)).toBeUndefined();
  });

  it("AC-3: red + new handover that was already submitted returns worker-fix, never package-submit with it", () => {
    const step = nextStep(
      state({
        packageStatus: "red",
        attemptsUsed: 1,
        attemptsMax: 3,
        codeReady: true,
        handoverCommit: HANDOVER,
        submittedCommits: [HANDOVER],
        redCommits: [RED_COMMIT],
      }),
    );
    expect(step.action).toBe("worker-fix");
    expect(stepHandover(step)).toBeUndefined();
  });

  it("AC-3: red + attempts exhausted + new verified handover still stops for human, never package-submit", () => {
    const step = nextStep(
      state({
        packageStatus: "red",
        attemptsUsed: 3,
        attemptsMax: 3,
        codeReady: true,
        handoverCommit: NEW_HANDOVER,
        redCommits: [HANDOVER],
      }),
    );
    expect(step.action).toBe("report-human-blocked");
    expect(step.humanGate).toBe(true);
    expect(stepHandover(step)).toBeUndefined();
  });

  it("AC-3: red + new verified handover on the last attempt returns package-submit with it", () => {
    const step = nextStep(
      state({
        packageStatus: "red",
        attemptsUsed: 2,
        attemptsMax: 3,
        codeReady: true,
        handoverCommit: NEW_HANDOVER,
        redCommits: [HANDOVER],
      }),
    );
    expect(step.action).toBe("package-submit");
    expect(stepHandover(step)).toBe(NEW_HANDOVER);
  });

  it("AC-3: the red branch does not change the green/pending precedence", () => {
    const green = nextStep(
      state({
        packageStatus: "green",
        codeReady: true,
        handoverCommit: NEW_HANDOVER,
      }),
    );
    expect(green.action).toBe("wait-human-close");
    expect(green.humanGate).toBe(true);
    const pending = nextStep(
      state({
        packageStatus: "pending",
        attemptsUsed: 1,
        codeReady: true,
        handoverCommit: NEW_HANDOVER,
        submittedCommits: [NEW_HANDOVER],
      }),
    );
    expect(pending.action).toBe("package-submit");
    expect(stepHandover(pending)).toBeUndefined();
  });
});
