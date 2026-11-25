// Tests for the shared APOS CLI resolution (src/apos-cli.ts).
//
// The gate runs each check in a fresh worktree (APOS #70), where the
// sibling ../apos/dist/cli.js does not exist — so the resolver must
// find the CLI through $HOME or PATH instead, and must say clearly
// where it looked when it cannot find one. These tests drive the
// resolver with temp dirs (via its search options) so they pass
// wherever the repo is checked out, including a fresh worktree.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aposCliCandidates, resolveAposCli } from "./apos-cli.js";

const SAVED_ENV = { ...process.env };

function makeCliFile(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "#!/usr/bin/env node\nconsole.log('fake apos');\n");
}

describe("resolveAposCli (shared CLI resolution)", () => {
  beforeEach(() => {
    delete process.env["APOS_CLI"];
  });

  afterEach(() => {
    process.env = { ...SAVED_ENV };
  });

  it("$APOS_CLI wins when set, returned as-is (explicit user choice)", () => {
    process.env["APOS_CLI"] = "/some/explicit/cli.js";
    expect(
      resolveAposCli({ moduleDir: "/tmp/no-such-dir", homeDir: "/tmp/no-such-home", pathEnv: "" }),
    ).toBe("/some/explicit/cli.js");
  });

  it("sibling wins over the $HOME fallback when both exist", () => {
    const root = mkdtempSync(join(tmpdir(), "apos-cli-sibling-"));
    const moduleDir = join(root, "repo", "src");
    const siblingCli = join(root, "apos", "dist", "cli.js");
    const homeCli = join(root, "home", "workspace", "apos", "dist", "cli.js");
    makeCliFile(siblingCli);
    makeCliFile(homeCli);
    expect(
      resolveAposCli({ moduleDir, homeDir: join(root, "home"), pathEnv: "" }),
    ).toBe(siblingCli);
  });

  it("finds the CLI through the $HOME fallback when no sibling exists", () => {
    const root = mkdtempSync(join(tmpdir(), "apos-cli-home-"));
    const moduleDir = join(root, "repo", "src");
    const homeCli = join(root, "home", "workspace", "apos", "dist", "cli.js");
    makeCliFile(homeCli);
    // No <root>/apos/dist/cli.js is created: this is the fresh-worktree
    // case (APOS #70), where the sibling lookup must not be the only path.
    expect(existsSync(join(root, "apos", "dist", "cli.js"))).toBe(false);
    expect(
      resolveAposCli({ moduleDir, homeDir: join(root, "home"), pathEnv: "" }),
    ).toBe(homeCli);
  });

  it("finds a runnable `apos` on PATH when neither file candidate exists", () => {
    const root = mkdtempSync(join(tmpdir(), "apos-cli-path-"));
    const moduleDir = join(root, "repo", "src");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const aposOnPath = join(bin, "apos");
    writeFileSync(aposOnPath, "#!/usr/bin/env node\nconsole.log('fake apos');\n");
    chmodSync(aposOnPath, 0o755);
    expect(
      resolveAposCli({ moduleDir, homeDir: join(root, "home"), pathEnv: bin }),
    ).toBe(aposOnPath);
  });

  it("skips a PATH `apos` that cannot run under node (e.g. a shell wrapper)", () => {
    const root = mkdtempSync(join(tmpdir(), "apos-cli-path-skip-"));
    const moduleDir = join(root, "repo", "src");
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const aposOnPath = join(bin, "apos");
    writeFileSync(aposOnPath, "#!/bin/sh\necho fake apos\n");
    chmodSync(aposOnPath, 0o755);
    expect(() =>
      resolveAposCli({ moduleDir, homeDir: join(root, "home"), pathEnv: bin }),
    ).toThrow(/Could not find the APOS CLI/);
  });

  it("errors clearly when no CLI is found, naming every location tried", () => {
    const root = mkdtempSync(join(tmpdir(), "apos-cli-none-"));
    const moduleDir = join(root, "repo", "src");
    const homeDir = join(root, "home");
    const { sibling, home } = aposCliCandidates({ moduleDir, homeDir });
    let message = "";
    try {
      resolveAposCli({ moduleDir, homeDir, pathEnv: "" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("Could not find the APOS CLI");
    expect(message).toContain("APOS_CLI");
    expect(message).toContain(sibling);
    expect(message).toContain(home);
    expect(message).toContain("PATH");
  });
});
