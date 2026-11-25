# EXEC-4 v1: multi-wp

(1) R-1 — trạng thái theo từng package, không phá Solo: GoalState thêm trường optional `packages?: Record<string, PackageState>` với PackageState = { status, codeReady?, handoverCommit? }; các trường scalar hiện tại (packageStatus, codeReady, handoverCommit, submittedCommits, redCommits) giữ nguyên và vẫn là projection Solo/WP-MAIN, nên nextStep(state) cũ cho cùng đáp án khi không có `packages`. Thêm hàm thuần túy mới nextStepForPackage(state, packageId): áp dụng đúng luật nextStep hiện tại nhưng scoped theo package đó (pending/red/green/none + code-ready + red+handover-mới), cộng hai StepAction mới `integration-gate` và `integration-complete`. LoopRunState tách theo package: `packages: Record<packageId, { handoverCommit, codeReady, submittedCommits, redCommits }>`; các hàm record/verify/apply/consume/markRed có thêm biến thể theo package, hàm cũ giữ nguyên và delegate về package duy nhất (Solo). Reader: trạng thái từng package đọc từ `goal show` (bảng package) đối chiếu `metrics show` submitsByPackage (đã có sẵn theo từng package); tổng redGates của metrics chỉ là tổng, nên trạng thái đỏ theo từng package lấy từ goal show — nếu goal show không phân biệt được đỏ theo package thì reader suy ra từ drive-state reconcile và ghi rõ trong log, đó là APOS finding để route về (không sửa tay state). Dry-run thêm kịch bản multi-wp: WP-A code-ready + WP-B đỏ → package-submit cho WP-A, worker-fix cho WP-B; rồi mọi package green → integration-gate → integration-complete. (2) R-2 — integration gate lái lệnh APOS, không tự làm gate: khi mọi package green, nextStepForPackage trả `integration-gate`; driver (runner drive + live test) chạy `apos integration gate <goal> --commit <sha> --reason <text>` với integration commit là commit merge (không squash/rebase) chứa commit green của mọi package làm ancestor, rồi khi gate green thì `integration-complete` với cùng commit (+ --conflict-resolution nếu package chồng lấn); chỉ sau đó Goal mới verified → wait-human-close. Không thêm bước kiểm tra hợp nhất riêng trong package submit. (3) R-3 — drive theo từng package: runner drive nhận `--handover <pkg>:<sha>` lặp lại được (mỗi package một handover); `--handover <sha>` trơn vẫn được chấp nhận và hiểu là package duy nhất (Solo, tương thích cũ). Drive-state giữ một file cho mỗi project + goal như cũ (đường dẫn không đổi) nhưng nội dung tách theo package (map packages + submitted/red toàn cục dạng hợp của các package, để luật 'không submit lại commit đã đỏ của bất kỳ package nào' kiểm tra trên hợp đó). Reconcile từng package từ reader state theo package. baseCommit để verify handover vẫn đọc từ execution.md như GOAL-003; handover của package nào chỉ verify/submit cho package đó, không dùng chéo. (4) R-4 — live test 2 package: mở rộng src/live-test.ts với Goal mẫu Multi-WP (2 package WP-A/WP-B, file độc lập: greet-a/greet-b, không phụ thuộc nhau, không sharedPaths): lead propose (multi-wp) + package add + lead commit qua CLI trong test, rồi lái CHỈ bằng subprocess runner drive qua cả hai kịch bản green-first và red-then-green (đỏ ít nhất ở một package rồi fix); driver chạy integration gate/complete khi runner in bước đó, rồi Goal verified. (5) Test mới (vitest, file *-004.test.ts, test cũ không sửa hành vi): machine per-package + integration steps + Solo tương thích; reader parse trạng thái theo package (fixture output thật); loop/drive-state per-package + không submit lại commit đỏ chéo package; runner drive parse --handover theo package; live-test assert cả hai đường 2 package. (6) Cập nhật ORCHESTRATOR.md: bảng trạng thái theo package, drive nhiều package, integration gate; README.md ghi thêm một dòng khi cần. Không Tester step: Goal không ghim setup nên không có locked test; Worker viết code trực tiếp trên plan base.

