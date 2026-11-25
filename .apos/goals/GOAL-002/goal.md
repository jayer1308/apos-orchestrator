# GOAL-002 v1: Sửa bộ orchestration: vòng lặp live đi được từ worker-write-code tới package-submit (tín hiệu code-ready), có runner live thật và đọc được appetite khi CLI có — chứng minh bằng live-test trên Goal thật.

Status: approved

```json
{
  "id": "GOAL-002",
  "version": 1,
  "outcome": "Sửa bộ orchestration: vòng lặp live đi được từ worker-write-code tới package-submit (tín hiệu code-ready), có runner live thật và đọc được appetite khi CLI có — chứng minh bằng live-test trên Goal thật.",
  "source": {
    "path": "brief-002.md",
    "sha256": "3cd2b7dc9c2bcea9781ee586773609cbc44784e7f5a89e13999acfa0972b0848",
    "capturedAt": "2026-11-25T03:13:16.205Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "lines 22-28",
      "text": "Sửa chuyển tiếp worker→submit: loop nhớ commit Worker đã bàn giao rồi tự chạy package-submit với commit đó. State machine thêm tín hiệu code-ready (ví dụ: commit mới sau lead-commit do Worker bàn giao). Thiết kế chi tiết do Lead quyết lúc thực thi, nhưng hướng sửa phải là: trạng thái \"executing, chưa có package, Worker đã bàn giao commit\" cho bước tiếp theo là package-submit với commit đó, không quay lại worker-write-code vô hạn.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "lines 29-32",
      "text": "Thêm runner live thật: một lệnh chạy được (npm run live -- --repo <project> --goal <id>) đọc trạng thái thật qua CLI (readGoalState) và in bước tiếp theo (nextStep). Không còn placeholder: src/index.ts hiện chỉ là placeholder, phải được thay bằng entry thật (hoặc file entry mới).",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "lines 33-36",
      "text": "Đọc appetite (maxAttempts) từ output CLI khi có (inbox --json, plan --json, goal show, metrics show — lệnh nào có thì đọc); nếu không có thì giữ mặc định 3 và ghi rõ trong log/output là đang dùng mặc định (liên quan issue APOS #69).",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "lines 37-41",
      "text": "Live-test vòng lặp đã sửa trên một Goal thật: lái từ selected tới green. Bằng chứng là log lần chạy live thật trên repo mẫu (không chỉ dry-run). Check live (npm run test:live) phải tự đủ: tự dựng project mẫu của nó, vì mỗi check của gate chạy trong một worktree mới riêng (xem APOS #70).",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "lines 42-43",
      "text": "Các test cũ vẫn pass, không phá behaviour đã có (state machine, state reader, dry-run).",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "line 44",
      "text": "`npm test` pass.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "line 45",
      "text": "`npm run build` pass.",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "lines 46-47",
      "text": "Tài liệu ORCHESTRATOR.md cập nhật: mô tả tín hiệu code-ready, runner live, và cách đọc appetite.",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "line 48",
      "text": "Hỗ trợ Multi-WP (nhiều work package song song).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Multi-WP cần máy trạng thái cho nhiều package song song và integration gate; làm sau khi Solo chạy được live."
    },
    {
      "id": "R-10",
      "sourceSpan": "line 49",
      "text": "Chạy như service nền 24/7.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Bản này là vòng lặp chạy theo yêu cầu; chạy nền 24/7 cần thêm giám sát, log và cơ chế dừng an toàn."
    }
  ],
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
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Worker bàn giao commit thì loop chạy package-submit với commit đó thay vì kẹt ở worker-write-code",
      "requirementIds": [
        "R-1"
      ],
      "examples": [
        {
          "input": "executing, chưa có package, Worker bàn giao commit X",
          "expected": "bước tiếp theo là package-submit với commit đó"
        },
        {
          "input": "package submit đỏ, còn lượt thử",
          "expected": "worker-fix rồi package-submit với commit mới"
        }
      ],
      "boundaries": [
        "không submit lại cùng một commit đã đỏ",
        "không quay lại worker-write-code khi đã có commit bàn giao"
      ],
      "prohibited": [
        "kẹt vô hạn ở worker-write-code"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-2",
      "text": "Lệnh `npm run live -- --repo <project> --goal <id>` chạy được: đọc trạng thái thật qua CLI và in bước tiếp theo",
      "requirementIds": [
        "R-2"
      ],
      "examples": [
        {
          "input": "chạy live trên project có Goal ở trạng thái selected",
          "expected": "in ra bước tiếp theo (lead-propose)"
        }
      ],
      "boundaries": [
        "runner chỉ gọi lệnh đọc của CLI để lấy trạng thái",
        "không còn placeholder trong src/index.ts"
      ],
      "prohibited": [
        "runner tự chạy lệnh human-gated"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-3",
      "text": "Appetite (maxAttempts) được đọc từ output CLI khi có; khi không có thì giữ mặc định 3 và ghi rõ trong log/output là đang dùng mặc định",
      "requirementIds": [
        "R-3"
      ],
      "examples": [
        {
          "input": "CLI chưa lộ appetite",
          "expected": "attemptsMax = 3 và log ghi rõ đang dùng mặc định"
        },
        {
          "input": "CLI lộ appetite (ví dụ sau khi APOS #69 được sửa)",
          "expected": "attemptsMax bằng giá trị CLI lộ ra"
        }
      ],
      "boundaries": [
        "mặc định 3 chỉ dùng khi CLI không lộ appetite ở bất kỳ lệnh nào"
      ],
      "prohibited": [
        "đọc trực tiếp state.sqlite hay thư mục events trong controller home"
      ],
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-4",
      "text": "Live-test vòng lặp đã sửa trên một Goal thật: lái từ selected tới green",
      "requirementIds": [
        "R-4"
      ],
      "examples": [
        {
          "input": "Goal thật ở trạng thái selected",
          "expected": "loop đi qua lead-propose, worker-write-code, package-submit rồi Goal verified"
        }
      ],
      "boundaries": [
        "bằng chứng là log lần chạy live thật, không chỉ dry-run"
      ],
      "prohibited": [
        "chứng minh live-test chỉ bằng dry-run"
      ],
      "checkIds": [
        "CHK-4"
      ]
    },
    {
      "id": "AC-5",
      "text": "Các test cũ vẫn pass, không phá behaviour đã có",
      "requirementIds": [
        "R-5",
        "R-6"
      ],
      "examples": [
        {
          "input": "chạy npm test sau khi sửa",
          "expected": "toàn bộ test cũ pass"
        }
      ],
      "boundaries": [
        "state machine, state reader và dry-run giữ nguyên hành vi đã test"
      ],
      "prohibited": [
        "đổi hành vi của bước đã đúng để sửa bước hỏng"
      ],
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-6",
      "text": "`npm run build` pass",
      "requirementIds": [
        "R-7"
      ],
      "examples": [],
      "boundaries": [],
      "prohibited": [],
      "checkIds": [
        "CHK-2"
      ]
    },
    {
      "id": "AC-7",
      "text": "Tài liệu ORCHESTRATOR.md mô tả đủ tín hiệu code-ready, runner live, và cách đọc appetite",
      "requirementIds": [
        "R-8"
      ],
      "examples": [
        {
          "input": "mở ORCHESTRATOR.md",
          "expected": "file có tín hiệu code-ready, runner live và cách đọc appetite"
        }
      ],
      "boundaries": [
        "bảng trạng thái -> bước tiếp theo phải khớp với state machine đã test"
      ],
      "prohibited": [
        "tài liệu mô tả khác với hành vi thật của code"
      ],
      "checkIds": [
        "CHK-1"
      ]
    }
  ],
  "checks": [
    {
      "id": "CHK-1",
      "kind": "command",
      "command": "npm test",
      "expect": "pass",
      "runs": 1,
      "timeoutMs": 600000,
      "env": {}
    },
    {
      "id": "CHK-2",
      "kind": "command",
      "command": "npm run build",
      "expect": "pass",
      "runs": 1,
      "timeoutMs": 600000,
      "env": {}
    },
    {
      "id": "CHK-3",
      "kind": "command",
      "command": "npm run dry-run",
      "expect": "pass",
      "runs": 1,
      "timeoutMs": 600000,
      "env": {}
    },
    {
      "id": "CHK-4",
      "kind": "command",
      "command": "npm run test:live",
      "expect": "pass",
      "runs": 1,
      "timeoutMs": 600000,
      "env": {}
    }
  ],
  "dependencies": [],
  "priority": 1
}
```
