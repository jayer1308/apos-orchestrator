// Acceptance tests for GOAL-002 AC-4 (live test) — through the public
// entry `runLiveTest` of src/live-test.ts only (stub: raises
// "not implemented" until the Worker implements it).
//
// Tester-defined contract (execution-002.json fixes the behaviour but not
// the signature; the Worker implements this exact signature):
// - `runLiveTest({ baseDir })` builds its own sample APOS project inside
//   `baseDir` (a fresh temp dir per run — self-contained, because each
//   gate check runs in a fresh worktree, APOS #70) and drives one real
//   Goal from `selected` to green through the real loop, returning
//   `{ goalId, projectDir, steps, verified, log }` where `steps` is the
//   step-action sequence in order and `log` is the evidence log of the
//   live run.
// - The test itself never runs a human-gated command and never passes
//   --on-behalf: getting the sample Goal to `selected` is the
//   implementation's problem (see the APOS finding in the test report:
//   `goal approve`/`goal select` need a human typing the subject back on
//   a TTY or an explicit --on-behalf delegation, and neither is available
//   to a test).
// - The live run is slow (real CLI, real git, real gate), so these tests
//   get a 10-minute timeout each.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runLiveTest } from "./live-test.js";

interface LiveTestResult {
  goalId: string;
  projectDir: string;
  steps: string[];
  verified: boolean;
  log: string;
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

describe("AC-4 (GOAL-002): live test drives a real Goal from selected to green", () => {
  it("AC-4: npm run test:live exists and runs the live-test entry", () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8"),
    ) as { scripts?: Record<string, string> };
    expect(pkg.scripts?.["test:live"]).toBeDefined();
    expect(pkg.scripts?.["test:live"]).toContain("live-test");
  });

  it(
    "AC-4: live test drives a real Goal through worker-write-code -> package-submit to green",
    async () => {
      const baseDir = mkdtempSync(join(tmpdir(), "apos-orchestrator-live-"));
      const result: LiveTestResult = await runLiveTest({ baseDir });
      expect(result.goalId.trim().length).toBeGreaterThan(0);
      expect(result.verified).toBe(true);
      expect(
        orderedSubsequence(result.steps, [
          "lead-propose",
          "worker-write-code",
          "package-submit",
        ]),
      ).toBe(true);
      // The evidence log records the live run (not a dry run).
      expect(result.log).toContain("worker-write-code");
      expect(result.log).toContain("package-submit");
    },
    600_000,
  );

  it(
    "AC-4: live test is self-contained — it builds its sample project inside the given temp dir",
    async () => {
      const baseDir = mkdtempSync(join(tmpdir(), "apos-orchestrator-live-"));
      const result: LiveTestResult = await runLiveTest({ baseDir });
      expect(result.projectDir.startsWith(baseDir)).toBe(true);
      expect(result.verified).toBe(true);
    },
    600_000,
  );
});
