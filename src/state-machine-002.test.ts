// Acceptance tests for GOAL-002 AC-1 (code-ready signal) — through the
// public entry `nextStep` of src/state-machine.ts only.
//
// Tester-defined contract (the Lead's execution-002.json fixes the design
// but not the field names; the Worker implements these exact names):
// - `GoalState` gains `codeReady: boolean` and `handoverCommit: string |
//   null`. `codeReady` means the loop has ALREADY verified the handover
//   (commit exists, is a descendant of baseCommit, is not baseCommit
//   itself, was never submitted); the pure machine trusts that flag and
//   never runs git itself.
// - `GoalState` also gains `submittedCommits: readonly string[]` and
//   `redCommits: readonly string[]` (loop-level record): the machine must
//   never return package-submit for a commit in either set.
// - A package-submit step for a handover carries it as
//   `step.handoverCommit`; once the handover is consumed the step no
//   longer carries it.
// - An unverified handover (handoverCommit set, codeReady false) is
//   treated as "no code": worker-write-code, and the step's reason names
//   the handover commit (the warning channel of the pure machine).
// New fields are passed through casts so these tests compile against the
// current code and fail on assertions (red for the right reason), not on
// load or type errors.
import { describe, expect, it } from "vitest";
import { nextStep, type GoalState, type Step } from "./state-machine.js";

const BASE_COMMIT = "c4c5b0ca6799773e85a155925a561079a6648aee";
const HANDOVER = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const OTHER_HANDOVER = "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1";
const RED_COMMIT = "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2";

type GoalState002 = GoalState & {
  codeReady: boolean;
  handoverCommit: string | null;
  submittedCommits: readonly string[];
  redCommits: readonly string[];
};

function state(overrides: Partial<GoalState002> = {}): GoalState {
  return {
    goalId: "GOAL-002",
    status: "executing",
    hasSetup: false,
    testsLocked: false,
    attemptsUsed: 0,
    attemptsMax: 3,
    packageStatus: "none",
    codeReady: false,
    handoverCommit: null,
    submittedCommits: [],
    redCommits: [],
    ...overrides,
  } as unknown as GoalState;
}

/** The handover commit a step carries, if any (new Step field). */
function stepHandover(step: Step): string | undefined {
  return (step as unknown as { handoverCommit?: string }).handoverCommit;
}

describe("AC-1 (GOAL-002): code-ready handover goes to package-submit", () => {
  it("AC-1: executing + no package + verified code-ready returns package-submit with the handover commit", () => {
    const step = nextStep(
      state({ status: "executing", packageStatus: "none", codeReady: true, handoverCommit: HANDOVER }),
    );
    expect(step.action).toBe("package-submit");
    expect(step.humanGate).toBe(false);
    expect(stepHandover(step)).toBe(HANDOVER);
    expect(step.reason.trim().length).toBeGreaterThan(0);
  });

  it("AC-1: executing + no package + no handover returns worker-write-code", () => {
    const step = nextStep(
      state({ status: "executing", packageStatus: "none", codeReady: false, handoverCommit: null }),
    );
    expect(step.action).toBe("worker-write-code");
    expect(step.humanGate).toBe(false);
    expect(stepHandover(step)).toBeUndefined();
  });

  it("AC-1: handover set but not verified (codeReady false) returns worker-write-code with a warning naming the commit", () => {
    // Covers every unverified case at the machine level: the loop only
    // sets codeReady after git verification (exists, descendant of
    // baseCommit, not baseCommit, never submitted), so an unverified
    // handover arrives here as codeReady false.
    const step = nextStep(
      state({ status: "executing", packageStatus: "none", codeReady: false, handoverCommit: HANDOVER }),
    );
    expect(step.action).toBe("worker-write-code");
    expect(stepHandover(step)).toBeUndefined();
    expect(step.reason).toContain(HANDOVER);
  });

  it("AC-1: codeReady true but handoverCommit null returns worker-write-code (nothing to submit)", () => {
    const step = nextStep(
      state({ status: "executing", packageStatus: "none", codeReady: true, handoverCommit: null }),
    );
    expect(step.action).toBe("worker-write-code");
    expect(stepHandover(step)).toBeUndefined();
  });

  it("AC-1: code-ready beats the tests-submit branch (code exists, so tests were already submitted)", () => {
    const step = nextStep(
      state({
        status: "executing",
        hasSetup: true,
        testsLocked: false,
        packageStatus: "none",
        codeReady: true,
        handoverCommit: HANDOVER,
      }),
    );
    expect(step.action).toBe("package-submit");
    expect(stepHandover(step)).toBe(HANDOVER);
  });

  it("AC-1: same code-ready state on different goals gives the same next step", () => {
    const first = nextStep(
      state({ goalId: "GOAL-002", codeReady: true, handoverCommit: HANDOVER }),
    );
    for (const goalId of ["GOAL-003", "GOAL-999"]) {
      const other = nextStep(state({ goalId, codeReady: true, handoverCommit: HANDOVER }));
      expect(other.action).toBe(first.action);
      expect(stepHandover(other)).toBe(HANDOVER);
    }
  });
});

