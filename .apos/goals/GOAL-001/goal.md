# GOAL-001 v1: Bộ orchestration cho APOS: đọc trạng thái, gọi đúng role agent cho bước tiếp theo, dừng ở gate human — state reader, state machine và agent loop đều chạy được và có test.

Status: verified

```json
{
  "id": "GOAL-001",
  "version": 1,
  "outcome": "Bộ orchestration cho APOS: đọc trạng thái, gọi đúng role agent cho bước tiếp theo, dừng ở gate human — state reader, state machine và agent loop đều chạy được và có test.",
  "source": {
    "path": "brief.md",
    "sha256": "67fc56df728626cb807c855515596f8e775611662255bc96931098dea4956789",
    "capturedAt": "2026-11-25T02:33:00.015Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "lines 18-21",
      "text": "State reader gọi lệnh APOS và trả về trạng thái hiện tại của một Goal và project đích dưới dạng JSON. Nguồn chính là `apos inbox --json`; vì `goal list`, `goal show`, `metrics show` chưa có cờ --json nên reader phải parse output text của các lệnh đó.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "lines 22-25",
      "text": "State machine viết bằng TypeScript, test được bằng vitest: từ trạng thái của một Goal, trả về đúng bước tiếp theo theo quy trình Solo của APOS. Không hardcode theo một goal cụ thể nào; cùng một trạng thái ở goal khác nhau phải cho cùng một bước tiếp theo.",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "lines 26-29",
      "text": "Agent loop gồm code runner tối thiểu và tài liệu ORCHESTRATOR.md: lặp lại đọc trạng thái, gọi đúng role agent (đọc skill tương ứng trong `.apos/skills` của project đích) cho bước tiếp theo, kiểm chứng bằng lệnh APOS, rồi lặp.",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "lines 30-34",
      "text": "Vòng lặp không bao giờ tự chạy các lệnh chỉ human được chạy (goal approve, goal appetite, goal select, outcome close, outcome revise, outcome stop, gate confirm, gate run --base, blocker resolve, setup approve, exception approve --human, bug approve, maintenance approve, hotfix). Gặp gate human thì vòng lặp dừng lại và báo cáo.",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "lines 35-37",
      "text": "Khi gate đỏ (package submit trả về exit 1), vòng lặp quay lại bước worker sửa code rồi submit lại commit mới. Hết số lần thử tối đa thì vòng lặp dừng và báo cáo human.",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "lines 38-39",
      "text": "Chạy thử khô (dry run) trên một project mẫu cho ra đúng chuỗi bước theo quy trình APOS, không chạy lệnh human-gated nào.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "line 40",
      "text": "`npm test` pass.",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "line 41",
      "text": "`npm run build` pass.",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "lines 42-43",
      "text": "Tài liệu ORCHESTRATOR.md mô tả đủ vòng lặp, bảng trạng thái chuyển sang bước tiếp theo, và danh sách lệnh human-gated không được chạy.",
      "disposition": "acceptance"
    },
    {
      "id": "R-10",
      "sourceSpan": "line 44",
      "text": "Tự động approve hoặc close thay human.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Gate của human phải do human quyết; bộ orchestration tự approve/close sẽ phá đúng thứ APOS bảo vệ."
    },
    {
      "id": "R-11",
      "sourceSpan": "line 45",
      "text": "Hỗ trợ Multi-WP (nhiều work package song song).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-002"
      },
      "exclusionReason": "Multi-WP cần máy trạng thái cho nhiều package song song và integration gate; làm sau khi Solo chạy được."
    },
    {
      "id": "R-12",
      "sourceSpan": "line 46",
      "text": "Chạy như service nền 24/7.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Bản đầu tiên là vòng lặp chạy theo yêu cầu; chạy nền 24/7 cần thêm giám sát, log và cơ chế dừng an toàn."
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
      "text": "State machine trả về đúng bước tiếp theo cho mọi trạng thái của một Goal theo quy trình Solo của APOS",
      "requirementIds": [
        "R-2"
      ],
      "examples": [
        {
          "input": "Goal ở trạng thái draft",
          "expected": "draft -> chờ human approve (dừng, báo cáo)"
        },
        {
          "input": "package submit đỏ, còn lượt thử",
          "expected": "red còn lượt thử -> worker sửa code rồi submit lại"
        },
        {
          "input": "Goal verified",
          "expected": "green -> chờ human close (dừng, báo cáo)"
        }
      ],
      "boundaries": [
        "cùng một trạng thái ở goal khác nhau phải cho cùng một bước tiếp theo",
        "state machine không đọc file journal hay SQLite trực tiếp"
      ],
      "prohibited": [
        "hardcode theo một goal cụ thể",
        "tự chạy lệnh human-gated để đi tiếp"
      ],
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-2",
      "text": "State reader trả về trạng thái hiện tại của một Goal và project đích dưới dạng JSON, dùng `apos inbox --json` làm nguồn chính",
      "requirementIds": [
        "R-1"
      ],
      "examples": [
        {
          "input": "đọc trạng thái một Goal thật qua CLI",
          "expected": "JSON có goal id, status, package, số lần thử"
        }
      ],
      "boundaries": [
        "goal list, goal show, metrics show chưa có cờ --json nên phải parse output text",
        "reader không đọc trực tiếp file journal hay SQLite trong controller home"
      ],
      "prohibited": [
        "đọc trực tiếp state.sqlite hay thư mục events trong controller home"
      ],
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-3",
      "text": "Vòng lặp không bao giờ tự chạy lệnh chỉ human được chạy; gặp gate human thì dừng lại và báo cáo",
      "requirementIds": [
        "R-4"
      ],
      "examples": [
        {
          "input": "trạng thái Goal đang chờ human approve",
          "expected": "vòng lặp dừng và báo cáo, không gọi lệnh đó"
        }
      ],
      "boundaries": [
        "danh sách lệnh human-gated lấy theo AGENTS.md của project"
      ],
      "prohibited": [
        "dùng --on-behalf khi human chưa đồng ý rõ ràng"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-3"
      ]
    },
    {
      "id": "AC-4",
      "text": "Gate đỏ thì vòng lặp quay lại bước worker sửa code rồi submit lại; hết lượt thì dừng và báo cáo human",
      "requirementIds": [
        "R-5"
      ],
      "examples": [
        {
          "input": "package submit đỏ, còn lượt thử",
          "expected": "quay lại bước worker sửa rồi submit commit mới"
        },
        {
          "input": "package submit đỏ, hết lượt thử",
          "expected": "dừng và báo cáo human"
        }
      ],
      "boundaries": [
        "số lần thử tối đa lấy từ appetite của Goal"
      ],
      "prohibited": [
        "submit lại cùng một commit đã đỏ"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-3"
      ]
    },
    {
      "id": "AC-5",
      "text": "Dry run trên một project mẫu cho ra đúng chuỗi bước theo quy trình APOS",
      "requirementIds": [
        "R-3",
        "R-6"
      ],
      "examples": [
        {
          "input": "dry run trên project mẫu đã có Goal approved và selected",
          "expected": "chuỗi bước: lead propose -> lead commit -> tests submit -> package submit -> chờ human close"
        }
      ],
      "boundaries": [
        "dry run không tạo commit thật, không gọi lệnh human-gated"
      ],
      "prohibited": [
        "dry run chạy lệnh human-gated",
        "dry run sửa file thật của project mẫu"
      ],
      "checkIds": [
        "CHK-3"
      ]
    },
    {
      "id": "AC-6",
      "text": "`npm test` và `npm run build` đều pass",
      "requirementIds": [
        "R-7",
        "R-8"
      ],
      "examples": [],
      "boundaries": [],
      "prohibited": [],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-7",
      "text": "Tài liệu ORCHESTRATOR.md mô tả đủ vòng lặp, bảng trạng thái chuyển sang bước tiếp theo, và danh sách lệnh human-gated không được chạy",
      "requirementIds": [
        "R-9"
      ],
      "examples": [
        {
          "input": "mở ORCHESTRATOR.md",
          "expected": "file có bảng trạng thái và danh sách lệnh human-gated"
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
    }
  ],
  "dependencies": [],
  "priority": 1
}
```
