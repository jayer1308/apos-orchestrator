// Acceptance tests for GOAL-004 AC-1 / AC-2 (state machine per
// package + integration gate) and AC-5 (Solo behaviour stays green) —
// through the public entries `nextStepForPackage` and `nextStep` of
// src/state-machine.ts only.
//
// Tester-defined contract (execution-004.json fixes the behaviour but
// not every signature; the Worker implements these exact signatures):
// - `nextStepForPackage(state, packageId)` applies the `nextStep`
//   rules scoped to that package: its own pending / red / green /
//   none status, its own code-ready handover, its own red +
//   new-handover path. The returned step carries `packageId`, and a
//   package-submit step carries that package's handover commit —
//   never another package's commit, never a commit that already went
//   red for any package.
// - When every package is green it returns `integration-gate`
//   (humanGate false — the driver runs `apos integration gate
//   <goalId> --commit <sha> --reason <text>`); once the integration
//   gate went green (`integrationStatus: "gate-green"`) it returns
//   `integration-complete`. With one package green and one not, there
//   is no integration step: the next step still belongs to the
//   unfinished package.
// - Solo (no `packages` map on the state) answers exactly like the
//   old `nextStep` for the same state.
//
// `nextStepForPackage` is still the WP-CORE stub (throws
// "not implemented"), so the AC-1 / AC-2 tests below are red for the
// right reason until the Worker implements it. The AC-5 tests call
// the existing `nextStep` and stay green.
import { describe, expect, it } from "vitest";
import {
  nextStep,
  nextStepForPackage,
  type GoalState,
  type PackageState,
  type Step,
} from "./state-machine.js";

const SHA_A = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const SHA_B = "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1";
const SHA_A2 = "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2";
const SHA_B2 = "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3";

function pkg(overrides: Partial<PackageState> = {}): PackageState {
  return { status: "none", ...overrides };
}

function state(overrides: Partial<GoalState> = {}): GoalState {
  return {
    goalId: "GOAL-004",
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
  };
}

/** Two packages: WP-A code-ready, WP-B red — the AC-1 example. */
function twoPackageState(): GoalState {
  return state({
    packages: {
      "WP-A": pkg({ status: "none", codeReady: true, handoverCommit: SHA_A }),
      "WP-B": pkg({ status: "red", redCommits: [SHA_B] }),
    },
    attemptsUsed: 1,
  });
}

