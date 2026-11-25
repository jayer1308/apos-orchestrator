// Acceptance tests for AC-5 / AC-3 through the dry-run CLI entry
// (`main` in src/dry-run.ts): it prints the Solo step sequence and never
// attempts a human-gated command.
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./dry-run.js";

/** The fourteen human-only commands from R-4; none may appear in dry-run output. */
const R4_HUMAN_GATED_COMMANDS = [
  "goal approve",
  "goal appetite",
  "goal select",
  "outcome close",
  "outcome revise",
  "outcome stop",
  "gate confirm",
  "gate run --base",
  "blocker resolve",
  "setup approve",
  "exception approve --human",
  "bug approve",
  "maintenance approve",
  "hotfix",
] as const;

const EXPECTED_SEQUENCE = [
  "lead-propose",
  "lead-commit",
  "tests-submit",
  "package-submit",
  "wait-human-close",
];

afterEach(() => {
  vi.restoreAllMocks();
});

function printedOutput(): string {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    main();
  } finally {
    // Keep the spy's calls readable even if main throws.
  }
  const lines = spy.mock.calls.map((call) => call.map(String).join(" "));
  spy.mockRestore();
  return lines.join("\n");
}

describe("AC-5: dry-run entry prints the Solo step sequence", () => {
  it("AC-5: dry-run entry prints the Solo step sequence and finishes cleanly", () => {
    const output = printedOutput();
    let cursor = -1;
    for (const action of EXPECTED_SEQUENCE) {
      const at = output.indexOf(action, cursor + 1);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(output).toContain("wait-human-close");
  });

  it("AC-3: dry-run entry prints no human-gated command", () => {
    const output = printedOutput();
    for (const command of R4_HUMAN_GATED_COMMANDS) {
      expect(output).not.toContain(command);
    }
  });
});
