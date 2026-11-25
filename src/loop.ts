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

import { execFile } from "node:child_process";
import { nextStep, type GoalState, type Step } from "./state-machine.js";

/**
 * Loop-level run state (GOAL-002, R-1): the handover record the state
 * machine itself cannot see. The coordinator that dispatches the Worker
 * receives the Worker's handover commit SHA and records it here; the
 * next loop iteration verifies it and hands it to `nextStep` through
 * `applyHandover`. The signal never comes from CLI output.
 */
export interface LoopRunState {
  /** The plan's baseCommit the handover must descend from, if known. */
  baseCommit: string | null;
  /** Commit SHA the Worker handed over, or null when nothing was handed over. */
  handoverCommit: string | null;
  /** True only after `verifyHandover` confirmed the handover. */
  codeReady: boolean;
  /** Commits already submitted (a submitted commit is never re-submitted). */
  submittedCommits: string[];
  /** Commits that went red at the gate (never re-submitted). */
  redCommits: string[];
}

/** Fresh loop run state, optionally anchored at the plan's baseCommit. */
export function createRunState(baseCommit?: string | null): LoopRunState {
  return {
    baseCommit: baseCommit ?? null,
    handoverCommit: null,
    codeReady: false,
    submittedCommits: [],
    redCommits: [],
  };
}

/** Record a Worker's handover commit; it is unverified until `verifyHandover` passes. */
export function recordHandover(runState: LoopRunState, commit: string): void {
  runState.handoverCommit = commit;
  runState.codeReady = false;
}

/** Run one git command in `projectDir`; resolves to its exit code. */
function runGit(projectDir: string, args: readonly string[]): Promise<number> {
  return new Promise((resolvePromise) => {
    execFile("git", ["-C", projectDir, ...args], (error) => {
      if (error === null) {
        resolvePromise(0);
      } else {
        resolvePromise(typeof error.code === "number" ? error.code : 1);
      }
    });
  });
}

export interface HandoverVerification {
  verified: boolean;
  reason: string;
}

/**
 * Verify a handover commit with git before the machine may trust it:
 * the commit must exist, be a descendant of `baseCommit`, not be
 * `baseCommit` itself, and never have been submitted or gone red. An
 * unverified handover is treated as "no code" (worker-write-code), never
 * submitted. On success the run state is marked code-ready.
 */
export async function verifyHandover(
  runState: LoopRunState,
  projectDir: string,
): Promise<HandoverVerification> {
  const commit = runState.handoverCommit;
  if (commit === null) {
    return { verified: false, reason: "no handover commit recorded" };
  }
  const baseCommit = runState.baseCommit;
  if (baseCommit !== null && commit === baseCommit) {
    return { verified: false, reason: `handover commit ${commit} is the plan baseCommit itself` };
  }
  if (runState.submittedCommits.includes(commit)) {
    return { verified: false, reason: `handover commit ${commit} was already submitted` };
  }
  if (runState.redCommits.includes(commit)) {
    return { verified: false, reason: `handover commit ${commit} already went red` };
  }
  if ((await runGit(projectDir, ["cat-file", "-e", `${commit}^{commit}`])) !== 0) {
    return { verified: false, reason: `handover commit ${commit} does not exist in ${projectDir}` };
  }
  if (baseCommit !== null) {
    if ((await runGit(projectDir, ["merge-base", "--is-ancestor", baseCommit, commit])) !== 0) {
      return {
        verified: false,
        reason: `handover commit ${commit} is not a descendant of baseCommit ${baseCommit}`,
      };
    }
  }
  runState.codeReady = true;
  return { verified: true, reason: `handover commit ${commit} verified` };
}

/**
 * Fold the loop run state into a GoalState for `nextStep`: the machine
 * sees codeReady / handoverCommit / submittedCommits / redCommits only
 * through this copy. The reader's GoalState is never mutated.
 */
export function applyHandover(state: GoalState, runState: LoopRunState): GoalState {
  return {
    ...state,
    codeReady: runState.codeReady,
    handoverCommit: runState.handoverCommit,
    submittedCommits: [...runState.submittedCommits],
    redCommits: [...runState.redCommits],
  };
}

/**
 * Consume the handover after package-submit ran with it: the commit is
 * recorded as submitted, so the next read shows packageStatus
 * pending/red and the machine no longer consults codeReady for it.
 * Call this whenever the submit command ran (green, red or exit 3) —
 * the commit must not be submitted twice. If the submit failed to run
 * at all (the command itself errored), do NOT call this: the handover
 * stays and the next iteration retries package-submit.
 */
export function consumeHandover(runState: LoopRunState, commit: string): void {
  if (!runState.submittedCommits.includes(commit)) {
    runState.submittedCommits.push(commit);
  }
  if (runState.handoverCommit === commit) {
    runState.handoverCommit = null;
    runState.codeReady = false;
  }
}

/**
 * Record that a submitted commit went red at the gate: it is never
 * re-submitted. A red gate goes back to worker-fix, which produces a
 * NEW handover commit replacing the old one (via `recordHandover`).
 */
export function markRed(runState: LoopRunState, commit: string): void {
  if (!runState.redCommits.includes(commit)) {
    runState.redCommits.push(commit);
  }
  if (runState.handoverCommit === commit) {
    runState.handoverCommit = null;
    runState.codeReady = false;
  }
}

export type DryRunScenarioName = "with-setup" | "without-setup" | "red-gate" | "code-ready";

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
    codeReady: false,
    handoverCommit: null,
    submittedCommits: [],
    redCommits: [],
    ...overrides,
  };
}

/** Sample handover commit for the code-ready dry-run scenario. */
const SAMPLE_HANDOVER = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

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
 * Run the dry run over the four scripted scenarios:
 * - "with-setup": a sample project whose Goal is approved and selected and
 *   has a pinned setup.
 * - "without-setup": the same, with no setup pinned (this Goal's case).
 * - "red-gate": a red gate with attempts left, then a red gate with
 *   attempts exhausted.
 * - "code-ready" (GOAL-002): the worker-write-code -> package-submit
 *   transition through a real code-ready state — the handover commit is
 *   verified and the machine answers package-submit with it, instead of
 *   a "pending" package appearing from nowhere (the bug class that
 *   stalled the live loop on 25/11).
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
      sampleState({
        status: "executing",
        hasSetup: false,
        packageStatus: "none",
      }),
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
    walkScenario("code-ready", [
      sampleState({ status: "selected", hasSetup: false }),
      sampleState({
        status: "executing",
        hasSetup: false,
        packageStatus: "none",
        codeReady: false,
        handoverCommit: null,
      }),
      sampleState({
        status: "executing",
        hasSetup: false,
        packageStatus: "none",
        codeReady: true,
        handoverCommit: SAMPLE_HANDOVER,
      }),
      sampleState({ status: "executing", hasSetup: false, packageStatus: "green" }),
    ]),
  ];
  return {
    scenarios,
    humanGatedAttempted: scenarios.some((s) => s.humanGatedAttempted),
  };
}
