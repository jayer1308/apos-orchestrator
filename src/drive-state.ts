// Drive state (GOAL-003, R-1) — STUB written by the Tester (see
// src/drive-state-003.test.ts for the contract). The Worker implements
// these entries; until then every call raises "not implemented".
//
// Contract (Tester-defined, from execution-003.json):
// - `driveStatePath(repoPath, goalId, homeDir?)` — the state file for
//   one project + goal:
//   `$HOME/.apos-orchestrator/drive-state/<sha256(absolute repo path)>-<goalId>.json`
//   (outside the repo, so it never lands in a gate submission diff).
// - `loadDriveState(repoPath, goalId, homeDir?)` — the saved
//   `LoopRunState`, or `null` when no state file exists yet.
// - `saveDriveState(repoPath, goalId, state, homeDir?)` — persist the
//   `LoopRunState` (creating parent dirs), overwriting any previous
//   state for that project + goal. States are separate per project and
//   per goal: saving one never affects another.
import type { LoopRunState } from "./loop.js";

export function driveStatePath(
  _repoPath: string,
  _goalId: string,
  _homeDir?: string,
): string {
  throw new Error("not implemented");
}

export function loadDriveState(
  _repoPath: string,
  _goalId: string,
  _homeDir?: string,
): LoopRunState | null {
  throw new Error("not implemented");
}

export function saveDriveState(
  _repoPath: string,
  _goalId: string,
  _state: LoopRunState,
  _homeDir?: string,
): void {
  throw new Error("not implemented");
}
