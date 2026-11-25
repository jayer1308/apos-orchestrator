// Acceptance tests for GOAL-003 AC-1 / AC-2 / AC-3 (drive mode) —
// through the public entry `runLive` of src/index.ts only, with a fake
// APOS CLI executor (recorded-output style, as in live-runner.test.ts)
// and a REAL temp git repo for the handover verification.
//
// Tester-defined contract (execution-003.json fixes the behaviour but
// not the runner's internals; the Worker implements it):
// - `npm run live -- --repo <project> --goal <id> --drive
//   [--handover <sha>]`: loads the saved drive state for that project +
//   goal, reconciles it with the reader state (a commit the previous
//   call printed as package-submit is consumed into `submittedCommits`
//   once the reader shows package pending/red/green or attemptsUsed
//   grew, and into `redCommits` when the package is red), records +
//   verifies `--handover` with git (baseCommit from the ```json block
//   in the COMMITTED `<repo>/.apos/goals/<goal>/execution.md`; when
//   that file is missing or unparseable the check is skipped with an
//   explicit warning that the descendant check was skipped), then
//   `applyHandover` + `nextStep` and prints the step, and saves the
//   state. The drive state file lives at
//   `$HOME/.apos-orchestrator/drive-state/<sha256(abs repo
//   path)>-<goalId>.json` — outside the repo, never in a gate diff.
// - Without `--drive` the runner keeps its current read-only behaviour:
//   `--handover` is ignored and no drive state file is created.
// - The runner never runs a human-gated command and never passes
//   `--on-behalf`: only the five read calls reach the CLI.
// - The handover commit is NEVER guessed from git log: without
//   `--handover` the runner returns worker-write-code even when a new
//   commit exists in the repo.
//
// `runLive` does not support `--drive` / `--handover` yet, so the
// drive tests are red for the right reason (worker-write-code where
// package-submit is expected, no state file written) until the Worker
// implements it. The no-`--drive` and human-gate tests pin behaviour
// that already exists and stay green.
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
import { runLive } from "./index.js";
import type { CliExecutor } from "./state-reader.js";

const GOAL_ID = "GOAL-001";

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

type ExecutionKind = "root" | "side" | "missing" | "invalid";

interface SampleRepo {
  dir: string;
  base: string;
  handover: string;
}

/** Build a temp git repo: root commit, optional committed execution.md, worker commit. */
async function makeRepo(kind: ExecutionKind): Promise<SampleRepo> {
  const dir = mkdtempSync(join(tmpdir(), "apos-drive-003-"));
  trackedDirs.push(dir);
  trackedStateFiles.push(driveStatePathFor(dir, GOAL_ID));
  await runGit(dir, ["init", "-q"]);
  await runGit(dir, ["config", "user.email", "drive-test@example.com"]);
  await runGit(dir, ["config", "user.name", "Drive Test"]);
  writeFileSync(join(dir, "code.txt"), "v1\n");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-qm", "base"]);
  const base = (await runGit(dir, ["rev-parse", "HEAD"])).trim();
  let execBase = base;
  if (kind === "side") {
    // A root commit that is NOT an ancestor of the handover.
    execBase = (await runGit(dir, ["commit-tree", "HEAD^{tree}", "-m", "side"])).trim();
  }
  if (kind !== "missing") {
    const execDir = join(dir, ".apos", "goals", GOAL_ID);
    mkdirSync(execDir, { recursive: true });
    const body =
      kind === "invalid"
        ? "# EXEC-1\n\n```json\n{not json\n```\n"
        : "# EXEC-1 v1: solo-direct\n\n```json\n" +
          JSON.stringify({ id: "EXEC-1", version: 1, goalId: GOAL_ID, baseCommit: execBase }) +
          "\n```\n";
    writeFileSync(join(execDir, "execution.md"), body);
    await runGit(dir, ["add", "-A"]);
    await runGit(dir, ["commit", "-qm", "execution"]);
  }
  writeFileSync(join(dir, "code.txt"), "v2\n");
  await runGit(dir, ["add", "-A"]);
  await runGit(dir, ["commit", "-qm", "worker: change code"]);
  const handover = (await runGit(dir, ["rev-parse", "HEAD"])).trim();
  return { dir, base, handover };
}

