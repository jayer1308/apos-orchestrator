// Acceptance tests for GOAL-004 AC-1 (loop run state per package)
// and AC-5 (Solo loop behaviour stays green) — through the public
// entries of src/loop.ts only.
//
// Tester-defined contract (execution-004.json: LoopRunState gains
// `packages: Record<packageId, PackageRunState>`, and record / verify
// / apply / consume / markRed gain per-package variants; the Solo
// functions keep working on the scalar fields and delegate to the
// single package):
// - `recordHandoverForPackage` / `verifyHandoverForPackage` /
//   `applyHandoverForPackage` / `consumeHandoverForPackage` /
//   `markRedForPackage` touch only the named package — recording or
//   verifying a handover for WP-A never changes WP-B's state.
// - A commit that went red for ANY package is never submitted again:
//   `verifyHandoverForPackage` for WP-B refuses a commit that is red
//   under WP-A, and `markRedForPackage` records the red commit under
//   its own package only.
// - `applyHandoverForPackage(state, runState, pkg)` folds only that
//   package into `state.packages[pkg]`; other packages are not
//   folded, and the input state is never mutated.
//
// The per-package functions are still WP-CORE stubs (throw
// "not implemented"), so the AC-1 tests below are red for the right
// reason until the Worker implements them. The AC-5 tests call the
// existing Solo functions against a real temp git repo and stay green.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyHandover,
  applyHandoverForPackage,
  consumeHandover,
  consumeHandoverForPackage,
  createRunState,
  markRed,
  markRedForPackage,
  recordHandover,
  recordHandoverForPackage,
  verifyHandover,
  verifyHandoverForPackage,
  type LoopRunState,
  type PackageRunState,
} from "./loop.js";
import type { GoalState } from "./state-machine.js";

const trackedDirs: string[] = [];

