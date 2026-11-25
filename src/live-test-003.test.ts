// Acceptance tests for GOAL-003 AC-4 (live test, two scenarios) —
// through the public entry `runLiveTest` of src/live-test.ts only.
//
// Tester-defined contract (execution-003.json §3 fixes the behaviour
// but not the result shape; the Worker implements this exact shape):
// - `runLiveTest({ baseDir })` runs TWO sample scenarios back to back
//   in temp dirs, both driven ONLY by the subprocess runner in drive
//   mode (`node dist/index.js --repo … --goal … --drive
//   [--handover <sha>]`) — never by calling `recordHandover` /
//   `applyHandover` / `nextStep` / `readGoalState` directly, and never
//   by a hand-kept handover script.
//   (a) `green-first`: Worker commit đúng → drive --handover →
//   package-submit → verified ngay lần nộp đầu.
//   (b) `red-then-green`: Worker commit sai cố ý (greet trả "hello")
//   → gate đỏ → Worker fix commit mới → drive --handover <sha mới> →
//   package-submit → verified.
// - The result keeps the GOAL-002 fields (`goalId`, `projectDir`,
//   `steps`, `verified`, `log`) and gains `scenarios: [{ name, steps,
//   verified }]` with names `green-first` and `red-then-green` in that
//   order; `verified` is true only when both scenarios verify, and
//   `log` is the evidence log of the live runs (it names the drive
//   invocations).
// - The live run is slow (real CLI, real git, two real gates), so this
//   test gets a 10-minute timeout. The new `scenarios` field is read
//   through a cast so this test compiles against the current code and
//   fails on assertions (red for the right reason), not on load or
//   type errors.
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runLiveTest } from "./live-test.js";

interface LiveScenario {
  name: string;
  steps: string[];
  verified: boolean;
}

interface LiveTestResult003 {
  goalId: string;
  projectDir: string;
  steps: string[];
  verified: boolean;
  log: string;
  scenarios: LiveScenario[];
}

function orderedSubsequence(steps: string[], wanted: string[]): boolean {
  let cursor = -1;
  for (const action of wanted) {
    const at = steps.indexOf(action, cursor + 1);
    if (at === -1) return false;
    cursor = at;
  }
  return true;
}

function scenario(result: LiveTestResult003, name: string): LiveScenario {
  const found = result.scenarios.find((s) => s.name === name);
  expect(found).toBeDefined();
  return found as LiveScenario;
}

describe("AC-4 (GOAL-003): live test drives two real Goals only with the drive runner", () => {
  it("AC-4: live test is driven only by the subprocess runner in drive mode, never by direct loop calls", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./live-test.ts", import.meta.url)),
      "utf-8",
    );
    expect(source).not.toMatch(/from "\.\/loop\.js"/);
    expect(source).not.toMatch(/from "\.\/state-machine\.js"/);
    expect(source).not.toMatch(/from "\.\/state-reader\.js"/);
    expect(source).toContain("--drive");
    expect(source).toContain("dist/index.js");
  });

  it(
    "AC-4: live test runs green-first AND red-then-green, both to verified, only via the drive runner",
    async () => {
      const baseDir = mkdtempSync(join(tmpdir(), "apos-orchestrator-live-"));
      const result = (await runLiveTest({ baseDir })) as unknown as LiveTestResult003;
      expect(result.verified).toBe(true);
      expect(Array.isArray(result.scenarios)).toBe(true);
      expect(result.scenarios.map((s) => s.name)).toEqual(["green-first", "red-then-green"]);

      const greenFirst = scenario(result, "green-first");
      expect(greenFirst.verified).toBe(true);
      expect(
        orderedSubsequence(greenFirst.steps, ["lead-propose", "worker-write-code", "package-submit"]),
      ).toBe(true);

      const redThenGreen = scenario(result, "red-then-green");
      expect(redThenGreen.verified).toBe(true);
      expect(
        orderedSubsequence(redThenGreen.steps, [
          "lead-propose",
          "worker-write-code",
          "package-submit",
          "worker-fix",
          "package-submit",
        ]),
      ).toBe(true);

      // The evidence log records live drive runs (not a dry run, not a
      // hand-kept handover script).
      expect(result.log).toContain("--drive");
      expect(result.log).toContain("green-first");
      expect(result.log).toContain("red-then-green");
      expect(result.log).toContain("package-submit");
    },
    600_000,
  );
});