describe("AC-1 (GOAL-004): nextStepForPackage answers per package, without mixing states", () => {
  it("AC-1: WP-A code-ready returns package-submit with WP-A's commit, for WP-A", () => {
    const step = nextStepForPackage(twoPackageState(), "WP-A");
    expect(step.action).toBe("package-submit");
    expect(step.humanGate).toBe(false);
    expect(step.packageId).toBe("WP-A");
    expect(step.handoverCommit).toBe(SHA_A);
  });

  it("AC-1: WP-B red with attempts left and no new handover returns worker-fix, for WP-B", () => {
    const step = nextStepForPackage(twoPackageState(), "WP-B");
    expect(step.action).toBe("worker-fix");
    expect(step.humanGate).toBe(false);
    expect(step.packageId).toBe("WP-B");
    expect(step.handoverCommit).toBeUndefined();
  });

  it("AC-1: WP-B red + a NEW verified handover returns package-submit with the new commit, for WP-B", () => {
    const step = nextStepForPackage(
      state({
        packages: {
          "WP-A": pkg({ status: "none", codeReady: true, handoverCommit: SHA_A }),
          "WP-B": pkg({
            status: "red",
            codeReady: true,
            handoverCommit: SHA_B2,
            submittedCommits: [SHA_B],
            redCommits: [SHA_B],
          }),
        },
        attemptsUsed: 1,
      }),
      "WP-B",
    );
    expect(step.action).toBe("package-submit");
    expect(step.packageId).toBe("WP-B");
    expect(step.handoverCommit).toBe(SHA_B2);
  });

  it("AC-1: asking for WP-A never returns WP-B's red commit, and asking for WP-B never returns WP-A's handover", () => {
    const s = twoPackageState();
    const forA = nextStepForPackage(s, "WP-A");
    expect(forA.handoverCommit).not.toBe(SHA_B);
    const forB = nextStepForPackage(s, "WP-B");
    expect(forB.handoverCommit).not.toBe(SHA_A);
    expect(forB.handoverCommit).toBeUndefined();
  });

  it("AC-1: a handover that already went red is never submitted again for its package", () => {
    const step = nextStepForPackage(
      state({
        packages: {
          "WP-A": pkg({
            status: "none",
            codeReady: true,
            handoverCommit: SHA_A,
            redCommits: [SHA_A],
          }),
          "WP-B": pkg({ status: "none" }),
        },
      }),
      "WP-A",
    );
    expect(step.action).toBe("worker-write-code");
    expect(step.handoverCommit).toBeUndefined();
    expect(step.handoverCommit).not.toBe(SHA_A);
  });

  it("AC-1: a handover that went red for WP-A is never submitted for WP-B either", () => {
    const step = nextStepForPackage(
      state({
        packages: {
          "WP-A": pkg({ status: "red", redCommits: [SHA_A] }),
          "WP-B": pkg({
            status: "none",
            codeReady: true,
            handoverCommit: SHA_A,
          }),
        },
        attemptsUsed: 1,
      }),
      "WP-B",
    );
    expect(step.action).toBe("worker-write-code");
    expect(step.handoverCommit).toBeUndefined();
  });

  it("AC-1: WP-A pending returns package-submit for WP-A, without a handover commit", () => {
    const step = nextStepForPackage(
      state({
        packages: {
          "WP-A": pkg({ status: "pending", submittedCommits: [SHA_A] }),
          "WP-B": pkg({ status: "none" }),
        },
        attemptsUsed: 1,
      }),
      "WP-A",
    );
    expect(step.action).toBe("package-submit");
    expect(step.packageId).toBe("WP-A");
    expect(step.handoverCommit).toBeUndefined();
  });

  it("AC-1: WP-A needs-human returns report-human-blocked with a human gate, for WP-A", () => {
    const step = nextStepForPackage(
      state({
        packages: {
          "WP-A": pkg({ status: "needs-human" }),
          "WP-B": pkg({ status: "none" }),
        },
      }),
      "WP-A",
    );
    expect(step.action).toBe("report-human-blocked");
    expect(step.humanGate).toBe(true);
    expect(step.packageId).toBe("WP-A");
  });

  it("AC-1: Solo (no packages map) answers exactly like nextStep — code-ready goes to package-submit", () => {
    const solo = state({
      packageStatus: "none",
      codeReady: true,
      handoverCommit: SHA_A,
    });
    const expected: Step = nextStep(solo);
    expect(expected.action).toBe("package-submit");
    expect(nextStepForPackage(solo, "WP-MAIN")).toEqual(expected);
  });

  it("AC-1: Solo (no packages map) answers exactly like nextStep — red with no handover goes to worker-fix", () => {
    const solo = state({
      packageStatus: "red",
      attemptsUsed: 1,
      attemptsMax: 3,
      handoverCommit: null,
    });
    const expected: Step = nextStep(solo);
    expect(expected.action).toBe("worker-fix");
    expect(nextStepForPackage(solo, "WP-MAIN")).toEqual(expected);
  });

  it("AC-1: Solo (one package in the map) answers exactly like nextStep", () => {
    const solo = state({
      packageStatus: "none",
      codeReady: true,
      handoverCommit: SHA_A,
      packages: { "WP-MAIN": pkg({ status: "none", codeReady: true, handoverCommit: SHA_A }) },
    });
    const expected: Step = nextStep(solo);
    expect(expected.action).toBe("package-submit");
    expect(nextStepForPackage(solo, "WP-MAIN")).toEqual(expected);
  });
});

