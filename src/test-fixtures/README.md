# Test fixtures: recorded APOS CLI output

Recorded 2026-11-25 from the real APOS CLI
(`node ~/workspace/apos/dist/cli.js --repo ~/workspace/apos-orchestrator …`)
against this repo, GOAL-001 in state `executing`, no setup pinned.
Tests feed these bytes to `readGoalState` through a fake `CliExecutor`,
so they never depend on live controller state.

## Recorded verbatim

| File | Command |
|---|---|
| `inbox.json` | `inbox --json` |
| `plan.json` | `plan --json` |
| `goal-list.txt` | `goal list` (no `--json`: the flag does not exist, `error: unknown option '--json'`) |
| `goal-show-GOAL-001.txt` | `goal show GOAL-001` (no `--json`: same error) |
| `metrics-show-GOAL-001.json` | `metrics show GOAL-001` (emits JSON by default; `--json` is rejected) |

Correction to the plan's premise: `goal list --json` does NOT exist in this
APOS build, while `metrics show` needs no flag to emit JSON. The reader
tests pin this exact behaviour.

## Derived variants (value-only edits, no new output shapes invented)

| File | Change vs recorded |
|---|---|
| `goal-list-GOAL-002-draft.txt` | `GOAL-001` → `GOAL-002`, `executing` → `draft` |
| `goal-show-GOAL-002-draft.txt` | `GOAL-001` → `GOAL-002`, `executing` → `draft` |
| `metrics-show-GOAL-002-draft.json` | `goalId`/`status`/`minutes` → `GOAL-002`/`draft`/`0` |
| `plan-GOAL-002-draft.json` | GOAL-002 entry: `status` → `draft`, `sketch` → `false` |
| `metrics-show-submits.json` | `submitsByPackage` → `{"EXEC-1": 2}`, `redGates` → `0` |
| `metrics-show-red.json` | `submitsByPackage` → `{"EXEC-1": 2}`, `redGates` → `2` |
