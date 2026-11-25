# WP-CORE v1: State machine, state reader và loop theo dõi trạng thái theo từng package, với bước integration-gate / integration-complete khi mọi package green.

```json
{
  "id": "WP-CORE",
  "goalId": "GOAL-004",
  "goalVersion": 2,
  "version": 1,
  "owner": "lead",
  "outcome": "State machine, state reader và loop theo dõi trạng thái theo từng package, với bước integration-gate / integration-complete khi mọi package green.",
  "scope": [
    "src/state-machine.ts",
    "src/state-reader.ts",
    "src/loop.ts",
    "src/dry-run.ts"
  ],
  "exclusions": [],
  "dependencies": [],
  "interfaces": [
    "nextStepForPackage@v1",
    "GoalState.packages@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "State machine theo dõi trạng thái theo từng package và trả bước tiếp theo đúng cho từng package; Solo vẫn chạy như cũ.",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-2",
      "text": "Khi mọi package green thì bước tiếp theo là integration-gate, rồi integration-complete; chưa đủ green thì chưa integration.",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-5",
      "text": "Các test cũ vẫn pass, không phá behaviour đã có.",
      "goalAcceptanceId": "AC-5",
      "checkIds": [
        "CHK-1"
      ]
    }
  ],
  "integration": "Machine trả bước đúng cho từng package; khi mọi package green thì integration-gate rồi integration-complete; Solo (một package) giữ nguyên hành vi cũ. WP-DRIVE đứng trên interface này để lái drive và live test.",
  "paths": [
    "src/state-machine.ts",
    "src/state-reader.ts",
    "src/loop.ts",
    "src/dry-run.ts",
    "src/state-machine-004.test.ts",
    "src/state-reader-004.test.ts",
    "src/loop-004.test.ts",
    "src/dry-run-004.test.ts"
  ],
  "stubPaths": [
    "src/state-machine.ts",
    "src/state-reader.ts",
    "src/loop.ts"
  ]
}
```