describe("AC-2 (GOAL-004): integration gate runs only when every package is green", () => {
  function allGreenState(overrides: Partial<GoalState> = {}): GoalState {
    return state({
      packages: {
        "WP-A": pkg({ status: "green", submittedCommits: [SHA_A] }),
        "WP-B": pkg({ status: "green", submittedCommits: [SHA_B] }),
      },
      attemptsUsed: 2,
      ...overrides,
    });
  }

  it("AC-2: executing + every package green returns integration-gate, for either package", () => {
    for (const packageId of ["WP-A", "WP-B"]) {
      const step = nextStepForPackage(allGreenState(), packageId);
      expect(step.action).toBe("integration-gate");
      expect(step.humanGate).toBe(false);
      expect(step.handoverCommit).toBeUndefined();
    }
  });

  it("AC-2: after the integration gate went green returns integration-complete", () => {
    const step = nextStepForPackage(allGreenState({ integrationStatus: "gate-green" }), "WP-A");
    expect(step.action).toBe("integration-complete");
    expect(step.humanGate).toBe(false);
    expect(step.handoverCommit).toBeUndefined();
  });

  it("AC-2: one package green + one not green is NOT integration-gate — the next step still belongs to the unfinished package", () => {
    const s = state({
      packages: {
        "WP-A": pkg({ status: "green", submittedCommits: [SHA_A] }),
        "WP-B": pkg({ status: "none" }),
      },
      attemptsUsed: 1,
    });
    const forB = nextStepForPackage(s, "WP-B");
    expect(forB.action).toBe("worker-write-code");
    expect(forB.packageId).toBe("WP-B");
    expect(forB.action).not.toBe("integration-gate");
    const forA = nextStepForPackage(s, "WP-A");
    expect(forA.action).not.toBe("integration-gate");
    expect(forA.action).not.toBe("wait-human-close");
  });

  it("AC-2: all green but the Goal is verified already stays wait-human-close (status wins over packages)", () => {
    const step = nextStepForPackage(allGreenState({ status: "verified" }), "WP-A");
    expect(step.action).toBe("wait-human-close");
    expect(step.humanGate).toBe(true);
  });
});

describe("AC-5 (GOAL-004): Solo nextStep behaviour stays green", () => {
  it("AC-5: Solo executing + no package + verified handover returns package-submit with that commit (GOAL-002)", () => {
    const step = nextStep(
      state({ packageStatus: "none", codeReady: true, handoverCommit: SHA_A }),
    );
    expect(step.action).toBe("package-submit");
    expect(step.handoverCommit).toBe(SHA_A);
    expect(step.humanGate).toBe(false);
  });

  it("AC-5: Solo red + attempts left + new verified handover returns package-submit with the new commit (GOAL-003)", () => {
    const step = nextStep(
      state({
        packageStatus: "red",
        attemptsUsed: 1,
        attemptsMax: 3,
        codeReady: true,
        handoverCommit: SHA_A2,
        submittedCommits: [SHA_A],
        redCommits: [SHA_A],
      }),
    );
    expect(step.action).toBe("package-submit");
    expect(step.handoverCommit).toBe(SHA_A2);
  });

  it("AC-5: Solo red + attempts left + no handover returns worker-fix", () => {
    const step = nextStep(
      state({ packageStatus: "red", attemptsUsed: 1, attemptsMax: 3, handoverCommit: null }),
    );
    expect(step.action).toBe("worker-fix");
  });

  it("AC-5: Solo green returns wait-human-close with a human gate", () => {
    const step = nextStep(state({ packageStatus: "green" }));
    expect(step.action).toBe("wait-human-close");
    expect(step.humanGate).toBe(true);
  });

  it("AC-5: Solo draft returns wait-human-approve with a human gate", () => {
    const step = nextStep(state({ status: "draft" }));
    expect(step.action).toBe("wait-human-approve");
    expect(step.humanGate).toBe(true);
  });
});
