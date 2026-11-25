# WP-MAIN v1: Sửa bộ orchestration: vòng lặp live đi được từ worker-write-code tới package-submit (tín hiệu code-ready), có runner live thật và đọc được appetite khi CLI có — chứng minh bằng live-test trên Goal thật.

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-002",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "Sửa bộ orchestration: vòng lặp live đi được từ worker-write-code tới package-submit (tín hiệu code-ready), có runner live thật và đọc được appetite khi CLI có — chứng minh bằng live-test trên Goal thật.",
  "scope": [
    "src/",
    "ORCHESTRATOR.md",
    "package.json",
    "vitest.config.ts",
    "README.md"
  ],
  "exclusions": [
    "tự động approve/close thay human",
    "hỗ trợ Multi-WP",
    "chạy như service nền 24/7"
  ],
  "dependencies": [],
  "interfaces": [
    "EXEC-2@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Worker bàn giao commit thì loop chạy package-submit với commit đó thay vì kẹt ở worker-write-code",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-2",
      "text": "Lệnh `npm run live -- --repo <project> --goal <id>` chạy được: đọc trạng thái thật qua CLI và in bước tiếp theo",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-3",
      "text": "Appetite (maxAttempts) được đọc từ output CLI khi có; khi không có thì giữ mặc định 3 và ghi rõ trong log/output là đang dùng mặc định",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-4",
      "text": "Live-test vòng lặp đã sửa trên một Goal thật: lái từ selected tới green",
      "goalAcceptanceId": "AC-4",
      "checkIds": [
        "CHK-4"
      ]
    },
    {
      "id": "AC-5",
      "text": "Các test cũ vẫn pass, không phá behaviour đã có",
      "goalAcceptanceId": "AC-5",
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-6",
      "text": "`npm run build` pass",
      "goalAcceptanceId": "AC-6",
      "checkIds": [
        "CHK-2"
      ]
    },
    {
      "id": "AC-7",
      "text": "Tài liệu ORCHESTRATOR.md mô tả đủ tín hiệu code-ready, runner live, và cách đọc appetite",
      "goalAcceptanceId": "AC-7",
      "checkIds": [
        "CHK-1"
      ]
    }
  ],
  "integration": "Solo: the package is the whole Goal",
  "paths": [
    "src/**",
    "ORCHESTRATOR.md",
    "package.json",
    "vitest.config.ts",
    "README.md"
  ],
  "stubPaths": [
    "src/state-machine.ts",
    "src/state-reader.ts",
    "src/loop.ts",
    "src/index.ts",
    "src/live-test.ts"
  ]
}
```
