# EXEC-1 v1: solo-direct

Three TypeScript modules sharing one GoalState type: (1) state reader (src/state-reader.ts) calls the APOS CLI — inbox --json, goal list --json and plan --json where available, text parsing only for goal show / metrics show (issue #69 tracks adding --json there) — and returns the Goal state as JSON; (2) state machine (src/state-machine.ts), a pure function from GoalState to the next Solo step, plus the human-gated command list and predicate; (3) agent loop (src/loop.ts) that reads state, calls the next step and re-checks, plus a dry-run entry (src/dry-run.ts) that walks scripted sample states and prints the step sequence. ORCHESTRATOR.md documents the loop, the state-to-step table and the human-gated list. Tester writes acceptance tests first against the declared entries with stubs; Worker then fills the stubs in.

```json
{
  "id": "EXEC-1",
  "version": 1,
  "goalId": "GOAL-001",
  "goalVersion": 1,
  "mode": "solo-direct",
  "approach": "Three TypeScript modules sharing one GoalState type: (1) state reader (src/state-reader.ts) calls the APOS CLI — inbox --json, goal list --json and plan --json where available, text parsing only for goal show / metrics show (issue #69 tracks adding --json there) — and returns the Goal state as JSON; (2) state machine (src/state-machine.ts), a pure function from GoalState to the next Solo step, plus the human-gated command list and predicate; (3) agent loop (src/loop.ts) that reads state, calls the next step and re-checks, plus a dry-run entry (src/dry-run.ts) that walks scripted sample states and prints the step sequence. ORCHESTRATOR.md documents the loop, the state-to-step table and the human-gated list. Tester writes acceptance tests first against the declared entries with stubs; Worker then fills the stubs in.",
  "risks": [
    "APOS CLI text output for goal show / metrics show may change format; the reader text parsers are pinned by tests against recorded samples",
    "Issue #69 may add --json to goal show / metrics show later; the reader prefers --json when available and falls back to text parsing",
    "Dry run uses scripted states, not a live APOS project, so it proves the sequence logic, not the live CLI integration (covered by reader tests against recorded CLI output)"
  ],
  "baseCommit": "b5b22a8fd2a917a5f213966a7168be45ccaf47ad",
  "sourceSha256": "67fc56df728626cb807c855515596f8e775611662255bc96931098dea4956789",
  "estimatedCost": {
    "wallMinutes": 240
  },
  "rationale": "One cohesive set of modules with a single owner: the reader, the machine and the loop share the same GoalState type and are verified together by one test suite; splitting would add interface overhead without an independent seam.",
  "sharedPaths": [],
  "paths": [
    "src/**",
    "ORCHESTRATOR.md",
    "package.json",
    "vitest.config.ts",
    "README.md"
  ],
  "stubPaths": [
    "src/state-reader.ts",
    "src/state-machine.ts",
    "src/loop.ts",
    "src/dry-run.ts"
  ],
  "entries": [
    "readGoalState",
    "nextStep",
    "isHumanGated",
    "runDryRun"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "vitest: state machine returns the correct next step for every Goal state (src/state-machine.test.ts)"
    },
    {
      "acceptanceId": "AC-2",
      "verification": "vitest: state reader returns Goal state as JSON from APOS CLI output (src/state-reader.test.ts)"
    },
    {
      "acceptanceId": "AC-3",
      "verification": "vitest + npm run dry-run: loop never runs a human-gated command and stops at human gates"
    },
    {
      "acceptanceId": "AC-4",
      "verification": "vitest + npm run dry-run: red gate returns to worker-fix step; exhausted attempts stops for human"
    },
    {
      "acceptanceId": "AC-5",
      "verification": "npm run dry-run: dry run on a sample project prints the correct Solo step sequence"
    },
    {
      "acceptanceId": "AC-6",
      "verification": "npm test and npm run build pass (CHK-1, CHK-2)"
    },
    {
      "acceptanceId": "AC-7",
      "verification": "vitest: ORCHESTRATOR.md contains the state table and the human-gated command list matching the code"
    }
  ],
  "verificationStrategy": "Run npm test, npm run build and npm run dry-run (the Goal checks CHK-1, CHK-2, CHK-3)"
}
```
