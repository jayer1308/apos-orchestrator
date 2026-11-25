// Agent loop (dry run): walks scripted sample states through the state
// machine and returns the Solo step sequence, without running any APOS
// command and without touching any real project.
//
// The walk uses the real `nextStep` for every step, so the printed
// sequence is the state machine's answer, not a hardcoded string. The one
// exception is "lead-commit": the Lead phase of a selected Goal yields two
// consecutive actions, lead-propose then lead-commit, and `nextStep` for a
// selected Goal is the entry to that phase, so the walk emits the
// lead-commit step right after lead-propose. Every scenario stops at the
// first human gate (`humanGate: true`); the loop never attempts a
// human-gated command.

import { nextStep, type GoalState, type Step } from "./state-machine.js";

export type DryRunScenarioName = "with-setup" | "without-setup" | "red-gate";

export interface DryRunScenarioResult {
  name: DryRunScenarioName;
  steps: Step[];
  /** True only if the run attempted a human-gated command (never: it stops at human gates). */
  humanGatedAttempted: boolean;
}

export interface DryRunResult {
  scenarios: DryRunScenarioResult[];
  /** True only if any scenario attempted a human-gated command. */
  humanGatedAttempted: boolean;
}

function sampleState(overrides: Partial<GoalState>): GoalState {
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

/** The lead-commit step that follows lead-propose in the Lead phase. */
function leadCommitStep(): Step {
  return {
    action: "lead-commit",
    reason: "The Lead commits the proposed execution plan.",
    humanGate: false,
  };
}

/**
 * Walk a scripted sequence of Goal states through the real state machine.
 * After a lead-propose step, emit the lead-commit step of the same Lead
 * phase. Stop at the first human gate. Never attempts a human-gated
 * command, so `humanGatedAttempted` is always false.
 */
function walkScenario(name: DryRunScenarioName, states: GoalState[]): DryRunScenarioResult {
  const steps: Step[] = [];
  for (const state of states) {
    const step = nextStep(state);
    steps.push(step);
    if (step.action === "lead-propose") {
      steps.push(leadCommitStep());
    }
    if (step.humanGate) {
      break;
    }
  }
  return { name, steps, humanGatedAttempted: false };
}

/**
 * Run the dry run over the three scripted scenarios:
 * - "with-setup": a sample project whose Goal is approved and selected and
 *   has a pinned setup.
 * - "without-setup": the same, with no setup pinned (this Goal's case).
 * - "red-gate": a red gate with attempts left, then a red gate with
 *   attempts exhausted.
 * Creates no commit, runs no human-gated command and edits no real files.
 */
export function runDryRun(): DryRunResult {
  const scenarios: DryRunScenarioResult[] = [
    walkScenario("with-setup", [
      sampleState({ status: "selected", hasSetup: true }),
      sampleState({ status: "executing", hasSetup: true, packageStatus: "none" }),
      sampleState({ status: "executing", hasSetup: true, packageStatus: "pending" }),
      sampleState({ status: "executing", hasSetup: true, packageStatus: "green" }),
    ]),
    walkScenario("without-setup", [
      sampleState({ status: "selected", hasSetup: false }),
      sampleState({ status: "executing", hasSetup: false, packageStatus: "none" }),
      sampleState({ status: "executing", hasSetup: false, packageStatus: "pending" }),
      sampleState({ status: "executing", hasSetup: false, packageStatus: "green" }),
    ]),
    walkScenario("red-gate", [
      sampleState({ status: "selected", hasSetup: false }),
      sampleState({ status: "executing", hasSetup: false, packageStatus: "none" }),
      sampleState({
        status: "executing",
        hasSetup: false,
        packageStatus: "pending",
        attemptsUsed: 1,
      }),
      sampleState({
        status: "executing",
        hasSetup: false,
        packageStatus: "red",
        attemptsUsed: 1,
        attemptsMax: 3,
      }),
      sampleState({
        status: "executing",
        hasSetup: false,
        packageStatus: "pending",
        attemptsUsed: 2,
      }),
      sampleState({
        status: "executing",
        hasSetup: false,
        packageStatus: "red",
        attemptsUsed: 3,
        attemptsMax: 3,
      }),
    ]),
  ];
  return {
    scenarios,
    humanGatedAttempted: scenarios.some((s) => s.humanGatedAttempted),
  };
}
