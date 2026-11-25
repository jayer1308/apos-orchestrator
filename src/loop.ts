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
import {
  nextStep,
  nextStepForPackage,
  type GoalState,
  type Step,
} from "./state-machine.js";

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
  /**
   * Per-package run states (GOAL-004, WP-CORE). Absent for a Solo
   * Goal; the scalar fields above stay the Solo projection.
   */
  packages?: Record<string, PackageRunState>;
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

/**
 * Per-package run state (GOAL-004, WP-CORE): the same handover record
 * as `LoopRunState`, scoped to one work package. The scalar fields of
 * `LoopRunState` stay the Solo / WP-MAIN projection; the per-package
 * functions below are the Multi-WP variants, and the Solo functions
 * keep working on the scalar fields.
 */
export interface PackageRunState {
  /** Commit SHA the Worker handed over for this package, or null. */
  handoverCommit: string | null;
  /** True only after `verifyHandoverForPackage` confirmed the handover. */
  codeReady: boolean;
  /** Commits already submitted for this package (never re-submitted). */
  submittedCommits: string[];
  /** Commits that went red for this package (never re-submitted). */
  redCommits: string[];
}

/**
 * The per-package run state for `packageId`, creating it (and the
 * `packages` map) when it does not exist yet. An existing entry is
 * returned untouched, so its submitted / red lists survive.
 */
function ensurePackageRunState(
  runState: LoopRunState,
  packageId: string,
): PackageRunState {
  runState.packages ??= {};
  let pkg = runState.packages[packageId];
  if (pkg === undefined) {
    pkg = { handoverCommit: null, codeReady: false, submittedCommits: [], redCommits: [] };
    runState.packages[packageId] = pkg;
  }
  return pkg;
}

/** Submitted commits across the Solo scalar list and every package (deduped). */
function allSubmittedCommits(runState: LoopRunState): string[] {
  return [
    ...new Set([
      ...runState.submittedCommits,
      ...Object.values(runState.packages ?? {}).flatMap((pkg) => pkg.submittedCommits),
    ]),
  ];
}

/** Red commits across the Solo scalar list and every package (deduped). */
function allRedCommits(runState: LoopRunState): string[] {
  return [
    ...new Set([
      ...runState.redCommits,
      ...Object.values(runState.packages ?? {}).flatMap((pkg) => pkg.redCommits),
    ]),
  ];
}

/**
 * Record a Worker's handover commit for one package; unverified until
 * `verifyHandoverForPackage` passes. Other packages are untouched, and
 * an existing entry keeps its submitted / red lists.
 */
export function recordHandoverForPackage(
  runState: LoopRunState,
  packageId: string,
  commit: string,
): void {
  const pkg = ensurePackageRunState(runState, packageId);
  pkg.handoverCommit = commit;
  pkg.codeReady = false;
}

/**
 * Verify one package's handover commit with git (exists, descendant
 * of `baseCommit`, not `baseCommit` itself, never submitted and never
 * red — for this package or any other: a commit that went red for ANY
 * package is never submitted again). On success the package's run
 * state is marked code-ready.
 */
