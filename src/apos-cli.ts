// Shared APOS CLI resolution, used by the state reader
// (src/state-reader.ts) and the live test (src/live-test.ts).
//
// The APOS CLI is an environment prerequisite, like git and node: the
// orchestrator shells out to it, it is not bundled with this repo.
// Every gate check runs in a fresh worktree (APOS #70), so resolution
// must NOT depend on where this repo happens to be checked out — a
// sibling-only lookup fails in a worktree that is not next to the APOS
// repo. Search order:
//
//   (a) $APOS_CLI when set (returned as-is: an explicit user choice);
//   (b) sibling ../apos/dist/cli.js relative to this repo;
//   (c) $HOME/workspace/apos/dist/cli.js (the layout on this machine);
//   (d) an executable `apos` on PATH that runs under node
//       (a .js file, or a script with a node shebang);
//   (e) otherwise a clear error listing every location tried.
//
// Set APOS_CLI to point at the CLI entry point, e.g.
// APOS_CLI=~/workspace/apos/dist/cli.js
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Overrides for testing the search without moving this repo. */
export interface AposCliSearchOptions {
  /**
   * Directory of this module (defaults to the module's own directory).
   * The sibling candidate is resolved two levels up from here, so in
   * both `src/` (vitest) and `dist/` (built) it is the parent of the
   * repo root.
   */
  moduleDir?: string;
  /** Home directory (defaults to `os.homedir()`). */
  homeDir?: string;
  /** PATH value to search (defaults to `process.env.PATH`). */
  pathEnv?: string;
}

/** The two file candidates, in search order (sibling, then $HOME). */
export function aposCliCandidates(options?: AposCliSearchOptions): {
  sibling: string;
  home: string;
} {
  const moduleDir =
    options?.moduleDir ?? dirname(fileURLToPath(import.meta.url));
  const homeDir = options?.homeDir ?? homedir();
  return {
    sibling: resolve(moduleDir, "..", "..", "apos", "dist", "cli.js"),
    home: resolve(homeDir, "workspace", "apos", "dist", "cli.js"),
  };
}

/**
 * A PATH candidate is usable only when it can run under `node`, because
 * callers invoke the CLI as `node <cli> ...`. That means an executable
 * `.js`/`.mjs`/`.cjs` file, or an executable script whose shebang names
 * node. A shell wrapper (or any other non-node executable) is skipped,
 * not returned: `node` on it would fail with a confusing syntax error.
 */
function isRunnableNodeCli(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
  } catch {
    return false;
  }
  if (
    candidate.endsWith(".js") ||
    candidate.endsWith(".mjs") ||
    candidate.endsWith(".cjs")
  ) {
    return true;
  }
  try {
    const firstLine =
      readFileSync(candidate, "utf-8").split("\n")[0] ?? "";
    return firstLine.startsWith("#!") && firstLine.includes("node");
  } catch {
    return false;
  }
}

/** First runnable `apos` on PATH, or `undefined` when there is none. */
function findOnPath(pathEnv: string | undefined): string | undefined {
  if (pathEnv === undefined || pathEnv === "") {
    return undefined;
  }
  for (const dir of pathEnv.split(delimiter)) {
    if (dir === "") {
      continue;
    }
    const candidate = resolve(dir, "apos");
    if (existsSync(candidate) && isRunnableNodeCli(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Resolve the APOS CLI entry point. See the header note for the search
 * order. Throws a descriptive error (naming every location tried) when
 * no CLI is found, instead of failing later with a bare spawn error.
 */
export function resolveAposCli(options?: AposCliSearchOptions): string {
  const fromEnv = process.env["APOS_CLI"];
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  const { sibling, home } = aposCliCandidates(options);
  if (existsSync(sibling)) {
    return sibling;
  }
  if (existsSync(home)) {
    return home;
  }
  const onPath = findOnPath(
    options?.pathEnv ?? process.env["PATH"],
  );
  if (onPath !== undefined) {
    return onPath;
  }
  throw new Error(
    "Could not find the APOS CLI: set APOS_CLI to the CLI entry point " +
      "(e.g. ~/workspace/apos/dist/cli.js). Tried: " +
      `${sibling}, ${home}, and an executable \`apos\` on PATH ` +
      "(none found that runs under node). The APOS CLI must be installed " +
      "on this machine (like git and node) for the state reader and the " +
      "live test to run.",
  );
}