describe("AC-1 (GOAL-002): a handover is never submitted twice or after going red", () => {
  it("AC-1: handover already submitted returns worker-write-code, never package-submit with it", () => {
    const step = nextStep(
      state({
        status: "executing",
        packageStatus: "none",
        codeReady: true,
        handoverCommit: HANDOVER,
        submittedCommits: [HANDOVER],
      }),
    );
    expect(step.action).toBe("worker-write-code");
    expect(stepHandover(step)).toBeUndefined();
  });

  it("AC-1: handover that went red is never submitted again", () => {
    const step = nextStep(
      state({
        status: "executing",
        packageStatus: "none",
        codeReady: true,
        handoverCommit: RED_COMMIT,
        redCommits: [RED_COMMIT],
      }),
    );
    expect(step.action).toBe("worker-write-code");
    expect(stepHandover(step)).toBeUndefined();
  });

  it("AC-1: red package with a red handover goes to worker-fix, not package-submit with the red commit", () => {
    const step = nextStep(
      state({
        status: "executing",
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
  });

  it("AC-1: red package with a NEW handover still goes to worker-fix (fix first, submit the new commit after)", () => {
    const step = nextStep(
      state({
        status: "executing",
        packageStatus: "red",
        attemptsUsed: 1,
        attemptsMax: 3,
        codeReady: true,
        handoverCommit: OTHER_HANDOVER,
        redCommits: [RED_COMMIT],
      }),
    );
    expect(step.action).toBe("worker-fix");
    expect(stepHandover(step)).not.toBe(RED_COMMIT);
  });

  it("AC-1: handover is consumed after submit — pending package no longer carries it", () => {
    // After package-submit runs, the loop records the commit as
    // submitted, so the next read shows packageStatus pending and the
    // machine no longer consults codeReady for that commit.
    const step = nextStep(
      state({
        status: "executing",
        packageStatus: "pending",
        attemptsUsed: 1,
        codeReady: true,
        handoverCommit: HANDOVER,
        submittedCommits: [HANDOVER],
      }),
    );
    expect(step.action).toBe("package-submit");
    expect(stepHandover(step)).toBeUndefined();
  });

  it("AC-1: baseCommit itself is never a handover (it is the plan commit, not worker code)", () => {
    const step = nextStep(
      state({
        status: "executing",
        packageStatus: "none",
        codeReady: false,
        handoverCommit: BASE_COMMIT,
      }),
    );
    expect(step.action).toBe("worker-write-code");
    expect(stepHandover(step)).toBeUndefined();
  });
});

describe("AC-1 (GOAL-002): code-ready does not change non-none package precedence", () => {
  it("AC-1: green package with a stale code-ready still waits for human close", () => {
    const step = nextStep(
      state({
        status: "executing",
        packageStatus: "green",
        codeReady: true,
        handoverCommit: HANDOVER,
      }),
    );
    expect(step.action).toBe("wait-human-close");
    expect(step.humanGate).toBe(true);
  });

  it("AC-1: needs-human package with a stale code-ready still reports blocked", () => {
    const step = nextStep(
      state({
        status: "executing",
        packageStatus: "needs-human",
        codeReady: true,
        handoverCommit: HANDOVER,
      }),
    );
    expect(step.action).toBe("report-human-blocked");
    expect(step.humanGate).toBe(true);
  });
});