/** Fake APOS CLI: answers the five read calls from canned state. */
function fakeExecutor(
  opts: { status: string; attemptsUsed?: number; redGates?: number },
  calls: Array<readonly string[]> = [],
): CliExecutor {
  const attemptsUsed = opts.attemptsUsed ?? 0;
  const redGates = opts.redGates ?? 0;
  return async (args) => {
    calls.push(args);
    let stdout: string | undefined;
    if (args[0] === "inbox") stdout = JSON.stringify({ items: [] });
    else if (args[0] === "plan")
      stdout = JSON.stringify({ goals: [{ id: GOAL_ID, status: opts.status }] });
    else if (args[0] === "goal" && args[1] === "list") stdout = `GOAL-001\t${opts.status}\n`;
    else if (args[0] === "goal" && args[1] === "show")
      stdout = `GOAL-001\t${opts.status}\nkhông có setup\nkhông có khoá test\n`;
    else if (args[0] === "metrics")
      stdout = JSON.stringify({
        goalId: GOAL_ID,
        submitsByPackage: attemptsUsed > 0 ? { "WP-MAIN": attemptsUsed } : {},
        redGates,
      });
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

const READ_CALLS: ReadonlyArray<readonly string[]> = [
  ["inbox", "--json"],
  ["plan", "--json"],
  ["goal", "list"],
  ["goal", "show", GOAL_ID],
  ["metrics", "show", GOAL_ID],
  // GOAL-004 AC-1 (approved criterion) adds the sixth read-only call,
  // `package list <goalId>`, for the per-package states; the old exact
  // list of five calls contradicted that criterion, so the criterion
  // wins and this list is updated (see _core/execute.md §1, and the
  // same update in src/loop.test.ts for GOAL-002).
  ["package", "list", GOAL_ID],
];

/** Every CLI call the runner made must be one of the five read calls. */
function expectOnlyReadCalls(calls: Array<readonly string[]>): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(READ_CALLS.some((read) => read.join(" ") === call.join(" "))).toBe(true);
  }
  expect(calls.join(" ")).not.toContain("--on-behalf");
}

async function runDrive(
  repo: string,
  handover: string | undefined,
  executor: CliExecutor,
): Promise<{ lines: string[]; result: Awaited<ReturnType<typeof runLive>> }> {
  const lines: string[] = [];
  const argv = ["--repo", repo, "--goal", GOAL_ID, "--drive"];
  if (handover !== undefined) argv.push("--handover", handover);
  const result = await runLive(argv, { executor, print: (line) => lines.push(line) });
  return { lines, result };
}

