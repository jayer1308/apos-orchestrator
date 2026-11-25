# GOAL-004 v2: Hỗ trợ Multi-WP: loop theo dõi trạng thái theo từng package, integration gate khi mọi package green, runner drive xử lý handover theo từng package — chứng minh bằng live-test lái Goal thật có 2 package song song chỉ bằng runner.

Status: verified

```json
{
  "id": "GOAL-004",
  "version": 2,
  "outcome": "Hỗ trợ Multi-WP: loop theo dõi trạng thái theo từng package, integration gate khi mọi package green, runner drive xử lý handover theo từng package — chứng minh bằng live-test lái Goal thật có 2 package song song chỉ bằng runner.",
  "source": {
    "path": "brief-004.md",
    "sha256": "d32f0548992dcf6fee91e21f80543b9d384650025ba4509cea2fd8d0b5002cd1",
    "capturedAt": "2026-11-25T06:03:08.983Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-11",
      "sourceSpan": "lines 32-34",
      "text": "Hỗ trợ Multi-WP (nhiều work package song song). — Nhận lại requirement R-11 từ GOAL-001, giữ nguyên id R-11 theo đúng yêu cầu của inbox notice.",
      "disposition": "acceptance"
    },
    {
      "id": "R-1",
      "sourceSpan": "lines 35-38",
      "text": "State machine theo dõi trạng thái theo từng package: package nào đã code-ready (có handover đã kiểm chứng), package nào đang đỏ, package nào đã green — và trả bước tiếp theo đúng cho từng package. Trường hợp một package (Solo) vẫn chạy đúng như hiện tại, không phá behaviour cũ.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "lines 39-42",
      "text": "Có integration gate: khi mọi package đã green riêng lẻ thì có một bước kiểm tra hợp nhất trước khi Goal được đóng (thiết kế do Lead quyết: APOS đã có sẵn lệnh `integration gate` / `integration complete` cho Multi-WP — loop lái các lệnh này — hay một bước trong package submit).",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "lines 43-46",
      "text": "Runner ở chế độ drive xử lý được nhiều package: nhận handover theo từng package (cách truyền handover cho từng package do Lead quyết), giữ drive-state theo từng package, không bao giờ submit lại commit đã đỏ của bất kỳ package nào.",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "lines 47-53",
      "text": "Bằng chứng live: mở rộng `npm run test:live` (hoặc script mới) tự dựng project mẫu và lái trọn một Goal thật có 2 package song song CHỈ bằng runner ở chế độ drive, cả hai package đều green. Live test đi qua cả hai đường như Solo: green ngay lần nộp đầu, và đỏ một lần rồi green sau khi fix (ít nhất ở một package). Check live phải tự đủ: tự dựng project mẫu của nó, vì mỗi check của gate chạy trong một worktree mới riêng (xem APOS #70).",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "lines 54-55",
      "text": "Các test cũ vẫn pass, không phá behaviour đã có (state machine Solo, state reader, dry-run, runner live, chế độ drive).",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "line 56",
      "text": "`npm test` pass.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "line 57",
      "text": "`npm run build` pass.",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "lines 58-59",
      "text": "Tài liệu ORCHESTRATOR.md cập nhật: bảng trạng thái theo từng package, cách runner drive xử lý nhiều package, và integration gate.",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "lines 60-61",
      "text": "Chạy như service nền 24/7. (out-of-scope — giữ nguyên như GOAL-001/002/003: chạy nền cần thêm giám sát, log và cơ chế dừng an toàn.)",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Chạy nền 24/7 cần thêm giám sát, log và cơ chế dừng an toàn."
    },
    {
      "id": "R-10",
      "sourceSpan": "lines 62-64",
      "text": "Runner tự chạy lệnh human (approve/select/close, --on-behalf). (out-of-scope — runner không bao giờ chạy lệnh human-gated; human gate luôn dừng lại để human quyết.)",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Runner không bao giờ chạy lệnh human-gated; human gate luôn dừng lại để human quyết."
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
    "chạy như service nền 24/7",
    "runner tự chạy lệnh human-gated (approve/select/close) hoặc dùng --on-behalf"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "State machine theo dõi trạng thái theo từng package: package nào đã code-ready, package nào đang đỏ, package nào đã green — và trả bước tiếp theo đúng cho từng package; trường hợp một package (Solo) vẫn chạy đúng như hiện tại.",
      "requirementIds": [
        "R-11",
        "R-1"
      ],
      "examples": [
        {
          "input": "Goal có 2 package: WP-A code-ready, WP-B đang đỏ",
          "expected": "bước tiếp theo là package-submit cho WP-A, worker-fix cho WP-B"
        },
        {
          "input": "Goal Solo, một package",
          "expected": "chạy đúng như hiện tại, không đổi behaviour"
        }
      ],
      "boundaries": [
        "một package đỏ không chặn package khác submit",
        "trạng thái theo từng package tách riêng, không lẫn nhau"
      ],
      "prohibited": [
        "gộp trạng thái các package thành một trạng thái chung",
        "submit lại commit đã đỏ của bất kỳ package nào"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-2",
      "text": "Integration gate: khi mọi package đã green riêng lẻ thì bước kiểm tra hợp nhất chạy trước khi Goal được đóng — loop lái lệnh integration gate / integration complete của APOS.",
      "requirementIds": [
        "R-2"
      ],
      "examples": [
        {
          "input": "2 package đều green",
          "expected": "integration gate chạy, rồi integration complete, Goal verified"
        },
        {
          "input": "1 package green, 1 package chưa",
          "expected": "chưa chạy integration gate"
        }
      ],
      "boundaries": [
        "integration gate chỉ chạy khi mọi package green",
        "Goal không verified khi chưa qua integration"
      ],
      "prohibited": [
        "đóng Goal khi chưa qua integration gate",
        "tự làm gate riêng thay vì lái lệnh APOS"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-3",
      "text": "Runner ở chế độ drive xử lý được nhiều package: nhận handover theo từng package, giữ drive-state theo từng package, không bao giờ submit lại commit đã đỏ của bất kỳ package nào.",
      "requirementIds": [
        "R-3"
      ],
      "examples": [
        {
          "input": "Worker bàn giao commit X cho WP-A và commit Y cho WP-B",
          "expected": "runner trả package-submit đúng commit cho từng package"
        },
        {
          "input": "chạy live --drive lần nữa sau khi X đã đỏ",
          "expected": "không submit lại X"
        }
      ],
      "boundaries": [
        "drive-state tách riêng theo từng package",
        "handover của package này không dùng cho package khác"
      ],
      "prohibited": [
        "đoán commit handover từ git log",
        "submit lại commit đã đỏ"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-4",
      "text": "Live test lái trọn Goal thật có 2 package song song CHỈ bằng runner ở chế độ drive: cả hai package đều green.",
      "requirementIds": [
        "R-4"
      ],
      "examples": [
        {
          "input": "Goal mẫu có 2 package, chạy test:live",
          "expected": "cả hai package green, Goal verified — chỉ bằng lệnh drive của runner"
        },
        {
          "input": "một package đỏ một lần rồi fix",
          "expected": "sau fix, runner submit handover mới và Goal verified"
        }
      ],
      "boundaries": [
        "bằng chứng là log lần chạy live thật, không chỉ dry-run",
        "test tự đủ: tự dựng project mẫu, chạy được trong worktree mới của gate (APOS #70)"
      ],
      "prohibited": [
        "chứng minh bằng script tay giữ handover",
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
        "state machine Solo, state reader, dry-run, runner live và chế độ drive giữ nguyên hành vi đã test"
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
      "text": "Tài liệu ORCHESTRATOR.md mô tả đủ bảng trạng thái theo từng package, cách runner drive xử lý nhiều package, và integration gate.",
      "requirementIds": [
        "R-8"
      ],
      "examples": [
        {
          "input": "mở ORCHESTRATOR.md",
          "expected": "file có bảng trạng thái theo package, cách drive xử lý nhiều package, integration gate"
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
