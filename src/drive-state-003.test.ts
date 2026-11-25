// Acceptance tests for GOAL-003 AC-1 (drive state file) — through the
// public entries `loadDriveState` / `saveDriveState` / `driveStatePath`
// of src/drive-state.ts only.
//
// Tester-defined contract (execution-003.json fixes the location but
// not the signatures; the Worker implements these exact signatures):
// - `driveStatePath(repoPath, goalId, homeDir?)` returns
//   `<home>/.apos-orchestrator/drive-state/<sha256(absolute repo
//   path)>-<goalId>.json` — outside the repo, so it never lands in a
//   gate submission diff.
// - `loadDriveState(repoPath, goalId, homeDir?)` returns the saved
//   `LoopRunState`, or `null` when no state file exists yet.
// - `saveDriveState(repoPath, goalId, state, homeDir?)` persists the
//   state (creating parent dirs), overwriting any previous state for
//   that project + goal. States are separate per project and per goal.
// - `homeDir` is an optional override for tests; without it the real
//   `$HOME` is used.
// `src/drive-state.ts` is still the stub (every entry raises
// "not implemented"), so these tests are red for the right reason until
// the Worker implements it.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as driveStateModule from "./drive-state.js";
import { createRunState, type LoopRunState } from "./loop.js";

type DriveStateModule = {
  driveStatePath: (repoPath: string, goalId: string, homeDir?: string) => string;
  loadDriveState: (repoPath: string, goalId: string, homeDir?: string) => LoopRunState | null;
  saveDriveState: (repoPath: string, goalId: string, state: LoopRunState, homeDir?: string) => void;
};

// The entries under test; fails the test (not the load) while missing.
function requireDriveState(): DriveStateModule {
  const mod = driveStateModule as unknown as Partial<DriveStateModule>;
  expect(typeof mod.driveStatePath).toBe("function");
  expect(typeof mod.loadDriveState).toBe("function");
  expect(typeof mod.saveDriveState).toBe("function");
  return mod as DriveStateModule;
}

const GOAL_A = "GOAL-001";
const GOAL_B = "GOAL-002";

function fakeHome(): string {
  return mkdtempSync(join(tmpdir(), "apos-orchestrator-drive-home-"));
}

function sampleState(): LoopRunState {
  const state = createRunState("base0000000000000000000000000000000000000000000000000000000000");
  state.handoverCommit = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
  state.codeReady = true;
  state.submittedCommits = ["1111111111111111111111111111111111111111"];
  state.redCommits = ["2222222222222222222222222222222222222222"];
  return state;
}

describe("AC-1 (GOAL-003): drive state file load/save", () => {
  it("AC-1: loadDriveState returns null when no state file exists yet", () => {
    const { loadDriveState: load } = requireDriveState();
    expect(load("/tmp/no-such-project-003", GOAL_A, fakeHome())).toBeNull();
  });

  it("AC-1: save then load round-trips the full LoopRunState", () => {
    const { loadDriveState: load, saveDriveState: save } = requireDriveState();
    const home = fakeHome();
    const repo = "/tmp/project-round-trip-003";
    const saved = sampleState();
    save(repo, GOAL_A, saved, home);
    const loaded = load(repo, GOAL_A, home);
    expect(loaded).toEqual(saved);
  });

  it("AC-1: saving twice overwrites — load returns the latest state", () => {
    const { loadDriveState: load, saveDriveState: save } = requireDriveState();
    const home = fakeHome();
    const repo = "/tmp/project-overwrite-003";
    save(repo, GOAL_A, sampleState(), home);
    const updated = createRunState(null);
    updated.submittedCommits = ["9999999999999999999999999999999999999999"];
    save(repo, GOAL_A, updated, home);
    expect(load(repo, GOAL_A, home)).toEqual(updated);
  });

  it("AC-1: states are separate per goal — saving one goal never affects another", () => {
    const { loadDriveState: load, saveDriveState: save } = requireDriveState();
    const home = fakeHome();
    const repo = "/tmp/project-per-goal-003";
    save(repo, GOAL_A, sampleState(), home);
    expect(load(repo, GOAL_B, home)).toBeNull();
    const other = createRunState(null);
    save(repo, GOAL_B, other, home);
    expect(load(repo, GOAL_A, home)).toEqual(sampleState());
    expect(load(repo, GOAL_B, home)).toEqual(other);
  });

  it("AC-1: states are separate per project — same goal in another repo starts empty", () => {
    const { loadDriveState: load, saveDriveState: save } = requireDriveState();
    const home = fakeHome();
    save("/tmp/project-one-003", GOAL_A, sampleState(), home);
    expect(load("/tmp/project-two-003", GOAL_A, home)).toBeNull();
  });

  it("AC-1: save creates the parent directories under the home dir", () => {
    const { loadDriveState: load, saveDriveState: save } = requireDriveState();
    const home = fakeHome();
    const repo = "/tmp/project-mkdir-003";
    save(repo, GOAL_A, sampleState(), home);
    expect(existsSync(join(home, ".apos-orchestrator", "drive-state"))).toBe(true);
    expect(load(repo, GOAL_A, home)).not.toBeNull();
  });

  it("AC-1: the state file lives outside the repo, under .apos-orchestrator/drive-state", () => {
    const { driveStatePath: pathFor } = requireDriveState();
    const home = fakeHome();
    const repo = "/tmp/project-outside-repo-003";
    const path = pathFor(repo, GOAL_A, home);
    expect(path.startsWith(resolve(repo))).toBe(false);
    expect(path.startsWith(join(home, ".apos-orchestrator", "drive-state"))).toBe(true);
  });

  it("AC-1: the file name is <sha256(absolute repo path)>-<goalId>.json", () => {
    const { driveStatePath: pathFor } = requireDriveState();
    const home = fakeHome();
    const repo = "/tmp/project-filename-003";
    const expectedHash = createHash("sha256").update(resolve(repo)).digest("hex");
    const path = pathFor(repo, GOAL_A, home);
    expect(path).toBe(join(home, ".apos-orchestrator", "drive-state", `${expectedHash}-${GOAL_A}.json`));
  });

  it("AC-1: different projects get different file names for the same goal", () => {
    const { driveStatePath: pathFor } = requireDriveState();
    const home = fakeHome();
    const first = pathFor("/tmp/project-alpha-003", GOAL_A, home);
    const second = pathFor("/tmp/project-beta-003", GOAL_A, home);
    expect(first).not.toBe(second);
  });

  it("AC-1: saving one project+goal creates exactly one state file", () => {
    const { saveDriveState: save } = requireDriveState();
    const home = fakeHome();
    save("/tmp/project-one-file-003", GOAL_A, sampleState(), home);
    const files = readdirSync(join(home, ".apos-orchestrator", "drive-state"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}-GOAL-001\.json$/);
  });
});