describe("AC-1 (GOAL-003): drive mode keeps the handover and submits it", () => {
  it("AC-1: --drive --handover <sha> after the Worker hands over returns package-submit with exactly that commit", async () => {
    const repo = await makeRepo("root");
    const calls: Array<readonly string[]> = [];
    const { lines, result } = await runDrive(repo.dir, repo.handover, fakeExecutor({ status: "executing" }, calls));
    expect(result.step.action).toBe("package-submit");
    expect(result.step.humanGate).toBe(false);
    expect(result.step.handoverCommit).toBe(repo.handover);
    expect(lines.join("\n")).toContain(repo.handover);
    expectOnlyReadCalls(calls);
  });

  it("AC-1: --drive --handover with a commit that does not exist returns worker-write-code and names the commit", async () => {
    const repo = await makeRepo("root");
    const missing = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const { lines, result } = await runDrive(repo.dir, missing, fakeExecutor({ status: "executing" }));
    expect(result.step.action).toBe("worker-write-code");
    expect(result.step.handoverCommit).toBeUndefined();
    expect(lines.join("\n")).toContain(missing);
  });

  it("AC-1: --drive --handover with the plan baseCommit itself returns worker-write-code", async () => {
    const repo = await makeRepo("root");
    const { result } = await runDrive(repo.dir, repo.base, fakeExecutor({ status: "executing" }));
    expect(result.step.action).toBe("worker-write-code");
    expect(result.step.handoverCommit).toBeUndefined();
  });

  it("AC-1: after the commit was submitted, a later --drive call does not submit it again (reader shows pending)", async () => {
    const repo = await makeRepo("root");
    const first = await runDrive(repo.dir, repo.handover, fakeExecutor({ status: "executing" }));
    expect(first.result.step.action).toBe("package-submit");
    expect(first.result.step.handoverCommit).toBe(repo.handover);
    // The submit ran: the reader now shows a pending package, 1 attempt used.
    const second = await runDrive(
      repo.dir,
      undefined,
      fakeExecutor({ status: "executing", attemptsUsed: 1, redGates: 0 }),
    );
    expect(second.result.step.action).toBe("package-submit");
    expect(second.result.step.handoverCommit).toBeUndefined();
    const saved = readDriveStateFile(repo.dir);
    expect(saved).not.toBeNull();
    expect(saved?.["submittedCommits"]).toContain(repo.handover);
    expect(saved?.["handoverCommit"]).toBeNull();
    expect(saved?.["codeReady"]).toBe(false);
  });

  it("AC-1: after the package went red, a later --drive call marks the commit red and goes to worker-fix, never re-submits it", async () => {
    const repo = await makeRepo("root");
    const first = await runDrive(repo.dir, repo.handover, fakeExecutor({ status: "executing" }));
    expect(first.result.step.handoverCommit).toBe(repo.handover);
    const second = await runDrive(
      repo.dir,
      undefined,
      fakeExecutor({ status: "executing", attemptsUsed: 1, redGates: 1 }),
    );
    expect(second.result.step.action).toBe("worker-fix");
    expect(second.result.step.handoverCommit).toBeUndefined();
    const saved = readDriveStateFile(repo.dir);
    expect(saved?.["submittedCommits"]).toContain(repo.handover);
    expect(saved?.["redCommits"]).toContain(repo.handover);
  });

  it("AC-1: --drive without --handover returns worker-write-code — the runner never guesses the handover from git log", async () => {
    const repo = await makeRepo("root");
    const { result } = await runDrive(repo.dir, undefined, fakeExecutor({ status: "executing" }));
    expect(result.step.action).toBe("worker-write-code");
    expect(result.step.handoverCommit).toBeUndefined();
  });

  it("AC-1: without --drive the runner stays read-only — --handover is ignored and no drive state file is created", async () => {
    const repo = await makeRepo("root");
    const lines: string[] = [];
    const result = await runLive(["--repo", repo.dir, "--goal", GOAL_ID, "--handover", repo.handover], {
      executor: fakeExecutor({ status: "executing" }),
      print: (line) => lines.push(line),
    });
    expect(result.step.action).toBe("worker-write-code");
    expect(result.step.handoverCommit).toBeUndefined();
    expect(existsSync(driveStatePathFor(repo.dir, GOAL_ID))).toBe(false);
    expect(lines.join("\n")).not.toContain(repo.handover);
  });

  it("AC-1: the drive state file never lands in the repo diff (git status stays clean)", async () => {
    const repo = await makeRepo("root");
    await runDrive(repo.dir, repo.handover, fakeExecutor({ status: "executing" }));
    expect(existsSync(driveStatePathFor(repo.dir, GOAL_ID))).toBe(true);
    const status = await runGit(repo.dir, ["status", "--porcelain"]);
    expect(status.trim()).toBe("");
  });
});

