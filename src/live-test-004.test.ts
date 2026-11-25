// Acceptance tests for GOAL-004 AC-4 (live test, Multi-WP) and
// AC-7 (ORCHESTRATOR.md documents Multi-WP) — through the public
// entry `runLiveTest` of src/live-test.ts (source contract only) and
// by reading ORCHESTRATOR.md.
//
// AC-4 — why there is no full live run in this file: the live test
// itself (`npm run test:live`, CHK-4) drives TWO real sample Goals
// through the subprocess runner and takes minutes; vitest here pins
// the contract the Worker's script must satisfy, and the full run is
// the Worker's CHK-4 evidence, not a vitest case. The contract
// (execution-004.json §4):
// - `runLiveTest` builds its own sample APOS project with a real
//   Multi-WP Goal: 2 packages (WP-A / WP-B, independent files,
//   `package add` through the CLI) and drives it ONLY through the
//   subprocess drive runner (`node dist/index.js --repo … --goal …
//   --drive --handover <pkg>:<sha>`), never by direct loop /
//   state-machine / state-reader calls and never by a hand-kept
//   handover script.
// - It covers BOTH paths like Solo: green-first (green on the first
//   submit) and red-then-green (one package red once, then fixed) —
//   at least one package goes red-then-green — and it drives the
//   integration steps (`integration gate` / `integration complete`)
//   once every package is green, so the Goal verifies.
// - The sample packages are exported as `LIVE_MULTI_WP_PACKAGE_IDS
//   = ["WP-A", "WP-B"]`.
// `src/live-test.ts` is still the Solo-only script, so these tests
// are red for the right reason until the Worker extends it.
//
// AC-7 — the doc must describe the per-package state table, how the
// drive runner handles many packages (`--handover <pkg>:<sha>`,
// drive-state per package) and the integration gate, and its table
// must match the state machine tested in state-machine-004.test.ts.
// ORCHESTRATOR.md still describes Solo only ("không Multi-WP"), so
// these tests are red for the right reason until the Worker updates it.
//
// Placement note: WP-DRIVE lists no separate doc test file in its
// `paths`, so the AC-7 doc tests live in this file, inside the
// package's paths, rather than in a new out-of-scope file.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as liveTestModule from "./live-test.js";

function readLiveTestSource(): string {
  return readFileSync(fileURLToPath(new URL("./live-test.ts", import.meta.url)), "utf-8");
}

function readDoc(): string {
  return readFileSync(fileURLToPath(new URL("../ORCHESTRATOR.md", import.meta.url)), "utf-8");
}

describe("AC-4 (GOAL-004): live test drives a real 2-package Goal only with the drive runner", () => {
  it("AC-4: live test builds a sample Goal with 2 packages, WP-A and WP-B, via `package add`", () => {
    const source = readLiveTestSource();
    expect(source).toContain("WP-A");
    expect(source).toContain("WP-B");
    expect(source).toContain("package add");
  });

  it("AC-4: live test drives only through the subprocess drive runner, with a per-package --handover", () => {
    const source = readLiveTestSource();
    expect(source).toContain("--drive");
    expect(source).toContain("dist/index.js");
    expect(source).toMatch(/WP-[AB]:/);
    expect(source).not.toMatch(/from "\.\/loop\.js"/);
    expect(source).not.toMatch(/from "\.\/state-machine\.js"/);
    expect(source).not.toMatch(/from "\.\/state-reader\.js"/);
  });

  it("AC-4: live test drives the integration steps once every package is green", () => {
    const source = readLiveTestSource();
    expect(source).toContain("integration-gate");
    expect(source).toContain("integration-complete");
    expect(source).toMatch(/integration gate/);
    expect(source).toMatch(/integration complete/);
  });

  it("AC-4: live test covers both paths for Multi-WP — green-first and red-then-green", () => {
    const source = readLiveTestSource();
    expect(source.toLowerCase()).toContain("multi-wp");
    expect(source).toContain("green-first");
    expect(source).toContain("red-then-green");
  });

  it("AC-4: the sample Multi-WP packages are exported as LIVE_MULTI_WP_PACKAGE_IDS", () => {
    const mod = liveTestModule as unknown as Record<string, unknown>;
    expect(mod["LIVE_MULTI_WP_PACKAGE_IDS"]).toEqual(["WP-A", "WP-B"]);
  });
});

describe("AC-7 (GOAL-004): ORCHESTRATOR.md documents Multi-WP, drive per package and the integration gate", () => {
  it("AC-7: doc has a per-package state table (WP-A / WP-B, theo từng package)", () => {
    const doc = readDoc();
    expect(doc).toContain("WP-A");
    expect(doc).toContain("WP-B");
    expect(doc.toLowerCase()).toContain("theo từng package");
  });

  it("AC-7: doc describes drive per package and the integration gate", () => {
    const doc = readDoc();
    expect(doc).toContain("--handover");
    expect(doc).toMatch(/--handover.*<pkg>:<sha>|<pkg>:<sha>/);
    expect(doc).toContain("drive-state");
    expect(doc).toContain("integration-gate");
    expect(doc).toContain("integration-complete");
    expect(doc).toMatch(/integration gate/);
    expect(doc).toMatch(/integration complete/);
  });

  it("AC-7: doc state table matches the tested machine — code-ready submits, red fixes, all-green integrates", () => {
    const doc = readDoc();
    const lines = doc.split("\n");
    const hasRow = (a: string, b: string): boolean =>
      lines.some((line) => line.toLowerCase().includes(a) && line.includes(b));
    expect(hasRow("code-ready", "package-submit")).toBe(true);
    expect(hasRow("red", "worker-fix")).toBe(true);
    expect(hasRow("green", "integration-gate")).toBe(true);
    expect(hasRow("integration", "integration-complete")).toBe(true);
  });

  it("AC-7: doc no longer claims the loop is Solo-only (the old 'không Multi-WP' scope is gone)", () => {
    const doc = readDoc();
    expect(doc).not.toContain("không Multi-WP");
  });
});
