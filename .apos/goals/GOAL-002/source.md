# Brief: Sửa bộ orchestration — vòng lặp kẹt ở worker-write-code khi chạy live

## Bối cảnh

GOAL-001 đã xong: state reader, state machine và dry-run đều có test.
Live-test ngày 25/11 trên GOAL-002 thật trong repo so-chi-tieu (thêm cờ
--gioi-han cho liệt kê): loop lái đúng 2 bước đầu (lead propose/commit,
worker viết code) rồi kẹt ở worker-write-code, không bao giờ tới được
package-submit. GOAL-002 đó đã phải nộp và đóng bằng tay (gate green lần
đầu, đã merge và push lên GitHub).

## Vấn đề

GoalState không có tín hiệu nào cho "code đã sẵn sàng, chờ submit". Bước
package-submit chỉ reachable khi packageStatus là pending, mà pending chỉ
xuất hiện sau khi đã submit — vòng luẩn quẩn. Dry-run che lỗi này vì nó
đi bộ qua các state giả lập mà người viết đã xếp sẵn (pending xuất hiện
"từ hư không" trong kịch bản mẫu, không qua trạng thái code-ready nào).

## Yêu cầu

R-1: Sửa chuyển tiếp worker→submit: loop nhớ commit Worker đã bàn giao
rồi tự chạy package-submit với commit đó. State machine thêm tín hiệu
code-ready (ví dụ: commit mới sau lead-commit do Worker bàn giao).
Thiết kế chi tiết do Lead quyết lúc thực thi, nhưng hướng sửa phải là:
trạng thái "executing, chưa có package, Worker đã bàn giao commit" cho
bước tiếp theo là package-submit với commit đó, không quay lại
worker-write-code vô hạn.
R-2: Thêm runner live thật: một lệnh chạy được (npm run live -- --repo
<project> --goal <id>) đọc trạng thái thật qua CLI (readGoalState) và in
bước tiếp theo (nextStep). Không còn placeholder: src/index.ts hiện chỉ
là placeholder, phải được thay bằng entry thật (hoặc file entry mới).
R-3: Đọc appetite (maxAttempts) từ output CLI khi có (inbox --json,
plan --json, goal show, metrics show — lệnh nào có thì đọc); nếu không
có thì giữ mặc định 3 và ghi rõ trong log/output là đang dùng mặc định
(liên quan issue APOS #69).
R-4: Live-test vòng lặp đã sửa trên một Goal thật: lái từ selected tới
green. Bằng chứng là log lần chạy live thật trên repo mẫu (không chỉ
dry-run). Check live (npm run test:live) phải tự đủ: tự dựng project
mẫu của nó, vì mỗi check của gate chạy trong một worktree mới riêng
(xem APOS #70).
R-5: Các test cũ vẫn pass, không phá behaviour đã có (state machine,
state reader, dry-run).
R-6: `npm test` pass.
R-7: `npm run build` pass.
R-8: Tài liệu ORCHESTRATOR.md cập nhật: mô tả tín hiệu code-ready,
runner live, và cách đọc appetite.
R-9: Hỗ trợ Multi-WP (nhiều work package song song).
R-10: Chạy như service nền 24/7.

## Ghi chú

Runner live chỉ gọi lệnh đọc của CLI để lấy trạng thái; việc gọi role
agent cho bước tiếp theo vẫn do agent điều phối thực hiện (như GOAL-001).
