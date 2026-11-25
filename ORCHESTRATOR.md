# ORCHESTRATOR.md — Bộ orchestration cho APOS

APOS cố tình không có orchestration: nó không start, không wake, không
watch agent nào. Repo này là phần còn thiếu đó — một vòng lặp (loop) nhỏ
chạy trên máy này, đọc trạng thái APOS, gọi đúng role agent cho bước tiếp
theo, kiểm chứng bằng lệnh APOS, và chỉ dừng hỏi human ở các gate.

Phạm vi: quy trình Solo, một work package. Không tự approve/close thay
human, không Multi-WP, không chạy nền 24/7.

## Vòng lặp (loop)

Mỗi vòng lặp làm ba việc, rồi lặp lại từ đầu:

1. **Đọc trạng thái** — `readGoalState(projectPath, goalId)` trong
   `src/state-reader.ts` gọi lệnh APOS và trả về trạng thái hiện tại của
   Goal dưới dạng JSON (`GoalState`): id, status, có setup ghim không
   (`hasSetup`), test đã khoá chưa (`testsLocked`), số lần thử đã dùng
   (`attemptsUsed`), số lần thử tối đa (`attemptsMax`), trạng thái package
   (`packageStatus`). Nguồn chính là `apos inbox --json`; xem thêm mục
   "State reader" bên dưới.
2. **Chọn bước tiếp theo** — `nextStep(state)` trong
   `src/state-machine.ts` là hàm thuần túy: cùng một trạng thái ở goal khác
   nhau cho cùng một bước tiếp theo. Bảng trạng thái → bước tiếp theo ở
   mục dưới.
3. **Chạy bước đó rồi kiểm chứng** — vòng lặp gọi đúng role agent cho bước
   tiếp theo (đọc skill tương ứng trong `.apos/skills` của project đích:
   Lead propose/commit, Tester submit test, Worker viết/sửa code, Lead
   submit package), rồi quay lại bước 1 để đọc trạng thái mới và kiểm
   chứng bằng lệnh APOS.

Gặp bước có `humanGate: true` thì vòng lặp **dừng lại và báo cáo cho
human**, không tự chạy lệnh đó. Vòng lặp không bao giờ chạy bất kỳ lệnh
human-gated nào trong danh sách ở mục "Lệnh chỉ human được chạy".

## Bảng trạng thái → bước tiếp theo

Bảng này khớp với `nextStep` trong `src/state-machine.ts` (đã có test ghim
từng dòng). Khi các điều kiện chồng nhau, trạng thái package khác `none`
được ưu tiên trước nhánh tests/worker — package đã submit nghĩa là test đã
được submit rồi.

| Trạng thái Goal | Bước tiếp theo | Dừng ở human gate? |
|---|---|---|
| draft | wait-human-approve | có — chờ human approve |
| approved | wait-human-select | có — chờ human select |
| selected | lead-propose | không — Lead propose rồi lead-commit |
| testing | tests-submit | không — Tester đang viết test, submit test |
| executing, có setup, test chưa khoá, chưa có package | tests-submit | không |
| executing, không có setup (hoặc test đã khoá), chưa có package | worker-write-code | không |
| executing, package pending | package-submit | không |
| executing, package red, còn lượt thử | worker-fix | không — Worker sửa code rồi submit commit mới |
| executing, package red, hết lượt thử | report-human-blocked | có — dừng, báo cáo human |
| executing, package green | wait-human-close | có — chờ human close |
| executing, package needs-human | report-human-blocked | có — dừng, báo cáo human |
| verified | wait-human-close | có — chờ human close |
| blocked | report-human-blocked | có — dừng, báo cáo human |
| closed | done | không — không còn việc gì |

Ghi chú về `testing`: trạng thái này là phase Tester đang viết test, chỉ
gặp ở goal có setup; quyết định đã ghi cho GOAL-001 map nó sang
`tests-submit`.

Cột "Dừng ở human gate?" là giá trị `humanGate` mà `nextStep` trả về:
`true` đúng cho các bước chờ human (`wait-human-*`,
`report-human-blocked`), `false` cho các bước còn lại.

### Gate đỏ và số lần thử

Khi `package submit` trả về exit 1 (gate đỏ), vòng lặp quay lại bước
worker sửa code (`worker-fix`) rồi submit lại **commit mới** — không bao
giờ submit lại cùng một commit đã đỏ. Hết số lần thử tối đa thì vòng lặp
dừng và báo cáo human (`report-human-blocked`).

Số lần thử tối đa (`attemptsMax`): không lệnh CLI nào của APOS lộ appetite
của Goal (đã kiểm chứng: `goal show`, `inbox --json`, `plan --json`,
`metrics show` đều không có), nên `readGoalState` nhận tham số optional
thứ tư `options?: { attemptsMax?: number }`, mặc định là **3** — đúng
appetite đã duyệt của GOAL-001. Giá trị `attemptsMax` trả về luôn ít nhất
bằng `attemptsUsed`.

