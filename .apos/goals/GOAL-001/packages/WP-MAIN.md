# WP-MAIN v1: Bộ orchestration cho APOS: đọc trạng thái, gọi đúng role agent cho bước tiếp theo, dừng ở gate human — state reader, state machine và agent loop đều chạy được và có test.

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-001",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "Bộ orchestration cho APOS: đọc trạng thái, gọi đúng role agent cho bước tiếp theo, dừng ở gate human — state reader, state machine và agent loop đều chạy được và có test.",
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
    "EXEC-1@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "State machine trả về đúng bước tiếp theo cho mọi trạng thái của một Goal theo quy trình Solo của APOS",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-2",
      "text": "State reader trả về trạng thái hiện tại của một Goal và project đích dưới dạng JSON, dùng `apos inbox --json` làm nguồn chính",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-3",
      "text": "Vòng lặp không bao giờ tự chạy lệnh chỉ human được chạy; gặp gate human thì dừng lại và báo cáo",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-3"
      ]
    },
    {
      "id": "AC-4",
      "text": "Gate đỏ thì vòng lặp quay lại bước worker sửa code rồi submit lại; hết lượt thì dừng và báo cáo human",
      "goalAcceptanceId": "AC-4",
      "checkIds": [
        "CHK-1",
        "CHK-3"
      ]
    },
    {
      "id": "AC-5",
      "text": "Dry run trên một project mẫu cho ra đúng chuỗi bước theo quy trình APOS",
      "goalAcceptanceId": "AC-5",
      "checkIds": [
        "CHK-3"
      ]
    },
    {
      "id": "AC-6",
      "text": "`npm test` và `npm run build` đều pass",
      "goalAcceptanceId": "AC-6",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-7",
      "text": "Tài liệu ORCHESTRATOR.md mô tả đủ vòng lặp, bảng trạng thái chuyển sang bước tiếp theo, và danh sách lệnh human-gated không được chạy",
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
    "src/state-reader.ts",
    "src/state-machine.ts",
    "src/loop.ts",
    "src/dry-run.ts"
  ]
}
```
