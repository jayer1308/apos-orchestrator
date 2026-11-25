# Brief: Cho runner tự lái trọn Goal — chế độ drive với handover và đường đỏ

## Bối cảnh

GOAL-002 đã sửa tín hiệu code-ready: state machine có `codeReady` +
`handoverCommit`, `LoopRunState` giữ handover trong `src/loop.ts`, và
runner live `npm run live` đọc trạng thái thật rồi in bước tiếp theo.
Test lại ngày 25/11 trên GOAL-003 thật trong repo so-chi-tieu
(tong-ket --nam YYYY): loop lái từ selected tới verified, gate green
ngay lần nộp đầu — nhưng người lái vẫn phải tự giữ LoopRunState và
chạy `recordHandover → verifyHandover → applyHandover → nextStep`
qua API bằng script tay (/tmp/live-step-003.mjs).

## Vấn đề

Runner live (`npm run live -- --repo <project> --goal <id>`) hiện chỉ
là máy in bước chỉ-đọc: nó gọi `nextStep` trực tiếp trên state của
reader, không giữ `LoopRunState`, không nhận được commit handover của
Worker, nên sau bước worker-write-code nó vẫn trả `worker-write-code`
mãi — đúng chỗ từng kẹt ở lần test GOAL-002, chỉ khác là giờ state
machine đã có tín hiệu code-ready nhưng runner không đưa handover vào
đó. Muốn lái trọn một Goal chỉ bằng runner thì vẫn cần script tay.

Còn một câu hỏi mở từ GOAL-002 ở đường đỏ: machine trả `worker-fix`
cả khi đã có handover mới — trạng thái `red` chỉ đổi sau một lần
submit — nên vòng lặp phải fix xong submit ngay handover mới đó trong
cùng bước fix, nếu không sẽ kẹt lại đúng kiểu lỗi cũ ở đường đỏ.

## Yêu cầu

R-1: Runner có chế độ lái đầy đủ: một lệnh duy nhất (`npm run live
-- --repo <project> --goal <id> --drive`; tên cờ do Lead quyết) tự
giữ LoopRunState qua các bước. Runner nhận commit handover của Worker
bằng cờ `--handover <sha>` (người lái truyền commit Worker vừa bàn
giao); tự verify handover bằng git rồi trả `package-submit` với đúng
commit đó — không cần script tay giữ handover như lần test GOAL-003.
Runner giữ lại danh sách commit đã submit/đã đỏ qua các lần gọi, để
không bao giờ submit lại commit đã đỏ. Cách lưu trạng thái chạy (file
trạng thái hay tiến trình chạy dài) do Lead quyết.
R-2: Runner vẫn dừng đúng ở human gate (chờ approve, chờ select,
wait-human-close, report-human-blocked) và KHÔNG BAO GIỜ chạy lệnh
human (approve/select/close, gate confirm, --on-behalf...) — chỉ in
và dừng, như runner hiện tại.
R-3: Đường đỏ: sau khi gate đỏ, Worker fix xong bàn giao handover
mới thì runner tự chuyển sang submit handover mới đó, không kẹt lại
ở worker-fix. Thiết kế do Lead quyết: hoặc machine trả
`package-submit` khi red + handover mới đã kiểm chứng, hoặc runner
submit ngay trong bước fix như quy ước đã ghi trong ORCHESTRATOR.md
— hành vi quan sát được phải giống nhau: không hỏi lại machine rồi
lại nhận worker-fix cho cùng một lần đỏ.
R-4: Bằng chứng live: mở rộng `npm run test:live` (hoặc script mới)
tự dựng project mẫu và lái trọn Goal thật từ selected tới green CHỈ
bằng runner ở chế độ drive (không script tay giữ handover). Live test
phải đi qua cả hai đường: green ngay lần nộp đầu, và đỏ một lần rồi
green sau khi fix. Check live phải tự đủ: tự dựng project mẫu của nó,
vì mỗi check của gate chạy trong một worktree mới riêng (xem APOS #70).
R-5: Các test cũ vẫn pass, không phá behaviour đã có (state machine,
state reader, dry-run, runner live hiện tại).
R-6: `npm test` pass.
R-7: `npm run build` pass.
R-8: Tài liệu ORCHESTRATOR.md cập nhật: chế độ drive, cách nhận
handover (`--handover <sha>`), cách giữ trạng thái chạy, và đường đỏ.
R-9: Hỗ trợ Multi-WP (nhiều work package song song).
R-10: Chạy như service nền 24/7.
R-11: Runner tự chạy lệnh human (approve/select/close, --on-behalf).

## Ghi chú

Chế độ drive không thay đổi vai trò của người lái: runner chỉ đọc
trạng thái, giữ handover và in bước tiếp theo; việc gọi role agent
cho từng bước vẫn do agent điều phối thực hiện. Runner không tự chạy
lệnh APOS nào ngoài lệnh đọc để lấy trạng thái và lệnh git để kiểm
chứng handover.