```json
{
  "id": "EXEC-4",
  "version": 1,
  "goalId": "GOAL-004",
  "goalVersion": 2,
  "mode": "multi-wp",
  "approach": "(1) R-1 — trạng thái theo từng package, không phá Solo: GoalState thêm trường optional `packages?: Record<string, PackageState>` với PackageState = { status, codeReady?, handoverCommit? }; các trường scalar hiện tại (packageStatus, codeReady, handoverCommit, submittedCommits, redCommits) giữ nguyên và vẫn là projection Solo/WP-MAIN, nên nextStep(state) cũ cho cùng đáp án khi không có `packages`. Thêm hàm thuần túy mới nextStepForPackage(state, packageId): áp dụng đúng luật nextStep hiện tại nhưng scoped theo package đó (pending/red/green/none + code-ready + red+handover-mới), cộng hai StepAction mới `integration-gate` và `integration-complete`. LoopRunState tách theo package: `packages: Record<packageId, { handoverCommit, codeReady, submittedCommits, redCommits }>`; các hàm record/verify/apply/consume/markRed có thêm biến thể theo package, hàm cũ giữ nguyên và delegate về package duy nhất (Solo). Reader: trạng thái từng package đọc từ `goal show` (bảng package) đối chiếu `metrics show` submitsByPackage (đã có sẵn theo từng package); tổng redGates của metrics chỉ là tổng, nên trạng thái đỏ theo từng package lấy từ goal show — nếu goal show không phân biệt được đỏ theo package thì reader suy ra từ drive-state reconcile và ghi rõ trong log, đó là APOS finding để route về (không sửa tay state). Dry-run thêm kịch bản multi-wp: WP-A code-ready + WP-B đỏ → package-submit cho WP-A, worker-fix cho WP-B; rồi mọi package green → integration-gate → integration-complete. (2) R-2 — integration gate lái lệnh APOS, không tự làm gate: khi mọi package green, nextStepForPackage trả `integration-gate`; driver (runner drive + live test) chạy `apos integration gate <goal> --commit <sha> --reason <text>` với integration commit là commit merge (không squash/rebase) chứa commit green của mọi package làm ancestor, rồi khi gate green thì `integration-complete` với cùng commit (+ --conflict-resolution nếu package chồng lấn); chỉ sau đó Goal mới verified → wait-human-close. Không thêm bước kiểm tra hợp nhất riêng trong package submit. (3) R-3 — drive theo từng package: runner drive nhận `--handover <pkg>:<sha>` lặp lại được (mỗi package một handover); `--handover <sha>` trơn vẫn được chấp nhận và hiểu là package duy nhất (Solo, tương thích cũ). Drive-state giữ một file cho mỗi project + goal như cũ (đường dẫn không đổi) nhưng nội dung tách theo package (map packages + submitted/red toàn cục dạng hợp của các package, để luật 'không submit lại commit đã đỏ của bất kỳ package nào' kiểm tra trên hợp đó). Reconcile từng package từ reader state theo package. baseCommit để verify handover vẫn đọc từ execution.md như GOAL-003; handover của package nào chỉ verify/submit cho package đó, không dùng chéo. (4) R-4 — live test 2 package: mở rộng src/live-test.ts với Goal mẫu Multi-WP (2 package WP-A/WP-B, file độc lập: greet-a/greet-b, không phụ thuộc nhau, không sharedPaths): lead propose (multi-wp) + package add + lead commit qua CLI trong test, rồi lái CHỈ bằng subprocess runner drive qua cả hai kịch bản green-first và red-then-green (đỏ ít nhất ở một package rồi fix); driver chạy integration gate/complete khi runner in bước đó, rồi Goal verified. (5) Test mới (vitest, file *-004.test.ts, test cũ không sửa hành vi): machine per-package + integration steps + Solo tương thích; reader parse trạng thái theo package (fixture output thật); loop/drive-state per-package + không submit lại commit đỏ chéo package; runner drive parse --handover theo package; live-test assert cả hai đường 2 package. (6) Cập nhật ORCHESTRATOR.md: bảng trạng thái theo package, drive nhiều package, integration gate; README.md ghi thêm một dòng khi cần. Không Tester step: Goal không ghim setup nên không có locked test; Worker viết code trực tiếp trên plan base.",
  "risks": [
    "metrics show chỉ có tổng redGates, không có đỏ theo từng package — reader phải lấy trạng thái đỏ theo package từ `goal show`; nếu goal show không phân biệt được thì reader suy ra từ drive-state reconcile và đó là APOS finding để route về, không sửa tay state .apos/controller",
    "APOS chỉ thông báo Multi-WP cho Human (không chờ duyệt) nhưng package add / lead commit vẫn là Lead; nếu lead commit đòi thêm điều kiện ngoài 2 package + acyclic + coverage (ví dụ paths khi không có setup) thì sửa plan theo thông báo lỗi, không sửa code APOS",
    "Live test Multi-WP chạy 2 Goal mẫu x 2 kịch bản, mỗi Goal qua approve/select pty + propose + 2 package add + commit + submit từng package + integration gate/complete — chậm hơn live test GOAL-003 rõ rệt; giới hạn 600s của CHK-4 có thể không đủ, khi đó Worker tách kịch bản đỏ thành Goal mẫu riêng vẫn trong cùng một lần chạy test:live",
    "Integration commit phải chứa commit green của mọi package làm ancestor (merge, không squash/rebase): driver trong live test phải merge đúng, nếu merge conflict do file chồng lấn thì tách file mẫu của 2 package hoàn toàn độc lập ngay từ đầu",
    "Drive-state một file cho mỗi project + goal: hai người lái cùng project + goal vẫn last-write-wins như GOAL-003; giả định một người lái tại một thời điểm, ghi rõ trong tài liệu",
    "APOS CLI text output (goal show) đổi format có thể phá parser trạng thái theo package của reader (rủi ro có sẵn, đã ghim bằng fixture output thật); inbox vẫn báo orphan R-11 sau khi GOAL-004 adopt đúng id là vấn đề APOS đã biết (issue #71), không thuộc phạm vi Goal này"
  ],
  "baseCommit": "a018ee520a61eee51c7acebdceb6e60ca673832f",
  "sourceSha256": "d32f0548992dcf6fee91e21f80543b9d384650025ba4509cea2fd8d0b5002cd1",
  "estimatedCost": {
    "wallMinutes": 420
  },
  "rationale": "Một Goal, hai seam độc lập nhưng phụ thuộc nhau: trạng thái theo package + integration (WP-CORE) là nền mà drive theo package + live test 2 package (WP-DRIVE) đứng trên; tách Solo hay gộp một package sẽ giấu đúng cái cần chứng minh (nhiều package song song).",
  "splitRationale": "Một session Solo không giữ được hai trạng thái package độc lập (code-ready/đỏ/green) cùng lúc mà không gộp chúng thành một trạng thái chung — đúng lỗi AC-1 cấm; tách thành 2 package song song (WP-CORE: machine + reader theo package; WP-DRIVE: drive + live test theo package) cho phép mỗi package green riêng rồi mới hợp nhất ở integration gate, và mỗi package có handover/submitted/red riêng.",
  "sharedPaths": [
    "ORCHESTRATOR.md",
    "README.md"
  ],
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
    "src/drive-state.ts",
    "src/index.ts",
    "src/live-test.ts"
  ],
  "entries": [
    "readGoalState",
    "nextStep",
    "nextStepForPackage",
    "isHumanGated",
    "runDryRun",
    "runLive",
    "runLiveTest",
    "loadDriveState",
    "saveDriveState"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "vitest: nextStepForPackage(state, pkg) trả bước đúng cho từng package — WP-A code-ready thì package-submit với commit của WP-A, WP-B đỏ thì worker-fix cho WP-B, không lẫn trạng thái; Solo (GoalState không có packages, hoặc chỉ một package) gọi nextStep cũ cho cùng đáp án như trước (test cũ không đổi hành vi)."
    },
    {
      "acceptanceId": "AC-2",
      "verification": "vitest + live test: executing + mọi package green → integration-gate; sau integration gate green → integration-complete; 1 package green + 1 chưa → chưa integration-gate (bước tiếp theo vẫn thuộc package chưa green). Driver chạy đúng lệnh APOS integration gate / integration complete, không tự làm gate riêng."
    },
    {
      "acceptanceId": "AC-3",
      "verification": "vitest: runner drive nhận --handover WP-A:<sha> --handover WP-B:<sha> (lặp lại được theo package), verify từng handover bằng git, giữ drive-state tách theo từng package (submitted/red theo từng package), và không bao giờ submit lại commit đã đỏ của bất kỳ package nào — kể cả gọi lại drive sau khi commit đã đỏ."
    },
    {
      "acceptanceId": "AC-4",
      "verification": "npm run test:live (CHK-4) mở rộng: tự dựng project mẫu có Goal thật Multi-WP 2 package song song và lái trọn Goal CHỈ bằng runner drive (subprocess), cả hai package green; đi qua cả hai đường — green ngay lần nộp đầu, và đỏ một lần rồi green sau fix (ít nhất ở một package). Check tự đủ trong worktree mới của gate (APOS #70): chỉ phụ thuộc APOS CLI (resolve như state reader) và git; pty provisioning cho approve/select của Goal mẫu giữ nguyên như GOAL-002/003."
    },
    {
      "acceptanceId": "AC-5",
      "verification": "npm test (CHK-1): toàn bộ test cũ pass; hành vi Solo của state machine, state reader, dry-run, runner live và chế độ drive giữ nguyên — thay đổi chỉ thêm nhánh/path mới cho nhiều package, được ghim bằng test mới (file *-004.test.ts)."
    },
    {
      "acceptanceId": "AC-6",
      "verification": "npm run build (CHK-2) passes."
    },
    {
      "acceptanceId": "AC-7",
      "verification": "vitest: ORCHESTRATOR.md mô tả bảng trạng thái theo từng package, cách runner drive xử lý nhiều package (--handover theo package, drive-state theo package), và integration gate; bảng khớp với state machine đã test."
    }
  ],
  "verificationStrategy": "Run npm test, npm run build, npm run dry-run và npm run test:live (các check CHK-1..CHK-4 của Goal); log của test:live là bằng chứng AC-4 cho cả hai đường green-first và red-then-green trên Goal mẫu 2 package"
}
```
