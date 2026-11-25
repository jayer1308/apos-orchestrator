// Live test for GOAL-003 AC-4 (CHK-4): builds its own sample APOS
// project in a temp dir and drives a real Goal from `selected` to green
// ONLY through the subprocess drive runner (`node dist/index.js --repo
// … --goal … --drive [--handover <sha>]`) — never by calling the loop /
// state-machine / state-reader helpers directly, and never by a
// hand-kept handover script. The driver reads the runner's printed step
// and executes it (pty approve/select for the fixture Goal, lead
// propose/commit and package submit through the APOS CLI, worker
// write/fix by committing code), then asks the runner again.
//
// Two scenarios run back to back:
//   (a) `green-first`: Worker commit đúng → drive --handover →
//       package-submit → verified ngay lần nộp đầu.
//   (b) `red-then-green`: Worker commit sai cố ý (greet trả "hello") →
//       gate đỏ → Worker fix commit mới → drive --handover <sha mới> →
//       package-submit → verified.
//
// Multi-WP (GOAL-004 AC-4, CHK-4): the same driver also runs two
// further scenarios on a real 2-package Goal (WP-A / WP-B, independent
// files, `package add` through the CLI), driven ONLY through the
// subprocess drive runner with per-package handovers
// (`--drive --handover WP-A:<sha> --handover WP-B:<sha>`):
//   (c) `multi-wp-green-first`: both packages green on the first submit.
//   (d) `multi-wp-red-then-green`: WP-A red once, then fixed and green.
// The two packages are developed on separate branches from the plan
// base (so each submit's diff stays inside its own package paths) and
// the integration commit is a merge commit (no squash/rebase) with both
// green package commits as ancestors; on `integration-gate` the driver
// builds that merge commit, runs `apos integration gate` on it and,
// when it is green, `apos integration complete` in the same step (the
// reader cannot report the gate outcome — see src/state-reader.ts — so
// gate + complete are the two halves of executing that one printed
// step), and the Goal verifies.
//
// Self-contained on purpose: each gate check runs in a fresh worktree
// (APOS #70), so this entry must not depend on any repo outside the temp
// dir it builds — only the APOS CLI (resolved like the state reader
// does) and git — and it builds the drive runner itself (`npm run
// build` in the orchestrator repo, under a lock dir so parallel test
// files do not build over each other) when `dist/index.js` is missing
// or older than the sources. The sample project needs no dependencies:
// its only check is `npm test`, which runs plain `node test.mjs`.
//
// Provisioning note (fixture use only, logged on every run): getting the
// sample Goal to `selected` needs the human-gated `goal approve` /
// `goal select`. The Goal here is a throwaway fixture created by this
// test itself inside its own temp dir — not a real Goal — so the test
// drives the CLI's interactive confirmation through a pty (`script`
// allocates the TTY; the test types the Goal id back when prompted).
// That is the provisioning of a one-off fixture, not a decision on a
// real Goal: the script never passes --on-behalf, never edits `.apos`
// state or controller files by hand, and never runs a human command
// outside this pty provisioning. If the pty mechanism cannot work in
// the gate environment (no TTY available), the run fails with a clear
// error saying so instead of working around it.
//
// `main()` itself never calls `process.exit`, so tests can call
// `runLiveTest` directly; only the CLI guard at the bottom of this file
// sets the exit code when the file is run as a script
// (`node dist/live-test.js`).
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAposCli } from "./apos-cli.js";

export const LIVE_GOAL_ID = "GOAL-001";
export const LIVE_PACKAGE_ID = "WP-MAIN";
/** The sample Multi-WP packages (GOAL-004 AC-4): two independent packages. */
export const LIVE_MULTI_WP_PACKAGE_IDS = ["WP-A", "WP-B"];

/** The orchestrator repo root (this module lives in src/ or dist/). */
const ORCHESTRATOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The built drive runner this test spawns (see ensureRunnerBuilt). */
const RUNNER = join(ORCHESTRATOR_ROOT, "dist/index.js");

export interface LiveScenarioResult {
  name: string;
  steps: string[];
  verified: boolean;
  projectDir: string;
}

export interface LiveTestResult {
  goalId: string;
  projectDir: string;
  steps: string[];
  verified: boolean;
  log: string;
  scenarios: LiveScenarioResult[];
  /** The Multi-WP scenarios (GOAL-004 AC-4), in order. */
  multiWpScenarios: LiveScenarioResult[];
}

const SAMPLE_PACKAGE_JSON = `{
  "name": "live-sample",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "scripts": {
    "test": "node test.mjs"
  }
}
`;

const SAMPLE_GREET_BASE = `export function greet() {
  return "hello";
}
`;

const SAMPLE_GREET_FIXED = `export function greet() {
  return "xin chào";
}
`;

const SAMPLE_GREET_WRONG = `export function greet() {
  return "hello";
}
// worker: first attempt
`;

const SAMPLE_TEST = `import assert from "node:assert";
import { greet } from "./greet.mjs";

assert.equal(greet(), "xin chào");
console.log("test ok");
`;

const SAMPLE_BRIEF = `# Brief mẫu: greet trả "xin chào"

Dòng 8: hàm greet() phải trả về "xin chào".
Dòng 9: test.mjs kiểm chứng điều đó.
`;

