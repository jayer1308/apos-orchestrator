// Drive state (GOAL-003, R-1): persist the loop run state (`LoopRunState`)
// to a file outside the repo, one file per project + goal, so the drive
// runner (`npm run live -- --drive`) can keep the handover across
// separate invocations without a long-running process.
//
// Location: `$HOME/.apos-orchestrator/drive-state/<sha256(absolute repo
// path)>-<goalId>.json` — outside the repo, so it never lands in a gate
// submission diff, and it survives the fresh worktrees the gate uses
// (APOS #70). States are separate per project and per goal.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { LoopRunState } from "./loop.js";

/** The state file for one project + goal (see the header note). */
export function driveStatePath(
  repoPath: string,
  goalId: string,
  homeDir?: string,
): string {
  const home = homeDir ?? homedir();
  const hash = createHash("sha256").update(resolve(repoPath)).digest("hex");
  return join(home, ".apos-orchestrator", "drive-state", `${hash}-${goalId}.json`);
}

/** The saved `LoopRunState`, or `null` when no state file exists yet. */
export function loadDriveState(
  repoPath: string,
  goalId: string,
  homeDir?: string,
): LoopRunState | null {
  const path = driveStatePath(repoPath, goalId, homeDir);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf-8")) as LoopRunState;
}

/**
 * Persist the `LoopRunState` for one project + goal, creating the
 * parent directories and overwriting any previous state for that
 * project + goal. Saving one project + goal never affects another.
 */
export function saveDriveState(
  repoPath: string,
  goalId: string,
  state: LoopRunState,
  homeDir?: string,
): void {
  const path = driveStatePath(repoPath, goalId, homeDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}
