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

/**
 * Per-package state (GOAL-004, WP-CORE): the same Solo fields, scoped
 * to one work package. The scalar fields of `GoalState` below stay the
 * Solo / WP-MAIN projection, so `nextStep` is unchanged when a Goal has
 * no `packages` map.
 */
export interface PackageState {
  status: PackageStatus;
  codeReady?: boolean;
  handoverCommit?: string | null;
  submittedCommits?: readonly string[];
  redCommits?: readonly string[];
}

export interface GoalState {
  goalId: string;
  status: GoalStatus;
  hasSetup: boolean;
  testsLocked: boolean;
  attemptsUsed: number;
  attemptsMax: number;
  packageStatus: PackageStatus;
  /**
   * Code-ready signal (GOAL-002, R-1): true only when the loop has
   * ALREADY verified the handover commit — it exists in the repo, is a
   * descendant of the plan's baseCommit, is not baseCommit itself, and
   * was never submitted. The pure machine trusts this flag and never
   * runs git itself. Absent (older callers) means "not verified".
   */
  codeReady?: boolean;
  /** Commit SHA the Worker handed over, or null when nothing was handed over. */
  handoverCommit?: string | null;
  /** Commits already submitted (loop-level record); never submit again. */
  submittedCommits?: readonly string[];
  /** Commits that went red at the gate (loop-level record); never submit again. */
  redCommits?: readonly string[];
  /** Where attemptsMax came from: the CLI ("cli") or the default ("default"). */
  attemptsMaxSource?: "cli" | "default";
  /**
   * Per-package states (GOAL-004, WP-CORE). Absent for a Solo Goal (or
   * a reader that has not read them yet); `nextStep` ignores this map
   * and answers from the scalar fields above, unchanged.
   */
  packages?: Record<string, PackageState>;
  /**
   * Integration gate state (GOAL-004, WP-CORE): "none" before any
   * integration gate ran, "gate-pending" while its outcome is unknown,
   * "gate-green" once the integration gate went green — then the next
   * step is `integration-complete`. The reader populates this; the
   * pure machine only reads it.
   */
  integrationStatus?: "none" | "gate-pending" | "gate-green";
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
  | "integration-gate"
  | "integration-complete"
  | "done";

export interface Step {
  action: StepAction;
  reason: string;
  humanGate: boolean;
  /**
   * The package this step is for (GOAL-004, WP-CORE): set on
   * per-package steps (`nextStepForPackage`), so the driver knows
   * which package to submit / fix. Absent on Solo steps from
   * `nextStep`, which carry no package.
   */
  packageId?: string;
  /**
   * The handover commit a package-submit step carries (GOAL-002): the
   * verified Worker commit to submit. Absent on every other step — in
   * particular a step never carries a commit that was already submitted
   * or went red, and a pending package no longer carries the handover
   * (it was consumed by the submit).
   */
  handoverCommit?: string;
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

function step(
  action: StepAction,
  reason: string,
  humanGate: boolean,
  handoverCommit?: string,
): Step {
  return handoverCommit === undefined
    ? { action, reason, humanGate }
    : { action, reason, humanGate, handoverCommit };
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
        // Red path (GOAL-003, AC-3): a NEW handover already verified
        // (codeReady true, commit never submitted / never red) goes
        // straight to package-submit with that commit — the fix is
        // done, so asking for another worker-fix for the same red gate
        // would stall the loop. Red with no (or unverified) new
        // handover still goes to worker-fix.
        const handover = state.handoverCommit ?? null;
        const submitted = state.submittedCommits ?? [];
        const red = state.redCommits ?? [];
        if (
          state.codeReady === true &&
          handover !== null &&
          !submitted.includes(handover) &&
          !red.includes(handover)
        ) {
          return step(
            "package-submit",
            `The gate went red with attempts left and the Worker handed over a new verified commit ${handover}; the Lead submits that commit for the gate check.`,
            false,
            handover,
          );
        }
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

  // Executing, no package submitted yet: a verified code-ready handover
  // goes straight to package-submit with that commit — this is the fix
  // for the GOAL-002 loop stall (before, package-submit was only
  // reachable from a pending package, which only exists after a submit).
  // The handover is trusted only when the loop verified it
  // (codeReady); an unverified handover is "no code" and the reason
  // names the commit as the warning channel. A commit that was already
  // submitted or went red is never submitted again. Code-ready beats
  // the tests-submit branch: code exists, so tests were already
  // submitted.
  const handover = state.handoverCommit ?? null;
  const submitted = state.submittedCommits ?? [];
  const red = state.redCommits ?? [];
  if (
    state.codeReady === true &&
    handover !== null &&
    !submitted.includes(handover) &&
    !red.includes(handover)
  ) {
    return step(
      "package-submit",
      `Worker handed over commit ${handover}; the code is ready, so the Lead submits that commit for the gate check.`,
      false,
      handover,
    );
  }
  if (handover !== null && state.codeReady !== true) {
    return step(
      "worker-write-code",
      `Handover commit ${handover} is not verified (code-ready not confirmed), so it is treated as no code; the Worker writes the code.`,
      false,
    );
  }
  if (handover !== null && (submitted.includes(handover) || red.includes(handover))) {
    return step(
      "worker-write-code",
      `Handover commit ${handover} was already submitted or went red, so it is never submitted again; the Worker writes new code.`,
      false,
    );
  }
  // Executing, no package submitted yet and no usable handover: tests
  // first when a setup is pinned and the tests are not locked,
  // otherwise the Worker writes code.
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
 * The next step for one package of a Multi-WP Goal (GOAL-004, WP-CORE).
 *
 * Rules, in order:
 * 1. Solo (no `packages` map, or a single package in it) answers exactly
 *    like `nextStep` for the same state — the returned step is the
 *    `nextStep` step itself, with no `packageId` attached.
 * 2. A non-executing Goal status wins over the packages (verified stays
 *    `wait-human-close`, draft stays `wait-human-approve`, ...), again
 *    exactly like `nextStep`.
 * 3. When every package is green it returns `integration-gate`
 *    (humanGate false — the driver runs `apos integration gate
 *    <goalId> --commit <sha> --reason <text>`); once the integration
 *    gate went green (`integrationStatus: "gate-green"`) it returns
 *    `integration-complete`. With one package green and one not, there
 *    is no integration step: the next step still belongs to the
 *    unfinished package.
 * 4. Otherwise it applies the `nextStep` rules scoped to `packageId`:
 *    that package's pending / red / green / none status, its own
 *    code-ready handover, its own red + new-handover path. A handover
 *    is trusted only when it is in NO package's submitted or red lists
 *    (the union across packages — a commit that went red for any
 *    package is never submitted for another). A green package while
 *    others are unfinished has no step of its own, so the machine
 *    answers with the first unfinished package's step (with that
 *    package's id), instead of `wait-human-close` or an integration
 *    step. Per-package steps carry `packageId`; integration steps do
 *    not (they belong to the whole Goal).
 */
export function nextStepForPackage(state: GoalState, packageId: string): Step {
  const packages = state.packages;
  const packageIds = packages === undefined ? [] : Object.keys(packages);
  if (packageIds.length <= 1 || state.status !== "executing") {
    return nextStep(state);
  }

  const getPackage = (id: string): PackageState =>
    packages?.[id] ?? { status: "none" };

  // Every package green: the integration gate runs before the Goal can
  // be closed. `gate-pending` (gate outcome unknown) still needs the
  // gate, so only `gate-green` advances to integration-complete.
  if (packageIds.every((id) => getPackage(id).status === "green")) {
    if (state.integrationStatus === "gate-green") {
      return {
        action: "integration-complete",
        reason:
          "Every package is green and the integration gate went green; the driver runs `apos integration complete` with the integration commit to verify the Goal.",
        humanGate: false,
      };
    }
    return {
      action: "integration-gate",
      reason:
        "Every package is green; the driver builds one integration commit from the green package commits and runs `apos integration gate` on it.",
      humanGate: false,
    };
  }

  const pkg = getPackage(packageId);
  if (pkg.status === "green") {
    // A green package has no step of its own while another package is
    // unfinished: answer with the unfinished package's step so the
    // driver keeps driving the Goal (never an integration step and
    // never wait-human-close here).
    const unfinished = packageIds.find((id) => getPackage(id).status !== "green");
    if (unfinished !== undefined) {
      return nextStepForPackage(state, unfinished);
    }
    // Unreachable: the all-green case above already returned.
    return nextStep(state);
  }

  // Scope the Solo rules to this package: its status, its code-ready
  // handover, and the union of every package's submitted / red commits
  // (plus the scalar lists) so a red commit is never re-submitted for
  // any package. Submitted and red are unioned separately: a commit is
  // blocked from re-submit when it is in EITHER union, and the
  // machine's reasons distinguish the two, so keep the two lists apart.
  const submittedUnion = [...new Set([
    ...(state.submittedCommits ?? []),
    ...packageIds.flatMap((id) => getPackage(id).submittedCommits ?? []),
  ])];
  const redUnion = [...new Set([
    ...(state.redCommits ?? []),
    ...packageIds.flatMap((id) => getPackage(id).redCommits ?? []),
  ])];
  // Drop the packages map for the projection: `nextStep` answers from
  // the scalar fields only, and the type forbids an explicit
  // `packages: undefined` (exactOptionalPropertyTypes).
  const { packages: _dropped, ...projectedBase } = state;
  void _dropped;
  const projected: GoalState = {
    ...projectedBase,
    packageStatus: pkg.status,
    codeReady: pkg.codeReady ?? false,
    handoverCommit: pkg.handoverCommit ?? null,
    submittedCommits: submittedUnion,
    redCommits: redUnion,
  };
  const step = nextStep(projected);
  return { ...step, packageId };
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
