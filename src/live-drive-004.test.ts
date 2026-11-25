// Acceptance tests for GOAL-004 AC-3 (drive mode per package) and
// AC-5 (Solo drive mode stays green) — through the public entries
// `runLive` and `parseHandoverArgs` of src/index.ts only, with a
// fake APOS CLI executor (recorded-output style) and a REAL temp git
// repo for handover verification.
//
// Tester-defined contract (execution-004.json §3 fixes the behaviour
// but not the runner's internals; the Worker implements it):
// - `npm run live -- --repo <project> --goal <id> --drive
//   --handover <pkg>:<sha>` repeats per package: one handover per
//   package, each verified with git (exists, descendant of the
//   plan's baseCommit, not baseCommit itself, never submitted /
//   never red for ANY package), each kept in drive-state under its
//   own package. `--handover <sha>` bare is still the Solo package.
// - The runner answers the first package with a verified handover
//   (in `--handover` order) as `package-submit` with that package's
//   commit and `packageId`; it never submits a commit that already
//   went red for any package — not even when the same commit is
//   handed over for another package — and says so in its output.
// - Drive-state is saved with the per-package map; the bare
//   "WP-A:<sha>" form never leaks into the Solo scalar fields.
// - `parseHandoverArgs(argv)` is the unit-testable parser for the
//   above: one entry per `--handover`, `{ packageId, commit }` with
//   `packageId: null` for the bare Solo form. It throws on a
//   malformed value or on the same package given twice — the driver
//   must never guess which package a handover belongs to.
//
// `parseHandoverArgs` is still the WP-DRIVE stub (throws
// "not implemented") and `runLive` still takes only one bare
// handover, so the AC-3 tests below are red for the right reason
// until the Worker implements them. The AC-5 tests pin Solo drive
// behaviour that already exists and stay green.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseHandoverArgs, runLive } from "./index.js";
import type { CliExecutor } from "./state-reader.js";

const GOAL_ID = "GOAL-004";

const trackedDirs: string[] = [];
const trackedStateFiles: string[] = [];

