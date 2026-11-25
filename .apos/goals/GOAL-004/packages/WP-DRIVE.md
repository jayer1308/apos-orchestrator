# WP-DRIVE v1: Runner drive xử lý handover theo từng package và live test chứng minh Goal thật 2 package song song chỉ bằng runner drive.

```json
{
  "id": "WP-DRIVE",
  "goalId": "GOAL-004",
  "goalVersion": 2,
  "version": 1,
  "owner": "lead",
  "outcome": "Runner drive xử lý handover theo từng package và live test chứng minh Goal thật 2 package song song chỉ bằng runner drive.",
  "scope": [
    "src/drive-state.ts",
    "src/index.ts",
    "src/live-test.ts"
  ],
  "exclusions": [],
  "dependencies": [
    "WP-CORE"
  ],
  "interfaces": [
    "drivePerPackage@v1",
    "liveTestMultiWp@v1"
  ],
  "acceptance": [
    {
      "id": "AC-3",
      "text": "Runner drive xử lý nhiều package: handover theo từng package, drive-state theo từng package, không submit lại commit đã đỏ của bất kỳ package nào.",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-4",
      "text": "Live test lái trọn Goal thật có 2 package song song CHỈ bằng runner drive, cả hai đường green ngay và đỏ một lần rồi green.",
      "goalAcceptanceId": "AC-4",
      "checkIds": [
        "CHK-4"
      ]
    },
    {
      "id": "AC-6",
      "text": "npm run build pass.",
      "goalAcceptanceId": "AC-6",
      "checkIds": [
        "CHK-2"
      ]
    },
    {
      "id": "AC-7",
      "text": "ORCHESTRATOR.md mô tả đủ bảng trạng thái theo từng package, cách runner drive xử lý nhiều package, và integration gate — khớp với state machine đã test (cả phần bảng trạng thái của WP-CORE).",
      "goalAcceptanceId": "AC-7",
      "checkIds": [
        "CHK-1"
      ]
    }
  ],
  "integration": "Drive nhận handover theo từng package, reconcile drive-state theo từng package, lái integration gate/complete sau khi mọi package green (dùng bước integration của WP-CORE), rồi Goal verified.",
  "paths": [
    "src/drive-state.ts",
    "src/index.ts",
    "src/live-test.ts",
    "src/drive-state-004.test.ts",
    "src/live-drive-004.test.ts",
    "src/live-test-004.test.ts"
  ],
  "stubPaths": [
    "src/drive-state.ts",
    "src/index.ts",
    "src/live-test.ts"
  ]
}
```
