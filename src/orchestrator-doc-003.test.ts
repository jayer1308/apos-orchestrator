// Acceptance tests for GOAL-003 AC-7 (ORCHESTRATOR.md) — the doc must
// describe drive mode, the --handover flag, how run state is kept, and
// the red path, and its state table must match the state machine
// (including the new red + verified-handover row). Same pattern as the
// GOAL-002 doc test: the doc is read from the repo root.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readDoc(): string {
  return readFileSync(fileURLToPath(new URL("../ORCHESTRATOR.md", import.meta.url)), "utf-8");
}

describe("AC-7 (GOAL-003): ORCHESTRATOR.md documents drive mode, --handover, run state and the red path", () => {
  it("AC-7: doc describes drive mode and the --handover flag", () => {
    const doc = readDoc();
    expect(doc).toContain("--drive");
    expect(doc).toContain("--handover");
    expect(doc).toContain("npm run live");
  });

  it("AC-7: doc describes how run state is kept — a state file outside the repo", () => {
    const doc = readDoc();
    expect(doc).toContain("drive-state");
    expect(doc).toContain(".apos-orchestrator");
    expect(doc.toLowerCase()).toMatch(/ngoài repo|không.*trong repo|outside the repo/);
  });

  it("AC-7: doc state table has the red + new verified handover row going to package-submit", () => {
    const doc = readDoc();
    const row = doc
      .split("\n")
      .find(
        (line) =>
          line.toLowerCase().includes("red") &&
          line.includes("package-submit") &&
          line.toLowerCase().includes("handover"),
      );
    expect(row).toBeDefined();
  });

  it("AC-7: doc state table still has red without a new handover going to worker-fix", () => {
    const doc = readDoc();
    const row = doc
      .split("\n")
      .find((line) => line.toLowerCase().includes("red") && line.includes("worker-fix"));
    expect(row).toBeDefined();
  });

  it("AC-7: doc no longer tells the loop to submit inside the fix step (old GOAL-002 convention is replaced by the machine rule)", () => {
    const doc = readDoc();
    expect(doc).not.toContain("fix first, submit the new commit after");
    expect(doc).not.toContain("submit ngay trong bước fix");
  });
});
