// Acceptance tests for GOAL-002 AC-7 (ORCHESTRATOR.md) — the doc must
// describe the code-ready signal, the live runner and appetite reading,
// and its state table must match the state machine (including the new
// code-ready rows). Same pattern as the GOAL-001 doc test: the doc is
// read from the repo root.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nextStep, type GoalState } from "./state-machine.js";

function readDoc(): string {
  return readFileSync(fileURLToPath(new URL("../ORCHESTRATOR.md", import.meta.url)), "utf-8");
}

const HANDOVER = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";

function state(overrides: Record<string, unknown> = {}): GoalState {
  return {
    goalId: "GOAL-002",
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
    ...overrides,
  } as unknown as GoalState;
}

describe("AC-7 (GOAL-002): ORCHESTRATOR.md documents code-ready, the live runner and appetite", () => {
  it("AC-7: doc describes the code-ready signal and the handover commit", () => {
    const doc = readDoc();
    expect(doc.toLowerCase()).toContain("code-ready");
    expect(doc.toLowerCase()).toContain("handover");
  });

  it("AC-7: doc describes the live runner (npm run live -- --repo <project> --goal <id>)", () => {
    const doc = readDoc();
    expect(doc).toContain("npm run live");
    expect(doc).toContain("--repo");
    expect(doc).toContain("--goal");
  });

  it("AC-7: doc describes appetite reading and the default 3", () => {
    const doc = readDoc();
    expect(doc.toLowerCase()).toContain("appetite");
    expect(doc).toContain("3");
    expect(doc.toLowerCase()).toMatch(/mặc định|default/);
  });

  it("AC-7: doc state table shows code-ready -> package-submit, matching the machine", () => {
    const doc = readDoc();
    const lines = doc.split("\n");
    expect(
      nextStep(state({ codeReady: true, handoverCommit: HANDOVER })).action,
    ).toBe("package-submit");
    expect(
      lines.some(
        (line) =>
          line.toLowerCase().includes("code-ready") && line.includes("package-submit"),
      ),
    ).toBe(true);
  });

  it("AC-7: doc state table shows no handover -> worker-write-code, matching the machine", () => {
    const doc = readDoc();
    const lines = doc.split("\n");
    expect(
      nextStep(state({ codeReady: false, handoverCommit: null })).action,
    ).toBe("worker-write-code");
    expect(
      lines.some(
        (line) =>
          (line.toLowerCase().includes("code-ready") ||
            line.includes("bàn giao") ||
            line.toLowerCase().includes("handover")) &&
          line.includes("worker-write-code"),
      ),
    ).toBe(true);
  });
});
