// Acceptance tests for GOAL-004 AC-3 (drive state per package) and
// AC-5 (drive state file behaviour stays green) — through the public
// entries `loadDriveState` / `saveDriveState` / `driveStatePath` of
// src/drive-state.ts only.
//
// Tester-defined contract (execution-004.json §3): the drive state
// stays ONE file per project + goal (path and file name unchanged),
// but its content splits per package: `packages` maps each package
// id to its own handover / code-ready / submitted / red record, and
// the top-level `submittedCommits` / `redCommits` are the UNION of
// the per-package lists — so the "never submit a commit that went
// red for ANY package" rule can be checked on the top level without
// knowing which package went red. `saveDriveState` /
// `loadDriveState` normalise the union, so a state saved with only
// the per-package map still loads with correct top-level unions.
//
// Plain save/load round-trips the `packages` map already (it is just
// JSON), so the round-trip and path tests stay green; only the union
// normalisation is new, and its test is red for the right reason
// until the Worker implements it.
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { driveStatePath, loadDriveState, saveDriveState } from "./drive-state.js";
import { createRunState, type LoopRunState } from "./loop.js";

const GOAL_ID = "GOAL-004";

const SHA_X = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const SHA_Y = "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1";
const SHA_Z = "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2";

function fakeHome(): string {
  return mkdtempSync(join(tmpdir(), "apos-orchestrator-drive-home-004-"));
}

function perPackageState(): LoopRunState {
  const state = createRunState("base0000000000000000000000000000000000000000000000000000000000");
  state.packages = {
    "WP-A": {
      handoverCommit: null,
      codeReady: false,
      submittedCommits: [SHA_X],
      redCommits: [SHA_Y],
    },
    "WP-B": {
      handoverCommit: null,
      codeReady: false,
      submittedCommits: [SHA_Z],
      redCommits: [],
    },
  };
  return state;
}

describe("AC-3 (GOAL-004): drive state splits per package, with top-level unions", () => {
  it("AC-3: top-level submitted/red are the union across packages when loading a per-package state", () => {
    const home = fakeHome();
    const repo = "/tmp/project-union-004";
    // Saved with only the per-package map: the top-level lists are empty.
    const saved = perPackageState();
    saved.submittedCommits = [];
    saved.redCommits = [];
    saveDriveState(repo, GOAL_ID, saved, home);
    const loaded = loadDriveState(repo, GOAL_ID, home);
    expect(loaded).not.toBeNull();
    expect([...(loaded as LoopRunState).submittedCommits].sort()).toEqual([SHA_X, SHA_Z].sort());
    expect((loaded as LoopRunState).redCommits).toEqual([SHA_Y]);
  });

  it("AC-3: save then load round-trips the full per-package map", () => {
    const home = fakeHome();
    const repo = "/tmp/project-round-trip-004";
    const saved = perPackageState();
    saved.submittedCommits = [SHA_X, SHA_Z];
    saved.redCommits = [SHA_Y];
    saveDriveState(repo, GOAL_ID, saved, home);
    expect(loadDriveState(repo, GOAL_ID, home)).toEqual(saved);
  });
});

describe("AC-5 (GOAL-004): drive state file behaviour stays green", () => {
  it("AC-5: still one file per project + goal, file name unchanged", () => {
    const home = fakeHome();
    const repo = "/tmp/project-one-file-004";
    const expectedHash = createHash("sha256").update(resolve(repo)).digest("hex");
    expect(driveStatePath(repo, GOAL_ID, home)).toBe(
      join(home, ".apos-orchestrator", "drive-state", `${expectedHash}-${GOAL_ID}.json`),
    );
    saveDriveState(repo, GOAL_ID, createRunState(null), home);
    expect(loadDriveState(repo, GOAL_ID, home)).not.toBeNull();
    expect(loadDriveState("/tmp/project-other-004", GOAL_ID, home)).toBeNull();
  });

  it("AC-5: an old flat state without a packages map still loads", () => {
    const home = fakeHome();
    const repo = "/tmp/project-flat-004";
    const flat = createRunState(null);
    flat.handoverCommit = SHA_X;
    flat.codeReady = true;
    flat.submittedCommits = [SHA_Z];
    saveDriveState(repo, GOAL_ID, flat, home);
    expect(loadDriveState(repo, GOAL_ID, home)).toEqual(flat);
  });
});