function sampleGoalJson(): string {
  return JSON.stringify({
    id: LIVE_GOAL_ID,
    version: 1,
    outcome: "greet() trả về xin chào",
    requirements: [
      {
        id: "R-1",
        sourceSpan: "dòng 8",
        text: "hàm greet() phải trả về xin chào",
        disposition: "acceptance",
      },
    ],
    scope: ["greet.mjs", "test.mjs"],
    exclusions: [],
    dependencies: [],
    priority: 1,
    acceptance: [
      {
        id: "AC-1",
        text: "greet() trả về xin chào",
        requirementIds: ["R-1"],
        examples: [{ input: "greet()", expected: "xin chào" }],
        boundaries: [],
        prohibited: [],
        checkIds: ["CHK-1"],
      },
    ],
    checks: [
      {
        id: "CHK-1",
        kind: "command",
        command: "npm test",
        expect: "pass",
        runs: 1,
        timeoutMs: 600000,
        env: {},
      },
    ],
  });
}

function sampleExecutionJson(baseCommit: string, briefSha256: string): string {
  return JSON.stringify({
    id: "EXEC-1",
    version: 1,
    goalId: LIVE_GOAL_ID,
    goalVersion: 1,
    mode: "solo-direct",
    approach:
      "Worker đổi greet() trả về xin chào rồi commit; Lead submit package với commit đó.",
    baseCommit,
    sourceSha256: briefSha256,
    estimatedCost: { wallMinutes: 30 },
    rationale: "Một thay đổi nhỏ, một owner.",
    sharedPaths: [],
    paths: ["greet.mjs", "test.mjs"],
    stubPaths: [],
    entries: ["greet.mjs:greet"],
    risks: [],
    acceptanceMapping: [{ acceptanceId: "AC-1", verification: "npm test" }],
    verificationStrategy: "Run npm test",
  });
}

// --- Multi-WP sample (GOAL-004 AC-4) -------------------------------------
// Two independent packages: WP-A owns greet-a (CHK-1), WP-B owns
// greet-b (CHK-2). Each package's gate runs only its own check, so a
// wrong WP-A commit goes red without failing WP-B's gate, and each
// package's submit diff stays inside its own paths because the two
// Worker commits live on separate branches from the plan base.

const SAMPLE_MULTI_PACKAGE_JSON = `{
  "name": "live-sample-multi",
  "private": true,
  "type": "module",
  "version": "0.1.0",
  "scripts": {
    "test": "node test-a.mjs && node test-b.mjs"
  }
}
`;

const SAMPLE_GREET_A_BASE = `export function greetA() {
  return "hello";
}
`;

const SAMPLE_GREET_A_FIXED = `export function greetA() {
  return "xin chào";
}
`;

const SAMPLE_GREET_A_WRONG = `export function greetA() {
  return "hello";
}
// worker: first attempt
`;

const SAMPLE_GREET_B_BASE = `export function greetB() {
  return "hello";
}
`;

const SAMPLE_GREET_B_FIXED = `export function greetB() {
  return "chào bạn";
}
`;

const SAMPLE_GREET_B_WRONG = `export function greetB() {
  return "hello";
}
// worker: first attempt
`;

const SAMPLE_TEST_A = `import assert from "node:assert";
import { greetA } from "./greet-a.mjs";

assert.equal(greetA(), "xin chào");
console.log("test-a ok");
`;

const SAMPLE_TEST_B = `import assert from "node:assert";
import { greetB } from "./greet-b.mjs";

assert.equal(greetB(), "chào bạn");
console.log("test-b ok");
`;

const SAMPLE_MULTI_BRIEF = `# Brief mẫu Multi-WP: greetA trả "xin chào", greetB trả "chào bạn"

Dòng 8: hàm greetA() phải trả về "xin chào".
Dòng 9: hàm greetB() phải trả về "chào bạn".
Dòng 10: test-a.mjs kiểm chứng greetA, test-b.mjs kiểm chứng greetB.
`;

function sampleMultiGoalJson(): string {
  return JSON.stringify({
    id: LIVE_GOAL_ID,
    version: 1,
    outcome: 'greetA() trả về xin chào, greetB() trả về chào bạn',
    requirements: [
      { id: "R-1", sourceSpan: "dòng 8", text: 'hàm greetA() phải trả về xin chào', disposition: "acceptance" },
      { id: "R-2", sourceSpan: "dòng 9", text: 'hàm greetB() phải trả về chào bạn', disposition: "acceptance" },
    ],
    scope: ["greet-a.mjs", "test-a.mjs", "greet-b.mjs", "test-b.mjs"],
    exclusions: [],
    dependencies: [],
    priority: 1,
    acceptance: [
      {
        id: "AC-1",
        text: 'greetA() trả về xin chào',
        requirementIds: ["R-1"],
        examples: [{ input: "greetA()", expected: "xin chào" }],
        boundaries: [],
        prohibited: [],
        checkIds: ["CHK-1"],
      },
      {
        id: "AC-2",
        text: 'greetB() trả về chào bạn',
        requirementIds: ["R-2"],
        examples: [{ input: "greetB()", expected: "chào bạn" }],
        boundaries: [],
        prohibited: [],
        checkIds: ["CHK-2"],
      },
    ],
    checks: [
      { id: "CHK-1", kind: "command", command: "node test-a.mjs", expect: "pass", runs: 1, timeoutMs: 600000, env: {} },
      { id: "CHK-2", kind: "command", command: "node test-b.mjs", expect: "pass", runs: 1, timeoutMs: 600000, env: {} },
    ],
  });
}