export async function verifyHandoverForPackage(
  runState: LoopRunState,
  packageId: string,
  projectDir: string,
): Promise<HandoverVerification> {
  const pkg = runState.packages?.[packageId];
  const commit = pkg?.handoverCommit ?? null;
  if (commit === null) {
    return { verified: false, reason: `no handover commit recorded for ${packageId}` };
  }
  const baseCommit = runState.baseCommit;
  if (baseCommit !== null && commit === baseCommit) {
    return { verified: false, reason: `handover commit ${commit} is the plan baseCommit itself` };
  }
  // Red is checked before submitted: a commit that went red for any
  // package is refused with a reason that says so.
  if (allRedCommits(runState).includes(commit)) {
    return { verified: false, reason: `handover commit ${commit} already went red` };
  }
  if (allSubmittedCommits(runState).includes(commit)) {
    return { verified: false, reason: `handover commit ${commit} was already submitted` };
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
  ensurePackageRunState(runState, packageId).codeReady = true;
  return { verified: true, reason: `handover commit ${commit} verified for ${packageId}` };
}

/**
 * Fold one package's run state into a GoalState for
 * `nextStepForPackage`: the machine sees that package's codeReady /
 * handoverCommit / submittedCommits / redCommits through
 * `state.packages[packageId]`. Other packages are untouched, and the
 * reader's GoalState is never mutated. The package's reader status
 * (green / red / ...) is kept from the input state when present.
 */
export function applyHandoverForPackage(
  state: GoalState,
  runState: LoopRunState,
  packageId: string,
): GoalState {
  const pkg = runState.packages?.[packageId];
  if (pkg === undefined) {
    return state.packages === undefined
      ? { ...state }
      : { ...state, packages: { ...state.packages } };
  }
  const existing = state.packages?.[packageId];
  return {
    ...state,
    packages: {
      ...(state.packages ?? {}),
      [packageId]: {
        status: existing?.status ?? "none",
        codeReady: pkg.codeReady,
        handoverCommit: pkg.handoverCommit,
        submittedCommits: [...pkg.submittedCommits],
        redCommits: [...pkg.redCommits],
      },
    },
  };
}

/**
 * Consume one package's handover after its package-submit ran with
 * it: the commit is recorded as submitted for that package only, so
 * it is never submitted again for any package. The Solo scalar list
 * is updated too, so it stays the union across packages (see
 * src/drive-state.ts). Other packages' handovers are untouched.
 */
export function consumeHandoverForPackage(
  runState: LoopRunState,
  packageId: string,
  commit: string,
): void {
  const pkg = ensurePackageRunState(runState, packageId);
  if (!pkg.submittedCommits.includes(commit)) {
    pkg.submittedCommits.push(commit);
  }
  if (!runState.submittedCommits.includes(commit)) {
    runState.submittedCommits.push(commit);
  }
  if (pkg.handoverCommit === commit) {
    pkg.handoverCommit = null;
    pkg.codeReady = false;
  }
}

/**
 * Record that a submitted commit went red for one package: it is
 * never re-submitted for that package or any other. The red commit is
 * recorded under its own package only (plus the Solo scalar list,
 * which stays the union across packages); a red gate goes back to
 * worker-fix for that package, which produces a NEW handover commit
 * replacing the old one.
 */
export function markRedForPackage(
  runState: LoopRunState,
  packageId: string,
  commit: string,
): void {
  const pkg = ensurePackageRunState(runState, packageId);
  if (!pkg.redCommits.includes(commit)) {
    pkg.redCommits.push(commit);
  }
  if (!runState.redCommits.includes(commit)) {
    runState.redCommits.push(commit);
  }
  if (pkg.handoverCommit === commit) {
    pkg.handoverCommit = null;
    pkg.codeReady = false;
  }
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

export type DryRunScenarioName =
  | "with-setup"
  | "without-setup"
  | "red-gate"
  | "code-ready"
  | "multi-wp";

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

/** Sample handover commit for WP-B in the multi-wp dry-run scenario. */
const SAMPLE_HANDOVER_B = "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1";

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
 * Walk a scripted sequence of (Goal state, package) pairs through the
 * per-package state machine. Stops at the first human gate. Never
 * attempts a human-gated command, so `humanGatedAttempted` is always
 * false.
 */
function walkMultiWpScenario(
  name: "multi-wp",
  pairs: Array<[GoalState, string]>,
): DryRunScenarioResult {
  const steps: Step[] = [];
  for (const [state, packageId] of pairs) {
    const step = nextStepForPackage(state, packageId);
    steps.push(step);
    if (step.humanGate) {
      break;
    }
  }
  return { name, steps, humanGatedAttempted: false };
}

/**
 * Run the dry run over the four scripted Solo scenarios (see below)
 * plus the Multi-WP scenario (GOAL-004):
 * - "multi-wp": WP-A code-ready + WP-B red -> package-submit for
 *   WP-A, worker-fix for WP-B; then, once every package is green,
 *   integration-gate -> integration-complete -> wait-human-close.
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
    walkMultiWpScenario("multi-wp", [
      [
        sampleState({
          packages: {
            "WP-A": {
              status: "none",
              codeReady: true,
              handoverCommit: SAMPLE_HANDOVER,
            },
            "WP-B": { status: "red", redCommits: [SAMPLE_HANDOVER_B] },
          },
          attemptsUsed: 1,
        }),
        "WP-A",
      ],
      [
        sampleState({
          packages: {
            "WP-A": {
              status: "none",
              codeReady: true,
              handoverCommit: SAMPLE_HANDOVER,
            },
            "WP-B": { status: "red", redCommits: [SAMPLE_HANDOVER_B] },
          },
          attemptsUsed: 1,
        }),
        "WP-B",
      ],
      [
        sampleState({
          packages: {
            "WP-A": { status: "green", submittedCommits: [SAMPLE_HANDOVER] },
            "WP-B": { status: "green", submittedCommits: [SAMPLE_HANDOVER_B] },
          },
          attemptsUsed: 2,
        }),
        "WP-A",
      ],
      [
        sampleState({
          packages: {
            "WP-A": { status: "green", submittedCommits: [SAMPLE_HANDOVER] },
            "WP-B": { status: "green", submittedCommits: [SAMPLE_HANDOVER_B] },
          },
          attemptsUsed: 2,
          integrationStatus: "gate-green",
        }),
        "WP-A",
      ],
      [
        sampleState({
          status: "verified",
          packages: {
            "WP-A": { status: "green", submittedCommits: [SAMPLE_HANDOVER] },
            "WP-B": { status: "green", submittedCommits: [SAMPLE_HANDOVER_B] },
          },
          attemptsUsed: 2,
        }),
        "WP-A",
      ],
    ]),
  ];
  return {
    scenarios,
    humanGatedAttempted: scenarios.some((s) => s.humanGatedAttempted),
  };
}
