// Live test for GOAL-002 AC-4 (CHK-4): builds its own sample APOS
// project in a temp dir and drives a real Goal from `selected` to green
// through the real loop (`readGoalState` + `nextStep` + the handover
// record in `loop.ts`), asserting the step sequence including
// worker-write-code -> package-submit.
//
// Self-contained on purpose: each gate check runs in a fresh worktree
// (APOS #70), so this entry must not depend on any repo outside the temp
// dir it builds — only the APOS CLI (resolved like the state reader
// does) and git. The sample project needs no dependencies: its only
// check is `npm test`, which runs plain `node test.mjs`.
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
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAposCli } from "./apos-cli.js";
import {
  applyHandover,
  consumeHandover,
  createRunState,
  markRed,
  recordHandover,
  verifyHandover,
} from "./loop.js";
import { nextStep } from "./state-machine.js";
import { readGoalState } from "./state-reader.js";

export const LIVE_GOAL_ID = "GOAL-001";
export const LIVE_PACKAGE_ID = "WP-MAIN";

export interface LiveTestResult {
  goalId: string;
  projectDir: string;
  steps: string[];
  verified: boolean;
  log: string;
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

/**
 * Build the sample APOS project in `baseDir` and drive one real Goal
 * from `selected` to green through the real loop, returning the step
 * sequence and the evidence log. Throws when the Goal does not verify
 * or a step the driver cannot execute appears.
 */
export async function runLiveTest(options?: {
  baseDir?: string;
}): Promise<LiveTestResult> {
  const cli = resolveAposCli();
  const baseDir =
    options?.baseDir ?? mkdtempSync(join(tmpdir(), "apos-orchestrator-live-"));
  const projectDir = join(baseDir, "sample");
  mkdirSync(projectDir, { recursive: true });

  const logLines: string[] = [];
  const steps: string[] = [];
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
  log(`live test: projectDir=${projectDir}`);

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
  log(`live test: base commit ${baseCommit}`);
  await runApos(cli, projectDir, ["init"]);
  await runApos(cli, projectDir, [
    "goal",
    "create",
    "--file",
    "goal.json",
    "--source",
    "brief.md",
  ]);
  log(`live test: created ${LIVE_GOAL_ID} (draft)`);

  // --- Drive the real loop: read real state -> nextStep -> execute the step.
  // The plan's baseCommit is set at lead-propose time (see below): it
  // must be HEAD after APOS's own auto-commits (init, goal-approved),
  // otherwise the delivery diff against the base would contain
  // APOS-managed .apos files and the gate would go red (APOS-PROTECTED).
  const runState = createRunState();
  let verified = false;

  /**
   * Run `package submit` with a verified handover commit and consume the
   * handover (the commit is never submitted twice, whatever the gate
   * said). Returns the gate result ("green" | "red" | other).
   */
  const submitHandover = async (commit: string): Promise<string> => {
    const out = await runCommand(
      "node",
      [cli, "--repo", projectDir, "package", "submit", LIVE_GOAL_ID, LIVE_PACKAGE_ID, "--commit", commit, "--json"],
      projectDir,
    );
    consumeHandover(runState, commit);
    const parsed = JSON.parse(out.stdout) as { result?: unknown; goalStatus?: unknown };
    const result = String(parsed.result ?? "?");
    log(`live: package-submit ${commit} -> ${result} (exit ${out.exitCode})`);
    if (out.exitCode === 0 && result === "green") {
      return "green";
    }
    if (result === "red") {
      markRed(runState, commit);
      log(`live: gate red for ${commit}; loop goes back to worker-fix`);
      return "red";
    }
    throw new Error(
      `live: package submit did not go green or red (exit ${out.exitCode}): ` +
        `${(out.stdout + out.stderr).trim().slice(0, 2000)}`,
    );
  };
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const rawState = await readGoalState(projectDir, LIVE_GOAL_ID);
    const state = applyHandover(rawState, runState);
    const step = nextStep(state);
    steps.push(step.action);
    log(
      `live: ${state.status} / package ${state.packageStatus} / ` +
        `attempts ${state.attemptsUsed}/${state.attemptsMax} -> ${step.action} — ${step.reason}`,
    );
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
      log(`live: pty approved ${LIVE_GOAL_ID}`);
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
      log(`live: pty selected ${LIVE_GOAL_ID}`);
      continue;
    }
    if (step.action === "lead-propose") {
      // The plan starts from the current HEAD: APOS auto-commits its own
      // state (init, goal-approved) on top of the sample base commit, and
      // a baseCommit from before those commits would make the delivery
      // diff contain APOS-managed .apos files (gate red, APOS-PROTECTED).
      const planBase = (await runCommand("git", ["rev-parse", "HEAD"], projectDir)).stdout.trim();
      runState.baseCommit = planBase;
      writeFileSync(
        join(projectDir, "execution.json"),
        sampleExecutionJson(planBase, briefSha256),
      );
      log(`live: plan baseCommit ${planBase}`);
      await runApos(cli, projectDir, ["lead", "propose", "--file", "execution.json"]);
      steps.push("lead-commit");
      log("live: lead-propose done (execution.json proposed)");
      await runApos(cli, projectDir, ["lead", "commit", LIVE_GOAL_ID]);
      log("live: lead-commit done (plan accepted, Goal executing)");
      continue;
    }
    if (step.action === "worker-write-code" || step.action === "worker-fix") {
      // The worker step in this sample: apply the predetermined patch
      // (worker-write-code) or, after a red gate, a new commit on top
      // (worker-fix) — the loop's job here is proving the transition,
      // not an agent's reasoning.
      if (step.action === "worker-fix") {
        writeFileSync(
          join(projectDir, "greet.mjs"),
          `${SAMPLE_GREET_FIXED}\n// fix: keep the greeting exact\n`,
        );
      } else {
        writeFileSync(join(projectDir, "greet.mjs"), SAMPLE_GREET_FIXED);
      }
      await runOrThrow("git add", "git", ["add", "-A"], projectDir);
      await runOrThrow(
        "git commit",
        "git",
        ["commit", "-qm", step.action === "worker-fix" ? "worker-fix: keep greeting exact" : "worker: greet returns xin chào"],
        projectDir,
      );
      const handover = (await runCommand("git", ["rev-parse", "HEAD"], projectDir)).stdout.trim();
      recordHandover(runState, handover);
      const verification = await verifyHandover(runState, projectDir);
      log(`live: ${step.action} handed over ${handover} — ${verification.reason}`);
      if (!verification.verified) {
        throw new Error(`live: handover verification failed: ${verification.reason}`);
      }
      if (step.action === "worker-fix") {
        // The machine answers worker-fix while the package is still red
        // even with a NEW handover ("fix first, submit the new commit
        // after"): the fix step's completion IS the new handover, so
        // the loop submits it now instead of asking for another fix
        // (re-reading would answer worker-fix again — the red outcome
        // only changes after a submit). This keeps the red path from
        // stalling the same way the code-ready path used to.
        steps.push("package-submit");
        await submitHandover(handover);
      }
      continue;
    }
    if (step.action === "package-submit") {
      const commit = step.handoverCommit;
      if (commit === undefined) {
        throw new Error("live: package-submit step carries no handover commit");
      }
      await submitHandover(commit);
      continue;
    }
    if (step.action === "wait-human-close") {
      // Human gate: the loop stops here and does NOT close the Goal.
      verified = state.status === "verified";
      log(
        `live: stopped at human gate wait-human-close (status ${state.status}); ` +
          "the loop does not close the Goal.",
      );
      break;
    }
    if (step.action === "done") {
      verified = state.status === "verified" || state.status === "closed";
      break;
    }
    throw new Error(`live: unexpected step ${step.action} — the driver cannot execute it`);
  }
  if (!verified) {
    throw new Error(
      `live test did not reach verified (steps: ${steps.join(" -> ")}); ` +
        "see the log above for where it stopped",
    );
  }
  log(`live test: ok — ${LIVE_GOAL_ID} verified via ${steps.join(" -> ")}`);
  return { goalId: LIVE_GOAL_ID, projectDir, steps, verified, log: logLines.join("\n") };
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