afterEach(() => {
  for (const dir of trackedDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runGit(dir: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile("git", ["-C", dir, ...args], { encoding: "utf-8" }, (error, stdout, stderr) => {
      if (error !== null) {
        reject(new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`));
      } else {
        resolvePromise(stdout);
      }
    });
  });
}

interface SampleRepo {
  dir: string;
  base: string;
  shaA: string;
  shaB: string;
}

/** Temp git repo: base commit, then one worker commit per package. */
async function makeRepo(): Promise<SampleRepo> {
  const dir = mkdtempSync(join(tmpdir(), "apos-loop-004-"));
  trackedDirs.push(dir);
  await runGit(dir, ["init", "-q"]);
  await runGit(dir, ["config", "user.email", "loop-test@example.com"]);
  await runGit(dir, ["config", "user.name", "Loop Test"]);
  writeFileSync(join(dir, "code.txt"), "v1\n");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-qm", "base"]);
  const base = (await runGit(dir, ["rev-parse", "HEAD"])).trim();
  writeFileSync(join(dir, "a.txt"), "a\n");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-qm", "worker WP-A"]);
  const shaA = (await runGit(dir, ["rev-parse", "HEAD"])).trim();
  writeFileSync(join(dir, "b.txt"), "b\n");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-qm", "worker WP-B"]);
  const shaB = (await runGit(dir, ["rev-parse", "HEAD"])).trim();
  return { dir, base, shaA, shaB };
}

function emptyPackageRunState(): PackageRunState {
  return { handoverCommit: null, codeReady: false, submittedCommits: [], redCommits: [] };
}

function state(): GoalState {
  return {
    goalId: "GOAL-004",
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
  };
}

describe("AC-1 (GOAL-004): loop run state is kept per package", () => {
  it("AC-1: record + verify + apply for WP-A folds only WP-A into the GoalState", async () => {
    const repo = await makeRepo();
    const runState: LoopRunState = { ...createRunState(repo.base), packages: {} };
    recordHandoverForPackage(runState, "WP-A", repo.shaA);
    const verification = await verifyHandoverForPackage(runState, "WP-A", repo.dir);
    expect(verification.verified).toBe(true);
    const folded = applyHandoverForPackage(state(), runState, "WP-A");
    expect(folded.packages?.["WP-A"]?.codeReady).toBe(true);
    expect(folded.packages?.["WP-A"]?.handoverCommit).toBe(repo.shaA);
    expect(folded.packages?.["WP-B"]).toBeUndefined();
  });

  it("AC-1: handovers for WP-A and WP-B are recorded and verified independently", async () => {
    const repo = await makeRepo();
    const runState: LoopRunState = { ...createRunState(repo.base), packages: {} };
    recordHandoverForPackage(runState, "WP-A", repo.shaA);
    recordHandoverForPackage(runState, "WP-B", repo.shaB);
    expect((await verifyHandoverForPackage(runState, "WP-A", repo.dir)).verified).toBe(true);
    expect((await verifyHandoverForPackage(runState, "WP-B", repo.dir)).verified).toBe(true);
    const forA = applyHandoverForPackage(state(), runState, "WP-A");
    expect(forA.packages?.["WP-A"]?.handoverCommit).toBe(repo.shaA);
    expect(forA.packages?.["WP-B"]).toBeUndefined();
    const forB = applyHandoverForPackage(state(), runState, "WP-B");
    expect(forB.packages?.["WP-B"]?.handoverCommit).toBe(repo.shaB);
    expect(forB.packages?.["WP-A"]).toBeUndefined();
  });

  it("AC-1: markRed for WP-A records the red commit under WP-A only", () => {
    const runState: LoopRunState = {
      ...createRunState(null),
      packages: {
        "WP-A": { ...emptyPackageRunState(), handoverCommit: "sha-a", codeReady: true, submittedCommits: ["sha-a"] },
        "WP-B": { ...emptyPackageRunState(), handoverCommit: "sha-b", codeReady: true },
      },
    };
    markRedForPackage(runState, "WP-A", "sha-a");
    expect(runState.packages?.["WP-A"]?.redCommits).toContain("sha-a");
    expect(runState.packages?.["WP-B"]?.redCommits).not.toContain("sha-a");
    expect(runState.packages?.["WP-A"]?.handoverCommit).toBeNull();
    expect(runState.packages?.["WP-B"]?.handoverCommit).toBe("sha-b");
  });

  it("AC-1: verify for WP-B refuses a commit that already went red for WP-A", async () => {
    const repo = await makeRepo();
    const runState: LoopRunState = {
      ...createRunState(repo.base),
      packages: {
        "WP-A": { ...emptyPackageRunState(), submittedCommits: [repo.shaA], redCommits: [repo.shaA] },
        "WP-B": { ...emptyPackageRunState(), handoverCommit: repo.shaA },
      },
    };
    const verification = await verifyHandoverForPackage(runState, "WP-B", repo.dir);
    expect(verification.verified).toBe(false);
    expect(verification.reason).toMatch(/red|đỏ/i);
  });

  it("AC-1: consume for WP-A records the submit under WP-A only and leaves WP-B's handover alone", () => {
    const runState: LoopRunState = {
      ...createRunState(null),
      packages: {
        "WP-A": { ...emptyPackageRunState(), handoverCommit: "sha-a", codeReady: true },
        "WP-B": { ...emptyPackageRunState(), handoverCommit: "sha-b", codeReady: true },
      },
    };
    consumeHandoverForPackage(runState, "WP-A", "sha-a");
    expect(runState.packages?.["WP-A"]?.submittedCommits).toContain("sha-a");
    expect(runState.packages?.["WP-A"]?.handoverCommit).toBeNull();
    expect(runState.packages?.["WP-A"]?.codeReady).toBe(false);
    expect(runState.packages?.["WP-B"]?.submittedCommits).not.toContain("sha-a");
    expect(runState.packages?.["WP-B"]?.handoverCommit).toBe("sha-b");
    expect(runState.packages?.["WP-B"]?.codeReady).toBe(true);
  });
});

describe("AC-5 (GOAL-004): Solo loop functions stay green", () => {
  it("AC-5: createRunState returns an empty Solo run state", () => {
    const runState = createRunState("base000");
    expect(runState.baseCommit).toBe("base000");
    expect(runState.handoverCommit).toBeNull();
    expect(runState.codeReady).toBe(false);
    expect(runState.submittedCommits).toEqual([]);
    expect(runState.redCommits).toEqual([]);
  });

  it("AC-5: Solo record + verify + apply folds the verified handover into the GoalState", async () => {
    const repo = await makeRepo();
    const runState = createRunState(repo.base);
    recordHandover(runState, repo.shaA);
    expect(runState.codeReady).toBe(false);
    const verification = await verifyHandover(runState, repo.dir);
    expect(verification.verified).toBe(true);
    const folded = applyHandover(state(), runState);
    expect(folded.codeReady).toBe(true);
    expect(folded.handoverCommit).toBe(repo.shaA);
  });

  it("AC-5: Solo verify refuses a commit that was already submitted", async () => {
    const repo = await makeRepo();
    const runState = createRunState(repo.base);
    recordHandover(runState, repo.shaA);
    await verifyHandover(runState, repo.dir);
    consumeHandover(runState, repo.shaA);
    expect(runState.submittedCommits).toContain(repo.shaA);
    recordHandover(runState, repo.shaA);
    const verification = await verifyHandover(runState, repo.dir);
    expect(verification.verified).toBe(false);
  });

  it("AC-5: Solo consume + markRed record submit and red on the scalar fields", () => {
    const runState = createRunState(null);
    runState.handoverCommit = "sha-a";
    runState.codeReady = true;
    consumeHandover(runState, "sha-a");
    expect(runState.submittedCommits).toContain("sha-a");
    expect(runState.handoverCommit).toBeNull();
    markRed(runState, "sha-a");
    expect(runState.redCommits).toContain("sha-a");
  });
});
