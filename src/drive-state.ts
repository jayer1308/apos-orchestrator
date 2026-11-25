// Drive state (GOAL-003, R-1): persist the loop run state (`LoopRunState`)
// to a file outside the repo, one file per project + goal, so the drive
// runner (`npm run live -- --drive`) can keep the handover across
// separate invocations without a long-running process.
//
// Location: `$HOME/.apos-orchestrator/drive-state/<sha256(absolute repo
// path)>-<goalId>.json` — outside the repo, so it never lands in a gate
// submission diff, and it survives the fresh worktrees the gate uses
// (APOS #70). States are separate per project and per goal.
//
// Multi-WP (GOAL-004, WP-DRIVE): the file stays ONE per project + goal
// (path and file name unchanged), but its content splits per package:
// `packages` maps each package id to its own handover / code-ready /
// submitted / red record, and the top-level `submittedCommits` /
// `redCommits` are the UNION of the per-package lists — so the "never
// submit a commit that went red for ANY package" rule can be checked on
// the top level without knowing which package went red. `saveDriveState`
// / `loadDriveState` normalise the union, so a state saved with only
// the per-package map still loads with correct top-level unions. An old
// flat state without a `packages` map still loads exactly as saved.
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

/**
 * Normalise a loaded / saved run state (GOAL-004, WP-DRIVE): when a
 * `packages` map is present, the top-level `submittedCommits` /
 * `redCommits` become the union of the top-level lists and every
 * package's lists (top-level order first, then package order, deduped),
 * so the never-re-submit-a-red-commit rule can be checked on the top
 * level. A flat state without a `packages` map is returned unchanged.
 * Never mutates its input.
 */
function normaliseDriveState(state: LoopRunState): LoopRunState {
  const packages = state.packages;
  if (packages === undefined) {
    return state;
  }
  const union = (key: "submittedCommits" | "redCommits"): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const commit of [
      ...state[key],
      ...Object.values(packages).flatMap((pkg) => pkg[key]),
    ]) {
      if (!seen.has(commit)) {
        seen.add(commit);
        out.push(commit);
      }
    }
    return out;
  };
  return {
    ...state,
    submittedCommits: union("submittedCommits"),
    redCommits: union("redCommits"),
  };
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
  return normaliseDriveState(JSON.parse(readFileSync(path, "utf-8")) as LoopRunState);
}

/**
 * Persist the `LoopRunState` for one project + goal, creating the
 * parent directories and overwriting any previous state for that
 * project + goal. Saving one project + goal never affects another.
 * The top-level submitted / red lists are normalised to the union
 * across packages before writing (see `normaliseDriveState`).
 */
export function saveDriveState(
  repoPath: string,
  goalId: string,
  state: LoopRunState,
  homeDir?: string,
): void {
  const path = driveStatePath(repoPath, goalId, homeDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(normaliseDriveState(state)));
}
