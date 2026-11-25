# GOAL-003 v1: Runner tự lái trọn một Goal: chế độ drive giữ handover, tự chuyển sang package-submit với commit đã verify, xử lý được đường đỏ — chứng minh bằng live-test chỉ dùng runner.

Status: verified

```json
{
  "id": "GOAL-003",
  "version": 1,
  "outcome": "Runner tự lái trọn một Goal: chế độ drive giữ handover, tự chuyển sang package-submit với commit đã verify, xử lý được đường đỏ — chứng minh bằng live-test chỉ dùng runner.",
  "source": {
    "path": "brief-003.md",
    "sha256": "b2d1dd02b184e18aa81e45762a1eb6f29ed859055ec9040c9f63284d1baf135b",
    "capturedAt": "2026-11-25T04:05:39.600Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "lines 31-39",
      "text": "Runner có chế độ lái đầy đủ: một lệnh duy nhất (`npm run live -- --repo <project> --goal <id> --drive`; tên cờ do Lead quyết) tự giữ LoopRunState qua các bước. Runner nhận commit handover của Worker bằng cờ `--handover <sha>` (người lái truyền commit Worker vừa bàn giao); tự verify handover bằng git rồi trả `package-submit` với đúng commit đó — không cần script tay giữ handover như lần test GOAL-003. Runner giữ lại danh sách commit đã submit/đã đỏ qua các lần gọi, để không bao giờ submit lại commit đã đỏ. Cách lưu trạng thái chạy (file trạng thái hay tiến trình chạy dài) do Lead quyết.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "lines 40-43",
      "text": "Runner vẫn dừng đúng ở human gate (chờ approve, chờ select, wait-human-close, report-human-blocked) và KHÔNG BAO GIỜ chạy lệnh human (approve/select/close, gate confirm, --on-behalf...) — chỉ in và dừng, như runner hiện tại.",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "lines 44-50",
      "text": "Đường đỏ: sau khi gate đỏ, Worker fix xong bàn giao handover mới thì runner tự chuyển sang submit handover mới đó, không kẹt lại ở worker-fix. Thiết kế do Lead quyết: hoặc machine trả `package-submit` khi red + handover mới đã kiểm chứng, hoặc runner submit ngay trong bước fix như quy ước đã ghi trong ORCHESTRATOR.md — hành vi quan sát được phải giống nhau: không hỏi lại machine rồi lại nhận worker-fix cho cùng một lần đỏ.",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "lines 51-56",
      "text": "Bằng chứng live: mở rộng `npm run test:live` (hoặc script mới) tự dựng project mẫu và lái trọn Goal thật từ selected tới green CHỈ bằng runner ở chế độ drive (không script tay giữ handover). Live test phải đi qua cả hai đường: green ngay lần nộp đầu, và đỏ một lần rồi green sau khi fix. Check live phải tự đủ: tự dựng project mẫu của nó, vì mỗi check của gate chạy trong một worktree mới riêng (xem APOS #70).",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "lines 57-58",
      "text": "Các test cũ vẫn pass, không phá behaviour đã có (state machine, state reader, dry-run, runner live hiện tại).",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "line 59",
      "text": "`npm test` pass.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "line 60",
      "text": "`npm run build` pass.",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "lines 61-62",
      "text": "Tài liệu ORCHESTRATOR.md cập nhật: chế độ drive, cách nhận handover (`--handover <sha>`), cách giữ trạng thái chạy, và đường đỏ.",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "line 63",
      "text": "Hỗ trợ Multi-WP (nhiều work package song song).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Multi-WP cần máy trạng thái cho nhiều package song song và integration gate; làm sau khi Solo chạy được live."
    },
    {
      "id": "R-10",
      "sourceSpan": "line 64",
      "text": "Chạy như service nền 24/7.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Bản này là vòng lặp chạy theo yêu cầu; chạy nền 24/7 cần thêm giám sát, log và cơ chế dừng an toàn."
    },
    {
      "id": "R-11",
      "sourceSpan": "line 65",
      "text": "Runner tự chạy lệnh human (approve/select/close, --on-behalf).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Runner không bao giờ chạy lệnh human-gated; đó là ranh giới an toàn của bộ orchestration — human gate luôn dừng lại để human quyết."
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
    "runner tự chạy lệnh human-gated (approve/select/close) hoặc dùng --on-behalf",
    "hỗ trợ Multi-WP",
    "chạy như service nền 24/7"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Chế độ drive tự giữ handover: chạy `npm run live -- --drive --handover <sha>` sau khi Worker bàn giao thì bước tiếp theo là package-submit với đúng commit đó, không cần script tay giữ handover",
      "requirementIds": [
        "R-1"
      ],
      "examples": [
        {
          "input": "executing, Worker bàn giao commit X; chạy live --drive --handover X",
          "expected": "bước tiếp theo là package-submit với commit X"
        },
        {
          "input": "chạy live --drive lần nữa sau khi X đã submit",
          "expected": "không submit lại X"
        }
      ],
      "boundaries": [
        "handover chưa verify thì không submit (coi như chưa có code)",
        "file trạng thái chạy (nếu có) không nằm trong diff nộp gate",
        "trạng thái chạy tách riêng theo từng project + goal"
      ],
      "prohibited": [
        "submit lại commit đã đỏ",
        "đoán commit handover từ git log thay vì nhận qua --handover"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-2",
      "text": "Chế độ drive dừng đúng ở human gate và không bao giờ chạy lệnh human",
      "requirementIds": [
        "R-2"
      ],
      "examples": [
        {
          "input": "Goal ở draft, chạy live --drive",
          "expected": "wait-human-approve, chỉ in và dừng"
        },
        {
          "input": "Goal verified, chạy live --drive",
          "expected": "wait-human-close, chỉ in và dừng"
        }
      ],
      "boundaries": [
        "runner không gọi bất kỳ lệnh APOS nào ngoài lệnh đọc và git kiểm chứng handover"
      ],
      "prohibited": [
        "chạy goal approve/select, outcome close hay bất kỳ lệnh human-gated nào",
        "dùng --on-behalf"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-3",
      "text": "Đường đỏ: handover mới sau gate đỏ được submit ngay, không kẹt lại ở worker-fix",
      "requirementIds": [
        "R-3"
      ],
      "examples": [
        {
          "input": "package red, Worker fix bàn giao commit Y; chạy live --drive --handover Y",
          "expected": "bước tiếp theo là package-submit với commit Y"
        },
        {
          "input": "Y đã đỏ",
          "expected": "không submit lại Y, Worker viết code mới"
        }
      ],
      "boundaries": [
        "commit đã đỏ không bao giờ được submit lại"
      ],
      "prohibited": [
        "hỏi lại machine rồi lại nhận worker-fix cho cùng một lần đỏ"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-4"
      ]
    },
    {
      "id": "AC-4",
      "text": "Live test lái trọn Goal thật CHỈ bằng runner ở chế độ drive: từ selected tới green",
      "requirementIds": [
        "R-4"
      ],
      "examples": [
        {
          "input": "Goal mẫu ở selected, chạy test:live",
          "expected": "loop đi qua lead-propose, worker-write-code, package-submit rồi Goal verified — chỉ bằng lệnh drive của runner"
        },
        {
          "input": "Goal mẫu đỏ một lần rồi fix",
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
        "state machine, state reader, dry-run và runner live hiện tại giữ nguyên hành vi đã test"
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
      "text": "Tài liệu ORCHESTRATOR.md mô tả đủ chế độ drive, cách nhận handover, cách giữ trạng thái chạy, và đường đỏ",
      "requirementIds": [
        "R-8"
      ],
      "examples": [
        {
          "input": "mở ORCHESTRATOR.md",
          "expected": "file có chế độ drive, --handover, cách giữ trạng thái chạy, đường đỏ"
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
