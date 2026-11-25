// Agent loop (dry run): walks scripted sample states through the state
// machine and returns the Solo step sequence, without running any APOS
// command and without touching any real project.
//
// STUB — every function throws until the Worker implements it.

import type { Step } from "./state-machine.js";

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
  throw new Error("not implemented");
}
