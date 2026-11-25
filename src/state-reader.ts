// State reader: reads a Goal's current state through the APOS CLI and
// returns it as JSON. It never reads the controller journal or SQLite
// directly; the CLI is the only interface.
//
// STUB — every function throws until the Worker implements it.

import type { GoalState } from "./state-machine.js";

/** One APOS CLI invocation: its stdout, stderr and exit code. */
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Runs one APOS CLI call. `args` are the APOS subcommand arguments, e.g.
 * `["inbox", "--json"]`; the default executor prepends the CLI entry point
 * and `--repo <projectPath>`. Tests inject a fake executor returning
 * recorded CLI output so results never depend on live controller state.
 */
export type CliExecutor = (args: readonly string[]) => Promise<CliResult>;

/**
 * Read the state of `goalId` in the project at `projectPath` via the APOS
 * CLI. Sources: `inbox --json` (primary), `plan --json`, `goal list`
 * (text — no `--json` flag exists), `goal show` (text — no `--json` flag
 * exists) and `metrics show` (JSON by default — no `--json` flag exists).
 * Rejects when the CLI fails, its output cannot be parsed, or the goal is
 * not found. Never runs a human-gated command.
 */
export async function readGoalState(
  projectPath: string,
  goalId: string,
  executor?: CliExecutor,
): Promise<GoalState> {
  void projectPath;
  void goalId;
  void executor;
  throw new Error("not implemented");
}