function sampleMultiExecutionJson(baseCommit: string, briefSha256: string): string {
  return JSON.stringify({
    id: "EXEC-1",
    version: 1,
    goalId: LIVE_GOAL_ID,
    goalVersion: 1,
    mode: "multi-wp",
    approach:
      "WP-A đổi greetA() trả về xin chào, WP-B đổi greetB() trả về chào bạn, mỗi package trên một branch riêng; hợp nhất bằng merge commit rồi integration gate.",
    baseCommit,
    sourceSha256: briefSha256,
    estimatedCost: { wallMinutes: 60 },
    rationale: "Hai thay đổi độc lập, không phụ thuộc nhau.",
    splitRationale: "Hai hàm độc lập trên hai file độc lập: tách thành hai package song song để mỗi package green riêng rồi mới hợp nhất ở integration gate.",
    sharedPaths: [],
    paths: ["greet-a.mjs", "test-a.mjs", "greet-b.mjs", "test-b.mjs"],
    stubPaths: [],
    entries: ["greet-a.mjs:greetA", "greet-b.mjs:greetB"],
    risks: [],
    acceptanceMapping: [
      { acceptanceId: "AC-1", verification: "node test-a.mjs" },
      { acceptanceId: "AC-2", verification: "node test-b.mjs" },
    ],
    verificationStrategy: "Run node test-a.mjs and node test-b.mjs per package, then the integration gate on the merge commit",
  });
}

function sampleMultiPackageJson(packageId: "WP-A" | "WP-B"): string {
  const isA = packageId === "WP-A";
  return JSON.stringify({
    id: packageId,
    goalId: LIVE_GOAL_ID,
    goalVersion: 1,
    version: 1,
    owner: "lead",
    outcome: isA ? 'greetA() trả về xin chào' : 'greetB() trả về chào bạn',
    scope: isA ? ["greet-a.mjs", "test-a.mjs"] : ["greet-b.mjs", "test-b.mjs"],
    exclusions: [],
    dependencies: [],
    interfaces: isA ? ["greetA@v1"] : ["greetB@v1"],
    acceptance: [
      {
        id: isA ? "AC-1" : "AC-2",
        text: isA ? 'greetA() trả về xin chào' : 'greetB() trả về chào bạn',
        goalAcceptanceId: isA ? "AC-1" : "AC-2",
        checkIds: isA ? ["CHK-1"] : ["CHK-2"],
      },
    ],
    integration: "hợp nhất ở integration gate bằng merge commit chứa commit green của cả hai package",
    paths: isA ? ["greet-a.mjs", "test-a.mjs"] : ["greet-b.mjs", "test-b.mjs"],
    stubPaths: [],
  });
}

// The APOS CLI itself is an environment prerequisite (like git and
// node), resolved by the shared src/apos-cli.ts: $APOS_CLI, then the
// sibling ../apos/dist/cli.js, then $HOME/workspace/apos/dist/cli.js,
// then `apos` on PATH. A fresh gate worktree (APOS #70) has no sibling
// APOS repo, so the $HOME fallback is what finds the CLI there; set
// APOS_CLI to point elsewhere when the CLI lives at another path.

interface RunOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Run a command and capture its output (never throws on exit code). */
function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<RunOutput> {
  return new Promise((resolvePromise) => {
    execFile(command, [...args], { cwd, encoding: "utf-8" }, (error, stdout, stderr) => {
      resolvePromise({
        stdout,
        stderr,
        exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
      });
    });
  });
}