## Lệnh chỉ human được chạy

Vòng lặp **không bao giờ** tự chạy các lệnh sau (R-4). Danh sách đầy đủ,
khớp với `HUMAN_GATED_COMMANDS` trong `src/state-machine.ts`; hàm
`isHumanGated(command)` nhận diện cả dạng có tham số, ví dụ
`goal approve GOAL-001`:

- `goal approve`
- `goal appetite`
- `goal select`
- `outcome close`
- `outcome revise`
- `outcome stop`
- `gate confirm`
- `gate run --base`
- `blocker resolve`
- `setup approve`
- `exception approve --human`
- `bug approve`
- `maintenance approve`
- `hotfix`

Chỉ dạng có cờ mới bị chặn trong hai trường hợp: `gate run` trơn (không có
`--base`) và `exception approve` trơn (không có `--human`) không phải lệnh
human-gated. Vòng lặp cũng không bao giờ dùng `--on-behalf` khi human chưa
đồng ý rõ ràng.

## State reader

`readGoalState(projectPath, goalId, executor?, options?)` chỉ gọi 5 lệnh
đọc sau, không bao giờ gọi lệnh human-gated:

| Lệnh | Định dạng output |
|---|---|
| `inbox --json` | JSON (nguồn chính) |
| `plan --json` | JSON |
| `goal list` | text — không có cờ `--json` |
| `goal show <goalId>` | text — không có cờ `--json` |
| `metrics show <goalId>` | JSON mặc định, không cần cờ |

Reader không đọc trực tiếp file journal hay SQLite trong controller home;
CLI là giao diện duy nhất. Reader reject (throw) khi CLI fail (exit code
khác 0), output không parse được, hoặc không tìm thấy goal.

Cách map từ output CLI sang `GoalState` (đã ghim bằng test với output CLI
thật đã ghi lại trong `src/test-fixtures/`):

- `status` lấy từ `goal show`.
- `hasSetup` là `false` khi `goal show` báo "không có setup".
- `testsLocked` là `false` khi `goal show` báo "không có khoá test" (goal
  không ghim setup); nếu không, theo dòng "Test đã khoá" — khoá khi giá
  trị khác "không có".
- `attemptsUsed` là tổng số lần submit package (tổng `submitsByPackage`
  trong `metrics show`); riêng `redGates` không tính là lượt thử.
- `packageStatus`: `none` khi chưa submit lần nào; `red` khi mọi package
  đã submit đều đỏ (`redGates` bằng tổng số submit và lớn hơn 0);
  `pending` khi đã submit nhưng chưa có kết quả.

### Cách resolve APOS CLI

Khi không inject executor (test inject executor giả), reader mặc định chạy
`node <cli> --repo <projectPath> <args>`, với `<cli>` được resolve như sau:

1. Biến môi trường `APOS_CLI` nếu có (đường dẫn tới entry point của CLI
   APOS, ví dụ `~/workspace/apos/dist/cli.js`).
2. Nếu không có, thử đường dẫn sibling `../apos/dist/cli.js` tương đối từ
   repo này — repo orchestrator và repo APOS nằm cạnh nhau dưới cùng một
   thư mục cha trên máy này.

Nếu cả hai đều không có, `readGoalState` reject với lỗi nói rõ cách trỏ
tới CLI.

## Dry run

`npm run dry-run` chạy `runDryRun()` trong `src/loop.ts` trên ba kịch bản
mẫu, đi bộ (walk) các trạng thái mẫu qua `nextStep` thật — chuỗi bước in
ra là đáp án của state machine, không phải chuỗi hardcode — và dừng ở
human gate đầu tiên của mỗi kịch bản:

- `with-setup`: lead-propose -> lead-commit -> tests-submit ->
  package-submit -> wait-human-close
- `without-setup`: lead-propose -> lead-commit -> worker-write-code ->
  package-submit -> wait-human-close
- `red-gate`: lead-propose -> lead-commit -> worker-write-code ->
  package-submit -> worker-fix -> package-submit -> report-human-blocked

Dry run không tạo commit, không gọi lệnh human-gated nào, không sửa file
thật. `humanGatedAttempted` là `false` ở mọi kịch bản; nếu chuỗi bước sai
hoặc có human-gated, entry `src/dry-run.ts` throw và thoát với exit code
khác 0.

## Kiểm chứng

- `npm test` — vitest: state machine, state reader (với output CLI thật
  đã ghi lại), dry run, và tài liệu này.
- `npm run build` — `tsc` (strict).
- `npm run dry-run` — `node dist/dry-run.js`.
