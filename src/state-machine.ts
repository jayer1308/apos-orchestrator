// State machine for the APOS Solo flow: from a Goal's state, the next step.
//
// STUB — every function throws until the Worker implements it.

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
 * Commands only a human may run (R-4). Empty until implemented: the Worker
 * fills in exactly the fourteen commands from the Goal.
 */
export const HUMAN_GATED_COMMANDS: readonly string[] = [];

/** Pure function: the next Solo step for a Goal state. Never reads files. */
export function nextStep(_state: GoalState): Step {
  void _state;
  throw new Error("not implemented");
}

/** True when `command` is a human-only APOS command (see HUMAN_GATED_COMMANDS). */
export function isHumanGated(_command: string): boolean {
  void _command;
  throw new Error("not implemented");
}