/** Run a command; throw with its output when it exits non-zero. */
async function runOrThrow(
  label: string,
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<RunOutput> {
  const out = await runCommand(command, args, cwd);
  if (out.exitCode !== 0) {
    throw new Error(
      `${label} failed (exit ${out.exitCode}): ${(out.stdout + out.stderr).trim().slice(0, 2000)}`,
    );
  }
  return out;
}

/** Run one APOS CLI call in the sample project; throw on non-zero exit. */
async function runApos(
  cli: string,
  projectDir: string,
  args: readonly string[],
): Promise<RunOutput> {
  return runOrThrow(
    `apos ${args.join(" ")}`,
    "node",
    [cli, "--repo", projectDir, ...args],
    projectDir,
  );
}

/** Shell-quote one argument for the `script -c` command line. */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * Run a human-gated APOS command through a pty so the CLI's interactive
 * confirmation can be answered by typing the subject back. This is the
 * one-off fixture provisioning described at the top of this file: it
 * types the Goal id on a TTY, never passes --on-behalf, and never edits
 * state by hand. `script` (util-linux) allocates the pty; if it is
 * missing or the pty cannot be allocated, the error says so plainly.
 */
function runAposPty(
  cli: string,
  projectDir: string,
  args: readonly string[],
  typed: string,
): Promise<RunOutput> {
  const commandLine = [
    "node",
    shellQuote(cli),
    "--repo",
    shellQuote(projectDir),
    ...args.map(shellQuote),
  ].join(" ");
  return new Promise((resolvePromise, reject) => {
    const child = spawn("script", ["-qec", commandLine, "/dev/null"], {
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", (error: Error) => {
      reject(
        new Error(
          `pty provisioning failed: could not run "script" to allocate a TTY ` +
            `for "apos ${args.join(" ")}" (${error.message}); the live test ` +
            `cannot confirm the human-gated command without a TTY and does ` +
            `not work around it — run it where a TTY is available.`,
        ),
      );
    });
    child.on("close", (code) => {
      resolvePromise({ stdout, stderr, exitCode: code ?? 1 });
    });
    child.stdin.write(`${typed}\n`);
    child.stdin.end();
  });
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

/** True when the built runner exists and is newer than every src/*.ts file. */
function distIsFresh(): boolean {
  if (!existsSync(RUNNER)) {
    return false;
  }
  const distMtime = statSync(RUNNER).mtimeMs;
  const srcDir = join(ORCHESTRATOR_ROOT, "src");
  for (const file of readdirSync(srcDir)) {
    if (file.endsWith(".ts") && statSync(join(srcDir, file)).mtimeMs > distMtime) {
      return false;
    }
  }
  return true;
}

/**
 * Make sure the drive runner the test spawns (`dist/index.js`) exists
 * and is built from the current sources. A fresh gate worktree (APOS
 * #70) has no `dist/` (gitignored), and `npm test` does not build, so
 * the test builds it itself here. Parallel test files serialize on a
 * lock dir so two builds never write `dist/` over each other.
 */
async function ensureRunnerBuilt(log: (line: string) => void): Promise<void> {
  if (distIsFresh()) {
    return;
  }
  const lockDir = join(ORCHESTRATOR_ROOT, "dist", ".live-test-build.lock");
  const deadline = Date.now() + 120_000;
  mkdirSync(join(ORCHESTRATOR_ROOT, "dist"), { recursive: true });
  for (;;) {
    if (distIsFresh()) {
      return;
    }
    try {
      // Atomic acquire: plain mkdir throws EEXIST when another builder
      // already holds the lock.
      mkdirSync(lockDir);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") {
        throw error;
      }
      // A lock left behind by a crashed build (older than 2 minutes)
      // is stale: remove it and retry instead of waiting it out.
      try {
        if (Date.now() - statSync(lockDir).mtimeMs > 120_000) {
          rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        // The lock vanished between the calls; retry acquiring it.
        continue;
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        "live test: timed out waiting for another test file to build the drive runner",
      );
    }
    await sleep(500);
  }
  try {
    log("live test: building the drive runner (npm run build) — dist/ is missing or stale");
    await runOrThrow("npm run build", "npm", ["run", "build"], ORCHESTRATOR_ROOT);
    log("live test: drive runner built");
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
  if (!existsSync(RUNNER)) {
    throw new Error("live test: npm run build did not produce dist/index.js");
  }
}

interface DriveStep {
  action: string;
  packageId?: string | undefined;
  handoverCommit?: string | undefined;
  status?: string | undefined;
}

/**
 * One drive-runner invocation: `node dist/index.js --repo <projectDir>
 * --goal <id> --drive [--handover <value> ...]` (one bare SHA for Solo,
 * one `<pkg>:<sha>` per package for Multi-WP). The runner only prints
 * the next step; this test executes it. Returns the printed step action,
 * its package (when the runner prints one), the handover commit it
 * carries (if any) and the printed Goal status.
 */
async function drive(
  projectDir: string,
  scenario: string,
  handovers: readonly string[],
  log: (line: string) => void,
): Promise<DriveStep> {
  const args = ["--repo", projectDir, "--goal", LIVE_GOAL_ID, "--drive"];
  for (const handover of handovers) {
    args.push("--handover", handover);
  }
  log(`live: drive ${scenario}: node dist/index.js ${args.join(" ")}`);
  const out = await runCommand("node", [RUNNER, ...args], projectDir);
  log(`live: drive ${scenario} output:\n${(out.stdout + out.stderr).trim()}`);
  if (out.exitCode !== 0) {
    throw new Error(
      `live: drive runner failed for ${scenario} (exit ${out.exitCode}): ` +
        `${(out.stdout + out.stderr).trim().slice(0, 2000)}`,
    );
  }
  const stepMatch = /next step: ([a-z-]+)/.exec(out.stdout);
  if (stepMatch === null || stepMatch[1] === undefined) {
    throw new Error(
      `live: drive runner printed no next step for ${scenario}: ${out.stdout.slice(0, 1000)}`,
    );
  }
  const packageMatch = /package: ([A-Z][A-Z0-9-]*)/.exec(out.stdout);
  const handoverMatch = /handover commit: ([0-9a-f]+)/.exec(out.stdout);
  const statusMatch = /\(status: ([a-z-]+)\)/.exec(out.stdout);
  return {
    action: stepMatch[1],
    packageId: packageMatch?.[1],
    handoverCommit: handoverMatch?.[1],
    status: statusMatch?.[1],
  };
}

/**
 * Run `package submit` with a verified handover commit. Returns the
 * gate result ("green" | "red"). The runner reconciles the submitted
 * commit from the reader state on the next drive call, so the driver
 * keeps no handover record of its own.
 */
async function submitPackage(
  cli: string,
  projectDir: string,
  packageId: string,
  commit: string,
  log: (line: string) => void,
): Promise<string> {
  const out = await runCommand(
    "node",
    [cli, "--repo", projectDir, "package", "submit", LIVE_GOAL_ID, packageId, "--commit", commit, "--json"],
    projectDir,
  );
  const parsed = JSON.parse(out.stdout) as { result?: unknown; goalStatus?: unknown };
  const result = String(parsed.result ?? "?");
  log(`live: package-submit ${packageId} ${commit} -> ${result} (exit ${out.exitCode})`);
  if (out.exitCode === 0 && result === "green") {
    return "green";
  }
  if (result === "red") {
    log(`live: gate red for ${packageId} ${commit}; the driver asks the runner again for the fix step`);
    return "red";
  }
  throw new Error(
    `live: package submit did not go green or red (exit ${out.exitCode}): ` +
      `${(out.stdout + out.stderr).trim().slice(0, 2000)}`,
  );
}

/**
 * Build one sample APOS project and drive its real Goal from `selected`
 * to green ONLY through the drive runner. `wrongFirst` makes the first
 * Worker commit intentionally wrong (greet returns "hello"), so the
 * gate goes red once and the Worker must fix it.
 */
async function runScenario(
  name: string,
  wrongFirst: boolean,
  baseDir: string,
  cli: string,
  log: (line: string) => void,
): Promise<LiveScenarioResult> {
  const projectDir = join(baseDir, name, "sample");
  mkdirSync(projectDir, { recursive: true });
  const steps: string[] = [];
  log(`live test: scenario ${name} — projectDir=${projectDir}`);

  // --- Build the sample project (base commit: red test, code not yet fixed).
  writeFileSync(join(projectDir, "package.json"), SAMPLE_PACKAGE_JSON);
  writeFileSync(join(projectDir, "greet.mjs"), SAMPLE_GREET_BASE);
  writeFileSync(join(projectDir, "test.mjs"), SAMPLE_TEST);
  writeFileSync(join(projectDir, "brief.md"), SAMPLE_BRIEF);
  writeFileSync(join(projectDir, "goal.json"), sampleGoalJson());
  await runOrThrow("git init", "git", ["init", "-q"], projectDir);
  await runOrThrow(
    "git config",
    "git",
    ["config", "user.email", "live-test@example.com"],
    projectDir,
  );
  await runOrThrow("git config", "git", ["config", "user.name", "Live Test"], projectDir);
  await runOrThrow("git add", "git", ["add", "-A"], projectDir);
  await runOrThrow("git commit", "git", ["commit", "-qm", "base: sample project"], projectDir);
  const baseCommit = (await runCommand("git", ["rev-parse", "HEAD"], projectDir)).stdout.trim();
  const briefSha256 = createHash("sha256").update(SAMPLE_BRIEF).digest("hex");
  log(`live test: scenario ${name}: base commit ${baseCommit}`);
  await runApos(cli, projectDir, ["init"]);
  await runApos(cli, projectDir, [
    "goal",
    "create",
    "--file",
    "goal.json",
    "--source",
    "brief.md",
  ]);
  log(`live test: scenario ${name}: created ${LIVE_GOAL_ID} (draft)`);

  // --- Drive the real Goal ONLY through the subprocess drive runner.
  // The plan's baseCommit is set at lead-propose time (see below): it
  // must be HEAD after APOS's own auto-commits (init, goal-approved),
  // otherwise the delivery diff against the base would contain
  // APOS-managed .apos files and the gate would go red (APOS-PROTECTED).
  let pendingHandover: string | null = null;
  let verified = false;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const step = await drive(
      projectDir,
      name,
      pendingHandover !== null ? [pendingHandover] : [],
      log,
    );
    steps.push(step.action);
    log(`live: ${name}: ${step.status ?? "?"} -> ${step.action}`);
    if (step.action === "wait-human-approve") {
      // Pty provisioning (see the header note): the fixture Goal is
      // approved by typing its id back on the TTY.
      const out = await runAposPty(
        cli,
        projectDir,
        ["goal", "approve", LIVE_GOAL_ID, "--size", "S", "--max-minutes", "60", "--max-attempts", "3"],
        LIVE_GOAL_ID,
      );
      if (out.exitCode !== 0) {
        throw new Error(
          `pty goal approve failed (exit ${out.exitCode}): ${(out.stdout + out.stderr).trim().slice(0, 2000)}`,
        );
      }
      log(`live: ${name}: pty approved ${LIVE_GOAL_ID}`);
      continue;
    }
    if (step.action === "wait-human-select") {
      const out = await runAposPty(
        cli,
        projectDir,
        ["goal", "select", LIVE_GOAL_ID],
        LIVE_GOAL_ID,
      );
      if (out.exitCode !== 0) {
        throw new Error(
          `pty goal select failed (exit ${out.exitCode}): ${(out.stdout + out.stderr).trim().slice(0, 2000)}`,
        );
      }
      log(`live: ${name}: pty selected ${LIVE_GOAL_ID}`);
      continue;
    }
    if (step.action === "lead-propose") {
      // The plan starts from the current HEAD: APOS auto-commits its own
      // state (init, goal-approved) on top of the sample base commit, and
      // a baseCommit from before those commits would make the delivery
      // diff contain APOS-managed .apos files (gate red, APOS-PROTECTED).
      const planBase = (await runCommand("git", ["rev-parse", "HEAD"], projectDir)).stdout.trim();
      writeFileSync(
        join(projectDir, "execution.json"),
        sampleExecutionJson(planBase, briefSha256),
      );
      log(`live: ${name}: plan baseCommit ${planBase}`);
      await runApos(cli, projectDir, ["lead", "propose", "--file", "execution.json"]);
      steps.push("lead-commit");
      log(`live: ${name}: lead-propose done (execution.json proposed)`);
      await runApos(cli, projectDir, ["lead", "commit", LIVE_GOAL_ID]);
      log(`live: ${name}: lead-commit done (plan accepted, Goal executing)`);
      continue;
    }
    if (step.action === "worker-write-code" || step.action === "worker-fix") {
      // The worker step in this sample: apply the predetermined patch.
      // green-first writes the correct greet at once; red-then-green
      // writes the wrong greet first (gate goes red) and the fix only
      // on worker-fix. The loop's job here is proving the transition,
      // not an agent's reasoning. The commit SHA is handed to the next
      // drive call as --handover; the runner verifies it with git.
      let content: string;
      let message: string;
      if (step.action === "worker-fix") {
        content = `${SAMPLE_GREET_FIXED}\n// fix: keep the greeting exact\n`;
        message = "worker-fix: keep greeting exact";
      } else if (wrongFirst) {
        content = SAMPLE_GREET_WRONG;
        message = "worker: first attempt (wrong greeting)";
      } else {
        content = SAMPLE_GREET_FIXED;
        message = "worker: greet returns xin chào";
      }
      writeFileSync(join(projectDir, "greet.mjs"), content);
      await runOrThrow("git add", "git", ["add", "-A"], projectDir);
      await runOrThrow("git commit", "git", ["commit", "-qm", message], projectDir);
      const handover = (await runCommand("git", ["rev-parse", "HEAD"], projectDir)).stdout.trim();
      pendingHandover = handover;
      log(`live: ${name}: ${step.action} handed over ${handover} (next drive call passes it as --handover)`);
      continue;
    }
    if (step.action === "package-submit") {
      const commit = step.handoverCommit;
      if (commit === undefined) {
        // Already submitted and waiting on the gate outcome; ask the
        // runner again (the iteration cap guards against looping here).
        log(`live: ${name}: package-submit carries no handover commit (already submitted); asking the runner again`);
        continue;
      }
      await submitPackage(cli, projectDir, LIVE_PACKAGE_ID, commit, log);
      pendingHandover = null;
      continue;
    }
    if (step.action === "wait-human-close") {
      // Human gate: the loop stops here and does NOT close the Goal.
      verified = step.status === "verified";
      log(
        `live: ${name}: stopped at human gate wait-human-close (status ${step.status}); ` +
          "the loop does not close the Goal.",
      );
      break;
    }
    if (step.action === "done") {
      verified = step.status === "verified" || step.status === "closed";
      break;
    }
    throw new Error(`live: unexpected step ${step.action} in scenario ${name} — the driver cannot execute it`);
  }
  if (!verified) {
    throw new Error(
      `live test scenario ${name} did not reach verified (steps: ${steps.join(" -> ")}); ` +
        "see the log above for where it stopped",
    );
  }
  log(`live test: scenario ${name} ok — ${LIVE_GOAL_ID} verified via ${steps.join(" -> ")}`);
  return { name, steps, verified, projectDir };
}

/**
 * Build one sample Multi-WP APOS project and drive its real 2-package
 * Goal from `selected` to verified ONLY through the drive runner, with
 * per-package handovers (`--handover WP-A:<sha> --handover WP-B:<sha>`).
 * `wrongFirst` makes WP-A's first Worker commit intentionally wrong
 * (greetA returns "hello"), so its gate goes red once and the Worker
 * must fix it; WP-B is always correct on the first attempt.
 *
 * Branching: each package is developed on its own branch from the plan
 * base (`wp-a` / `wp-b`), so each submit's diff stays inside its own
 * package paths. On `integration-gate` the driver merges `wp-b` into
 * `wp-a` (a merge commit, never squash/rebase) and runs
 * `integration gate` on it, then `integration complete` when it is
 * green — the two halves of executing that one printed step.
 */
async function runMultiWpScenario(
  name: string,
  wrongFirst: boolean,
  baseDir: string,
  cli: string,
  log: (line: string) => void,
): Promise<LiveScenarioResult> {
  const projectDir = join(baseDir, name, "sample");
  mkdirSync(projectDir, { recursive: true });
  const steps: string[] = [];
  log(`live test: multi-wp scenario ${name} — projectDir=${projectDir}`);

  // --- Build the sample project (base commit: red tests, code not yet fixed).
  writeFileSync(join(projectDir, "package.json"), SAMPLE_MULTI_PACKAGE_JSON);
  writeFileSync(join(projectDir, "greet-a.mjs"), SAMPLE_GREET_A_BASE);
  writeFileSync(join(projectDir, "greet-b.mjs"), SAMPLE_GREET_B_BASE);
  writeFileSync(join(projectDir, "test-a.mjs"), SAMPLE_TEST_A);
  writeFileSync(join(projectDir, "test-b.mjs"), SAMPLE_TEST_B);
  writeFileSync(join(projectDir, "brief.md"), SAMPLE_MULTI_BRIEF);
  writeFileSync(join(projectDir, "goal.json"), sampleMultiGoalJson());
  await runOrThrow("git init", "git", ["init", "-q"], projectDir);
  await runOrThrow("git config", "git", ["config", "user.email", "live-test@example.com"], projectDir);
  await runOrThrow("git config", "git", ["config", "user.name", "Live Test"], projectDir);
  await runOrThrow("git add", "git", ["add", "-A"], projectDir);
  await runOrThrow("git commit", "git", ["commit", "-qm", "base: multi-wp sample project"], projectDir);
  const baseCommit = (await runCommand("git", ["rev-parse", "HEAD"], projectDir)).stdout.trim();
  const briefSha256 = createHash("sha256").update(SAMPLE_MULTI_BRIEF).digest("hex");
  log(`live test: multi-wp scenario ${name}: base commit ${baseCommit}`);
  await runApos(cli, projectDir, ["init"]);
  await runApos(cli, projectDir, ["goal", "create", "--file", "goal.json", "--source", "brief.md"]);
  log(`live test: multi-wp scenario ${name}: created ${LIVE_GOAL_ID} (draft)`);

  // --- Drive the real Goal ONLY through the subprocess drive runner.
  const pendingHandovers = new Map<string, string>();
  const greenCommits = new Map<string, string>();
  let planBase: string | null = null;
  let integrationCommit: string | null = null;
  let verified = false;
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const handovers = [...pendingHandovers.entries()].map(([pkg, sha]) => `${pkg}:${sha}`);
    const step = await drive(projectDir, name, handovers, log);
    steps.push(step.action);
    log(`live: multi-wp ${name}: ${step.status ?? "?"} -> ${step.action}${step.packageId ? ` (${step.packageId})` : ""}`);
    if (step.action === "wait-human-approve") {
      const out = await runAposPty(
        cli,
        projectDir,
        ["goal", "approve", LIVE_GOAL_ID, "--size", "S", "--max-minutes", "60", "--max-attempts", "3"],
        LIVE_GOAL_ID,
      );
      if (out.exitCode !== 0) {
        throw new Error(
          `pty goal approve failed (exit ${out.exitCode}): ${(out.stdout + out.stderr).trim().slice(0, 2000)}`,
        );
      }
      log(`live: multi-wp ${name}: pty approved ${LIVE_GOAL_ID}`);
      continue;
    }
    if (step.action === "wait-human-select") {
      const out = await runAposPty(cli, projectDir, ["goal", "select", LIVE_GOAL_ID], LIVE_GOAL_ID);
      if (out.exitCode !== 0) {
        throw new Error(
          `pty goal select failed (exit ${out.exitCode}): ${(out.stdout + out.stderr).trim().slice(0, 2000)}`,
        );
      }
      log(`live: multi-wp ${name}: pty selected ${LIVE_GOAL_ID}`);
      continue;
    }
    if (step.action === "lead-propose") {
      // The plan starts from the current HEAD (see the Solo scenario:
      // a baseCommit from before APOS's own auto-commits would make
      // the delivery diff contain APOS-managed .apos files).
      planBase = (await runCommand("git", ["rev-parse", "HEAD"], projectDir)).stdout.trim();
      writeFileSync(
        join(projectDir, "execution.json"),
        sampleMultiExecutionJson(planBase, briefSha256),
      );
      log(`live: multi-wp ${name}: plan baseCommit ${planBase}`);
      await runApos(cli, projectDir, ["lead", "propose", "--file", "execution.json"]);
      steps.push("lead-commit");
      log(`live: multi-wp ${name}: lead-propose done (execution.json proposed)`);
      for (const packageId of LIVE_MULTI_WP_PACKAGE_IDS) {
        const file = packageId === "WP-A" ? "package-a.json" : "package-b.json";
        writeFileSync(join(projectDir, file), sampleMultiPackageJson(packageId as "WP-A" | "WP-B"));
        await runApos(cli, projectDir, [
          "package",
          "add",
          "--file",
          file,
          "--reason",
          `package ${packageId} owns its greet function and check`,
        ]);
        log(`live: multi-wp ${name}: package add ${packageId} done`);
      }
      await runApos(cli, projectDir, ["lead", "commit", LIVE_GOAL_ID]);
      log(`live: multi-wp ${name}: lead-commit done (plan accepted, Goal executing)`);
      continue;
    }
    if (step.action === "worker-write-code" || step.action === "worker-fix") {
      // The worker step for one package: apply the predetermined patch
      // on that package's own branch from the plan base. The loop's job
      // here is proving the transition, not an agent's reasoning. The
      // commit SHA is handed to the next drive call as
      // --handover <pkg>:<sha>; the runner verifies it with git.
      const packageId = step.packageId;
      if (packageId !== "WP-A" && packageId !== "WP-B") {
        throw new Error(
          `live: multi-wp ${name}: ${step.action} carries no package (got ${packageId ?? "none"}) — the driver cannot tell which package to write`,
        );
      }
      if (planBase === null) {
        throw new Error(`live: multi-wp ${name}: worker step before the plan base was recorded`);
      }
      const isA = packageId === "WP-A";
      const branch = isA ? "wp-a" : "wp-b";
      const file = isA ? "greet-a.mjs" : "greet-b.mjs";
      let content: string;
      let message: string;
      if (step.action === "worker-fix") {
        content = `${isA ? SAMPLE_GREET_A_FIXED : SAMPLE_GREET_B_FIXED}\n// fix: keep the greeting exact\n`;
        message = `worker-fix: keep ${packageId} greeting exact`;
      } else if (wrongFirst && isA) {
        content = SAMPLE_GREET_A_WRONG;
        message = "worker: WP-A first attempt (wrong greeting)";
      } else {
        content = isA ? SAMPLE_GREET_A_FIXED : SAMPLE_GREET_B_FIXED;
        message = `worker: ${packageId} greet returns the right greeting`;
      }
      const branchExists = (await runCommand("git", ["show-ref", "--verify", `refs/heads/${branch}`], projectDir)).exitCode === 0;
      if (branchExists) {
        await runOrThrow("git checkout", "git", ["checkout", branch], projectDir);
      } else {
        await runOrThrow("git checkout", "git", ["checkout", "-b", branch, planBase], projectDir);
      }
      writeFileSync(join(projectDir, file), content);
      await runOrThrow("git add", "git", ["add", "-A"], projectDir);
      await runOrThrow("git commit", "git", ["commit", "-qm", message], projectDir);
      const handover = (await runCommand("git", ["rev-parse", "HEAD"], projectDir)).stdout.trim();
      pendingHandovers.set(packageId, handover);
      log(`live: multi-wp ${name}: ${step.action} ${packageId} handed over ${handover} (next drive call passes it as --handover ${packageId}:${handover})`);
      continue;
    }
    if (step.action === "package-submit") {
      const packageId = step.packageId;
      const commit = step.handoverCommit;
      if (packageId === undefined || commit === undefined) {
        // Already submitted and waiting on the gate outcome; ask the
        // runner again (the iteration cap guards against looping here).
        log(`live: multi-wp ${name}: package-submit carries no package/handover commit (already submitted); asking the runner again`);
        continue;
      }
      const result = await submitPackage(cli, projectDir, packageId, commit, log);
      pendingHandovers.delete(packageId);
      if (result === "green") {
        greenCommits.set(packageId, commit);
      }
      continue;
    }
    if (step.action === "integration-gate") {
      // Build the integration commit: a merge commit (never
      // squash/rebase) with both green package commits as ancestors.
      if (greenCommits.size !== LIVE_MULTI_WP_PACKAGE_IDS.length) {
        throw new Error(
          `live: multi-wp ${name}: integration-gate with only ${greenCommits.size} green packages — the driver cannot build the integration commit`,
        );
      }
      await runOrThrow("git checkout", "git", ["checkout", "wp-a"], projectDir);
      await runOrThrow(
        "git merge",
        "git",
        ["merge", "--no-ff", "wp-b", "-m", "integration: merge WP-A and WP-B"],
        projectDir,
      );
      integrationCommit = (await runCommand("git", ["rev-parse", "HEAD"], projectDir)).stdout.trim();
      // The merge commit must have both green commits as ancestors.
      for (const commit of greenCommits.values()) {
        const isAncestor = (await runCommand("git", ["merge-base", "--is-ancestor", commit, integrationCommit], projectDir)).exitCode === 0;
        if (!isAncestor) {
          throw new Error(`live: multi-wp ${name}: integration commit ${integrationCommit} does not contain green commit ${commit} as an ancestor`);
        }
      }
      log(`live: multi-wp ${name}: integration commit ${integrationCommit} (merge of ${[...greenCommits.values()].join(", ")})`);
      const gateOut = await runApos(cli, projectDir, [
        "integration",
        "gate",
        LIVE_GOAL_ID,
        "--commit",
        integrationCommit,
        "--reason",
        "merge of the two green package commits",
      ]);
      const gateText = gateOut.stdout + gateOut.stderr;
      log(`live: multi-wp ${name}: integration gate output: ${gateText.trim().slice(0, 1000)}`);
      if (!/Integration gate green/.test(gateText)) {
        throw new Error(`live: multi-wp ${name}: integration gate did not go green: ${gateText.trim().slice(0, 2000)}`);
      }
      // The gate went green, so the driver runs integration complete
      // in the same step (see the header note: the reader cannot
      // report the gate outcome).
      const completeOut = await runApos(cli, projectDir, [
        "integration",
        "complete",
        LIVE_GOAL_ID,
        "--commit",
        integrationCommit,
      ]);
      log(`live: multi-wp ${name}: integration complete output: ${(completeOut.stdout + completeOut.stderr).trim().slice(0, 1000)}`);
      continue;
    }
    if (step.action === "integration-complete") {
      if (integrationCommit === null) {
        throw new Error(`live: multi-wp ${name}: integration-complete with no integration commit built yet`);
      }
      await runApos(cli, projectDir, ["integration", "complete", LIVE_GOAL_ID, "--commit", integrationCommit]);
      log(`live: multi-wp ${name}: integration complete ${integrationCommit}`);
      continue;
    }
    if (step.action === "wait-human-close") {
      // Human gate: the loop stops here and does NOT close the Goal.
      verified = step.status === "verified";
      log(
        `live: multi-wp ${name}: stopped at human gate wait-human-close (status ${step.status}); ` +
          "the loop does not close the Goal.",
      );
      break;
    }
    if (step.action === "done") {
      verified = step.status === "verified" || step.status === "closed";
      break;
    }
    throw new Error(`live: multi-wp unexpected step ${step.action} in scenario ${name} — the driver cannot execute it`);
  }
  if (!verified) {
    throw new Error(
      `live test multi-wp scenario ${name} did not reach verified (steps: ${steps.join(" -> ")}); ` +
        "see the log above for where it stopped",
    );
  }
  log(`live test: multi-wp scenario ${name} ok — ${LIVE_GOAL_ID} verified via ${steps.join(" -> ")}`);
  return { name, steps, verified, projectDir };
}

/**
 * Build the sample APOS projects in `baseDir` and drive two real Goals
 * from `selected` to green ONLY through the drive runner, returning the
 * step sequences and the evidence log. Throws when a Goal does not
 * verify or a step the driver cannot execute appears.
 */
export async function runLiveTest(options?: {
  baseDir?: string;
}): Promise<LiveTestResult> {
  const cli = resolveAposCli();
  const baseDir =
    options?.baseDir ?? mkdtempSync(join(tmpdir(), "apos-orchestrator-live-"));

  const logLines: string[] = [];
  const log = (line: string): void => {
    logLines.push(line);
    console.log(line);
  };
  log(
    "live test: provisioning dùng một lần — Goal mẫu do chính test tạo " +
      "trong thư mục tạm; approve/select được xác nhận tương tác qua pty " +
      "(gõ lại ID trên TTY), không dùng --on-behalf, không sửa tay state " +
      ".apos/controller.",
  );
  log(`live test: baseDir=${baseDir}`);
  await ensureRunnerBuilt(log);

  const scenarios: LiveScenarioResult[] = [];
  const steps: string[] = [];
  scenarios.push(await runScenario("green-first", false, baseDir, cli, log));
  scenarios.push(await runScenario("red-then-green", true, baseDir, cli, log));
  for (const scenario of scenarios) {
    steps.push(...scenario.steps);
  }
  // Multi-WP (GOAL-004 AC-4): the same two paths, on a real 2-package
  // Goal, driven only by the subprocess drive runner with per-package
  // handovers. These run after the Solo scenarios and are reported in
  // `multiWpScenarios` (the Solo `scenarios` list keeps exactly
  // ["green-first", "red-then-green"] for GOAL-003).
  const multiWpScenarios: LiveScenarioResult[] = [];
  multiWpScenarios.push(await runMultiWpScenario("multi-wp-green-first", false, baseDir, cli, log));
  multiWpScenarios.push(await runMultiWpScenario("multi-wp-red-then-green", true, baseDir, cli, log));
  for (const scenario of multiWpScenarios) {
    steps.push(...scenario.steps);
  }
  const verified =
    scenarios.every((scenario) => scenario.verified) &&
    multiWpScenarios.every((scenario) => scenario.verified);
  const projectDir = scenarios[0]?.projectDir ?? join(baseDir, "green-first", "sample");
  log(`live test: ok — ${LIVE_GOAL_ID} verified in both Solo scenarios and both multi-wp scenarios via drive runner`);
  return {
    goalId: LIVE_GOAL_ID,
    projectDir,
    steps,
    verified,
    log: logLines.join("\n"),
    scenarios,
    multiWpScenarios,
  };
}

/** CLI entry for `npm run test:live` (see src/dry-run.ts for the pattern). */
export async function main(): Promise<void> {
  const result = await runLiveTest({});
  if (!result.verified) {
    throw new Error("live test did not reach verified");
  }
  console.log(`live test: ok — ${result.goalId} verified`);
}

// CLI guard: run `main()` only when this file is the script being run
// (`node dist/live-test.js`). Importing it (e.g. from tests) does nothing.
const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
