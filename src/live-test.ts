// Stub for the GOAL-002 live-test entry (declared in execution-002.json
// `stubPaths`). The real implementation arrives with the Worker: it builds
// its own sample APOS project in a temp dir and drives a real Goal from
// selected to green through the real loop. Until then every call raises
// "not implemented", so the AC-4 tests fail against this stub.
//
// `main()` itself never calls `process.exit`, so tests can call it
// directly; only the CLI guard at the bottom of this file sets the exit
// code when the file is run as a script (`node dist/live-test.js`).
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function runLiveTest(_options?: { baseDir?: string }): Promise<never> {
  throw new Error("not implemented");
}

/** CLI entry for `npm run test:live` (see src/dry-run.ts for the pattern). */
export function main(): never {
  throw new Error("not implemented");
}

// CLI guard: run `main()` only when this file is the script being run
// (`node dist/live-test.js`). Importing it (e.g. from tests) does nothing.
const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