afterEach(() => {
  for (const file of trackedStateFiles.splice(0)) {
    rmSync(file, { force: true });
  }
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

/** Temp git repo: base, committed execution.md, one worker commit per package. */
async function makeRepo(): Promise<SampleRepo> {
  const dir = mkdtempSync(join(tmpdir(), "apos-drive-004-"));
  trackedDirs.push(dir);
  trackedStateFiles.push(driveStatePathFor(dir, GOAL_ID));
  await runGit(dir, ["init", "-q"]);
  await runGit(dir, ["config", "user.email", "drive-test@example.com"]);
  await runGit(dir, ["config", "user.name", "Drive Test"]);
  writeFileSync(join(dir, "code.txt"), "v1\n");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-qm", "base"]);
  const base = (await runGit(dir, ["rev-parse", "HEAD"])).trim();
  const execDir = join(dir, ".apos", "goals", GOAL_ID);
  mkdirSync(execDir, { recursive: true });
  writeFileSync(
    join(execDir, "execution.md"),
    "# EXEC-4\n\n```json\n" +
      JSON.stringify({ id: "EXEC-4", version: 1, goalId: GOAL_ID, baseCommit: base }) +
      "\n```\n",
  );
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-qm", "execution"]);
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

/** Fake APOS CLI: the five read calls plus `package list` (per-package JSON). */
function fakeExecutor(opts: {
  status: string;
  submitsByPackage?: Record<string, number>;
  redGates?: number;
  packageStatuses?: Record<string, string>;
}): CliExecutor {
  const submitsByPackage = opts.submitsByPackage ?? {};
  const redGates = opts.redGates ?? 0;
  const packageStatuses = opts.packageStatuses ?? { "WP-A": "pending", "WP-B": "pending" };
  const packageList: Record<string, { status: string; attempts: number }> = {};
  for (const [id, status] of Object.entries(packageStatuses)) {
    packageList[id] = { status, attempts: submitsByPackage[id] ?? 0 };
  }
  return async (args) => {
    let stdout: string | undefined;
    if (args[0] === "inbox") stdout = JSON.stringify({ items: [] });
    else if (args[0] === "plan")
      stdout = JSON.stringify({ goals: [{ id: GOAL_ID, status: opts.status }] });
    else if (args[0] === "package" && args[1] === "list") stdout = JSON.stringify(packageList);
    else if (args[0] === "goal" && args[1] === "list") stdout = `${GOAL_ID}\t${opts.status}\n`;
    else if (args[0] === "goal" && args[1] === "show")
      stdout = `${GOAL_ID}\t${opts.status}\nkhông có setup\nkhông có khoá test\n`;
    else if (args[0] === "metrics")
      stdout = JSON.stringify({ goalId: GOAL_ID, submitsByPackage, redGates });
    if (stdout === undefined) {
      throw new Error(`unexpected APOS call: ${args.join(" ")}`);
    }
    return { stdout, stderr: "", exitCode: 0 };
  };
}

/** The drive state file path the design pins (computed independently here). */
function driveStatePathFor(repoPath: string, goalId: string): string {
  const hash = createHash("sha256").update(resolve(repoPath)).digest("hex");
  return join(homedir(), ".apos-orchestrator", "drive-state", `${hash}-${goalId}.json`);
}

function readDriveStateFile(repoPath: string): Record<string, unknown> | null {
  const path = driveStatePathFor(repoPath, GOAL_ID);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

/** Seed a drive state file directly (as a previous run would have saved it). */
function seedDriveStateFile(repoPath: string, state: Record<string, unknown>): void {
  const path = driveStatePathFor(repoPath, GOAL_ID);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
}

async function runDrive(
  repo: string,
  handovers: readonly string[] | undefined,
  executor: CliExecutor,
): Promise<{ lines: string[]; result: Awaited<ReturnType<typeof runLive>> }> {
  const lines: string[] = [];
  const argv = ["--repo", repo, "--goal", GOAL_ID, "--drive"];
  for (const handover of handovers ?? []) {
    argv.push("--handover", handover);
  }
  const result = await runLive(argv, { executor, print: (line) => lines.push(line) });
  return { lines, result };
}

describe("AC-3 (GOAL-004): --handover parses per package", () => {
  it("AC-3: --handover <pkg>:<sha> repeated returns one entry per package, in order", () => {
    const shaA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    const shaB = "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1";
    expect(parseHandoverArgs(["--handover", `WP-A:${shaA}`, "--handover", `WP-B:${shaB}`])).toEqual([
      { packageId: "WP-A", commit: shaA },
      { packageId: "WP-B", commit: shaB },
    ]);
  });

  it("AC-3: bare --handover <sha> is the Solo package (packageId null)", () => {
    const sha = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    expect(parseHandoverArgs(["--handover", sha])).toEqual([{ packageId: null, commit: sha }]);
  });

  it("AC-3: a per-package handover and a bare handover mix, and malformed or duplicate handovers throw", () => {
    const shaA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
    const shaB = "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1";
    expect(parseHandoverArgs(["--handover", `WP-A:${shaA}`, "--handover", shaB])).toEqual([
      { packageId: "WP-A", commit: shaA },
      { packageId: null, commit: shaB },
    ]);
    expect(() => parseHandoverArgs(["--handover", `WP-A:${shaA}`, "--handover", `WP-A:${shaB}`])).toThrow();
    expect(() => parseHandoverArgs(["--handover", `WP-A:`])).toThrow();
    expect(() => parseHandoverArgs(["--handover", `:${shaA}`])).toThrow();
    expect(() => parseHandoverArgs(["--handover", "WP-A:not-a-sha"])).toThrow();
    expect(() => parseHandoverArgs(["--handover", "hello"])).toThrow();
    expect(parseHandoverArgs([])).toEqual([]);
  });
});

describe("AC-3 (GOAL-004): drive mode submits per-package handovers and never re-submits a red commit", () => {
  it("AC-3: --drive --handover WP-A:<shaA> --handover WP-B:<shaB> returns package-submit for WP-A with shaA first", async () => {
    const repo = await makeRepo();
    const { lines, result } = await runDrive(
      repo.dir,
      [`WP-A:${repo.shaA}`, `WP-B:${repo.shaB}`],
      fakeExecutor({ status: "executing" }),
    );
    expect(result.step.action).toBe("package-submit");
    expect(result.step.humanGate).toBe(false);
    expect(result.step.packageId).toBe("WP-A");
    expect(result.step.handoverCommit).toBe(repo.shaA);
    expect(lines.join("\n")).toContain(repo.shaA);
  });

  it("AC-3: a commit that went red for WP-A is never submitted for WP-B — the runner says it already went red", async () => {
    const repo = await makeRepo();
    seedDriveStateFile(repo.dir, {
      baseCommit: repo.base,
      handoverCommit: null,
      codeReady: false,
      submittedCommits: [repo.shaA],
      redCommits: [repo.shaA],
      packages: {
        "WP-A": {
          handoverCommit: null,
          codeReady: false,
          submittedCommits: [repo.shaA],
          redCommits: [repo.shaA],
        },
        "WP-B": { handoverCommit: null, codeReady: false, submittedCommits: [], redCommits: [] },
      },
    });
    const { lines, result } = await runDrive(
      repo.dir,
      [`WP-B:${repo.shaA}`],
      fakeExecutor({
        status: "executing",
        submitsByPackage: { "WP-A": 1 },
        redGates: 1,
        packageStatuses: { "WP-A": "red", "WP-B": "pending" },
      }),
    );
    expect(result.step.action).not.toBe("package-submit");
    expect(result.step.handoverCommit).not.toBe(repo.shaA);
    expect(lines.join("\n")).toMatch(/đã đỏ|already went red/i);
  });

  it("AC-3: after a drive call the saved state keeps the handover under its package, not in the Solo scalar", async () => {
    const repo = await makeRepo();
    await runDrive(repo.dir, [`WP-A:${repo.shaA}`], fakeExecutor({ status: "executing" }));
    const saved = readDriveStateFile(repo.dir);
    expect(saved).not.toBeNull();
    const packages = saved?.["packages"] as Record<string, Record<string, unknown>> | undefined;
    expect(packages?.["WP-A"]?.["handoverCommit"]).toBe(repo.shaA);
    expect(saved?.["handoverCommit"]).not.toBe(`WP-A:${repo.shaA}`);
  });
});

describe("AC-5 (GOAL-004): Solo drive mode stays green", () => {
  it("AC-5: --drive --handover <bare sha> still returns package-submit with that commit (GOAL-003)", async () => {
    const repo = await makeRepo();
    const { result } = await runDrive(repo.dir, [repo.shaA], fakeExecutor({ status: "executing" }));
    expect(result.step.action).toBe("package-submit");
    expect(result.step.humanGate).toBe(false);
    expect(result.step.handoverCommit).toBe(repo.shaA);
  });

  it("AC-5: without --drive the runner stays read-only — a per-package handover is ignored and no state file is created", async () => {
    const repo = await makeRepo();
    const lines: string[] = [];
    const result = await runLive(
      ["--repo", repo.dir, "--goal", GOAL_ID, "--handover", `WP-A:${repo.shaA}`],
      { executor: fakeExecutor({ status: "executing" }), print: (line) => lines.push(line) },
    );
    expect(result.step.action).toBe("worker-write-code");
    expect(result.step.handoverCommit).toBeUndefined();
    expect(existsSync(driveStatePathFor(repo.dir, GOAL_ID))).toBe(false);
    expect(lines.join("\n")).not.toContain(repo.shaA);
  });
});
