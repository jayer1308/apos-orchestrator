// State machine for the APOS Solo flow: from a Goal's state, the next step.
//
// Pure function: `nextStep` never reads files and never runs a command.
// A step with `humanGate: true` stops the loop; the loop reports to the
// human instead of running the human-only command itself (R-4).

export type GoalStatus =
  | "draft"
  | "approved"
  | "selected"
  | "executing"
  | "testing"
  | "verified"
  | "blocked"
  | "closed";

export type PackageStatus = "none" | "pending" | "red" | "green" | "needs-human";

export interface GoalState {
  goalId: string;
  status: GoalStatus;
  hasSetup: boolean;
  testsLocked: boolean;
  attemptsUsed: number;
  attemptsMax: number;
  packageStatus: PackageStatus;
}

export type StepAction =
  | "wait-human-approve"
  | "wait-human-select"
  | "lead-propose"
  | "lead-commit"
  | "tests-submit"
  | "worker-write-code"
  | "package-submit"
  | "worker-fix"
  | "wait-human-close"
  | "report-human-blocked"
  | "done";

export interface Step {
  action: StepAction;
  reason: string;
  humanGate: boolean;
}

/**
 * Commands only a human may run (R-4), in the Goal's order. The loop must
 * never run these; when a step needs one, the loop stops and reports.
 */
export const HUMAN_GATED_COMMANDS: readonly string[] = [
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
];

function step(action: StepAction, reason: string, humanGate: boolean): Step {
  return { action, reason, humanGate };
}

/**
 * Pure function: the next Solo step for a Goal state. Never reads files.
 *
 * Precedence: a non-"none" package status decides before the tests/worker
 * branches — a pending/red/green package means tests were already
 * submitted, so the tests branch no longer applies.
 */
export function nextStep(state: GoalState): Step {
  switch (state.status) {
    case "draft":
      return step(
        "wait-human-approve",
        "Goal is still a draft; only a human can approve it, so the loop stops and reports.",
        true,
      );
    case "approved":
      return step(
        "wait-human-select",
        "Goal is approved but not selected; only a human can select it, so the loop stops and reports.",
        true,
      );
    case "selected":
      return step(
        "lead-propose",
        "Goal is selected; the Lead proposes the execution plan.",
        false,
      );
    case "testing":
      // Decision (recorded for GOAL-001): "testing" is the phase where the
      // Tester is writing the acceptance tests, met only by a goal with a
      // pinned setup, and it maps to submitting those tests.
      return step(
        "tests-submit",
        "Goal is in testing; the Tester submits the acceptance tests.",
        false,
      );
    case "verified":
      return step(
        "wait-human-close",
        "Goal is verified; only a human can close it, so the loop stops and reports.",
        true,
      );
    case "blocked":
      return step(
        "report-human-blocked",
        "Goal is blocked; the loop stops and reports to the human.",
        true,
      );
    case "closed":
      return step("done", "Goal is closed; there is nothing left to do.", false);
    case "executing":
      break;
  }

  // Executing: a submitted package decides first.
  switch (state.packageStatus) {
    case "pending":
      return step(
        "package-submit",
        "A package is pending; the Lead submits it for the gate check.",
        false,
      );
    case "red":
      if (state.attemptsUsed < state.attemptsMax) {
        return step(
          "worker-fix",
          "The gate went red with attempts left; the Worker fixes the code and submits a new commit.",
          false,
        );
      }
      return step(
        "report-human-blocked",
        "The gate went red and the attempt limit is reached; the loop stops and reports to the human.",
        true,
      );
    case "green":
      return step(
        "wait-human-close",
        "The package is green; only a human can close the Goal, so the loop stops and reports.",
        true,
      );
    case "needs-human":
      return step(
        "report-human-blocked",
        "The package needs a human decision; the loop stops and reports to the human.",
        true,
      );
    case "none":
      break;
  }

  // Executing, no package submitted yet: tests first when a setup is
  // pinned and the tests are not locked, otherwise the Worker writes code.
  if (state.hasSetup && !state.testsLocked) {
    return step(
      "tests-submit",
      "Setup is pinned and tests are unlocked; the Tester submits the acceptance tests.",
      false,
    );
  }
  return step(
    "worker-write-code",
    "No package submitted yet; the Worker writes the code.",
    false,
  );
}

/**
 * True when `command` is a human-only APOS command (see
 * HUMAN_GATED_COMMANDS). Matches the command name with its arguments, so
 * "goal approve GOAL-001" counts but the bare "gate run" (without --base)
 * and "exception approve" (without --human) do not. A leading "apos "
 * prefix is ignored.
 */
export function isHumanGated(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  const withoutPrefix = normalized.startsWith("apos ")
    ? normalized.slice("apos ".length)
    : normalized;
  return HUMAN_GATED_COMMANDS.some(
    (gated) => withoutPrefix === gated || withoutPrefix.startsWith(`${gated} `),
  );
}
