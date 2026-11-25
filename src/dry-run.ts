// CLI entry for the dry run (`npm run dry-run`): prints the Solo step
// sequence from `runDryRun()` and exits 0 when the sequence is the
// expected one and no human-gated command was attempted. Exits non-zero
// (throws) otherwise.
//
// `main()` itself never calls `process.exit`, so tests can call it
// directly; only the CLI guard at the bottom of this file sets the exit
// code when the file is run as a script (`node dist/dry-run.js`).

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDryRun, type DryRunScenarioName } from "./loop.js";

/** The expected Solo step sequence of each dry-run scenario. */
const EXPECTED_SEQUENCES: Record<DryRunScenarioName, readonly string[]> = {
  "with-setup": ["lead-propose", "lead-commit", "tests-submit", "package-submit", "wait-human-close"],
  "without-setup": [
    "lead-propose",
    "lead-commit",
    "worker-write-code",
    "package-submit",
    "wait-human-close",
  ],
  "red-gate": [
    "lead-propose",
    "lead-commit",
    "worker-write-code",
    "package-submit",
    "worker-fix",
    "package-submit",
    "report-human-blocked",
  ],
};

/** Run the dry run and print its step sequence. Throws on any failure. */
export function main(): void {
  const result = runDryRun();
  if (result.humanGatedAttempted) {
    throw new Error("dry run attempted a human-gated command");
  }
  for (const scenario of result.scenarios) {
    if (scenario.humanGatedAttempted) {
      throw new Error(`dry run scenario "${scenario.name}" attempted a human-gated command`);
    }
    const expected = EXPECTED_SEQUENCES[scenario.name];
    const actual = scenario.steps.map((step) => step.action);
    if (actual.length !== expected.length || actual.some((action, i) => action !== expected[i])) {
      throw new Error(
        `dry run scenario "${scenario.name}" gave an unexpected step sequence: ` +
          `${actual.join(" -> ")} (expected ${expected.join(" -> ")})`,
      );
    }
    console.log(`dry run: ${scenario.name}`);
    scenario.steps.forEach((step, i) => {
      console.log(`  ${i + 1}. ${step.action} — ${step.reason}`);
    });
  }
  console.log("dry run: ok — no human-gated command attempted");
}

// CLI guard: run `main()` only when this file is the script being run
// (`node dist/dry-run.js`). Importing it (e.g. from tests) does nothing.
const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