describe("AC-2 (GOAL-003): drive mode stops at human gates and never runs a human command", () => {
  it("AC-2: --drive on a draft goal returns wait-human-approve, only prints and stops", async () => {
    const repo = await makeRepo("root");
    const calls: Array<readonly string[]> = [];
    const { lines, result } = await runDrive(repo.dir, undefined, fakeExecutor({ status: "draft" }, calls));
    expect(result.step.action).toBe("wait-human-approve");
    expect(result.stoppedAtHumanGate).toBe(true);
    expect(lines.join("\n")).toContain("wait-human-approve");
    expectOnlyReadCalls(calls);
  });

  it("AC-2: --drive on a verified goal returns wait-human-close, only prints and stops", async () => {
    const repo = await makeRepo("root");
    const calls: Array<readonly string[]> = [];
    const { lines, result } = await runDrive(repo.dir, undefined, fakeExecutor({ status: "verified" }, calls));
    expect(result.step.action).toBe("wait-human-close");
    expect(result.stoppedAtHumanGate).toBe(true);
    expect(lines.join("\n")).toContain("wait-human-close");
    expectOnlyReadCalls(calls);
  });

  it("AC-2: drive output never mentions --on-behalf, even with a handover", async () => {
    const repo = await makeRepo("root");
    const { lines } = await runDrive(repo.dir, repo.handover, fakeExecutor({ status: "executing" }));
    expect(lines.join("\n")).not.toContain("--on-behalf");
  });
});

describe("AC-3 (GOAL-003): drive mode submits the new handover after a red gate", () => {
  it("AC-3: red package + attempts left + --drive --handover <new sha> returns package-submit with the new commit", async () => {
    const repo = await makeRepo("root");
    const { result } = await runDrive(
      repo.dir,
      repo.handover,
      fakeExecutor({ status: "executing", attemptsUsed: 1, redGates: 1 }),
    );
    expect(result.step.action).toBe("package-submit");
    expect(result.step.humanGate).toBe(false);
    expect(result.step.handoverCommit).toBe(repo.handover);
  });

  it("AC-3: red package + --drive --handover <sha that already went red> returns worker-fix, never package-submit with it", async () => {
    const repo = await makeRepo("root");
    seedDriveStateFile(repo.dir, {
      baseCommit: repo.base,
      handoverCommit: null,
      codeReady: false,
      submittedCommits: [repo.handover],
      redCommits: [repo.handover],
    });
    const { result } = await runDrive(
      repo.dir,
      repo.handover,
      fakeExecutor({ status: "executing", attemptsUsed: 1, redGates: 1 }),
    );
    expect(result.step.action).toBe("worker-fix");
    expect(result.step.handoverCommit).toBeUndefined();
  });
});

describe("AC-1 (GOAL-003): baseCommit for handover verification comes from execution.md", () => {
  it("AC-1: execution.md missing — the runner warns clearly that the descendant check was skipped, and still submits the existing commit", async () => {
    const repo = await makeRepo("missing");
    const { lines, result } = await runDrive(repo.dir, repo.handover, fakeExecutor({ status: "executing" }));
    expect(result.step.action).toBe("package-submit");
    expect(result.step.handoverCommit).toBe(repo.handover);
    const text = lines.join("\n");
    expect(text).toMatch(/bỏ qua/i);
    expect(text).toMatch(/hậu duệ|descendant/i);
  });

  it("AC-1: execution.md with an unparseable JSON block — same warning, still submits the existing commit", async () => {
    const repo = await makeRepo("invalid");
    const { lines, result } = await runDrive(repo.dir, repo.handover, fakeExecutor({ status: "executing" }));
    expect(result.step.action).toBe("package-submit");
    expect(result.step.handoverCommit).toBe(repo.handover);
    const text = lines.join("\n");
    expect(text).toMatch(/bỏ qua/i);
    expect(text).toMatch(/hậu duệ|descendant/i);
  });

  it("AC-1: handover is not a descendant of the baseCommit in execution.md — returns worker-write-code", async () => {
    const repo = await makeRepo("side");
    const { result } = await runDrive(repo.dir, repo.handover, fakeExecutor({ status: "executing" }));
    expect(result.step.action).toBe("worker-write-code");
    expect(result.step.handoverCommit).toBeUndefined();
  });
});
