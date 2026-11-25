# WP-MAIN v1: Runner tự lái trọn một Goal: chế độ drive giữ handover, tự chuyển sang package-submit với commit đã verify, xử lý được đường đỏ — chứng minh bằng live-test chỉ dùng runner.

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-003",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "Runner tự lái trọn một Goal: chế độ drive giữ handover, tự chuyển sang package-submit với commit đã verify, xử lý được đường đỏ — chứng minh bằng live-test chỉ dùng runner.",
  "scope": [
    "src/",
    "ORCHESTRATOR.md",
    "package.json",
    "vitest.config.ts",
    "README.md"
  ],
  "exclusions": [
    "runner tự chạy lệnh human-gated (approve/select/close) hoặc dùng --on-behalf",
    "hỗ trợ Multi-WP",
    "chạy như service nền 24/7"
  ],
  "dependencies": [],
  "interfaces": [
    "EXEC-3@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Chế độ drive tự giữ handover: chạy `npm run live -- --drive --handover <sha>` sau khi Worker bàn giao thì bước tiếp theo là package-submit với đúng commit đó, không cần script tay giữ handover",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-2",
      "text": "Chế độ drive dừng đúng ở human gate và không bao giờ chạy lệnh human",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-3",
      "text": "Đường đỏ: handover mới sau gate đỏ được submit ngay, không kẹt lại ở worker-fix",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-4",
      "text": "Live test lái trọn Goal thật CHỈ bằng runner ở chế độ drive: từ selected tới green",
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
      "text": "Tài liệu ORCHESTRATOR.md mô tả đủ chế độ drive, cách nhận handover, cách giữ trạng thái chạy, và đường đỏ",
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
    "src/index.ts",
    "src/state-machine.ts",
    "src/loop.ts",
    "src/live-test.ts",
    "src/drive-state.ts"
  ]
}
```
