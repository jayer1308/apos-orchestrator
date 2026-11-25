# Brief: Bộ orchestration cho APOS

## Bối cảnh

APOS là lớp kiểm chứng cho phần mềm do AI viết. APOS cố tình không có
orchestration: nó không start, không wake, không watch agent nào. Việc
điều phối (ai làm bước nào, khi nào) thuộc về người orchestrate.

## Mục tiêu

Xây một bộ orchestration nhỏ, chạy được trên máy này, để team dev làm việc
qua APOS một cách tự động: đọc trạng thái APOS, gọi đúng role agent cho
bước tiếp theo, kiểm chứng bằng lệnh APOS, và chỉ dừng hỏi human ở các
gate. Bộ này là repo riêng, không nằm trong repo APOS.

## Yêu cầu

R-1: State reader gọi lệnh APOS và trả về trạng thái hiện tại của một Goal
và project đích dưới dạng JSON. Nguồn chính là `apos inbox --json`; vì
`goal list`, `goal show`, `metrics show` chưa có cờ --json nên reader phải
parse output text của các lệnh đó.
R-2: State machine viết bằng TypeScript, test được bằng vitest: từ trạng
thái của một Goal, trả về đúng bước tiếp theo theo quy trình Solo của APOS.
Không hardcode theo một goal cụ thể nào; cùng một trạng thái ở goal khác
nhau phải cho cùng một bước tiếp theo.
R-3: Agent loop gồm code runner tối thiểu và tài liệu ORCHESTRATOR.md: lặp
lại đọc trạng thái, gọi đúng role agent (đọc skill tương ứng trong
`.apos/skills` của project đích) cho bước tiếp theo, kiểm chứng bằng lệnh
APOS, rồi lặp.
R-4: Vòng lặp không bao giờ tự chạy các lệnh chỉ human được chạy (goal
approve, goal appetite, goal select, outcome close, outcome revise,
outcome stop, gate confirm, gate run --base, blocker resolve, setup
approve, exception approve --human, bug approve, maintenance approve,
hotfix). Gặp gate human thì vòng lặp dừng lại và báo cáo.
R-5: Khi gate đỏ (package submit trả về exit 1), vòng lặp quay lại bước
worker sửa code rồi submit lại commit mới. Hết số lần thử tối đa thì vòng
lặp dừng và báo cáo human.
R-6: Chạy thử khô (dry run) trên một project mẫu cho ra đúng chuỗi bước
theo quy trình APOS, không chạy lệnh human-gated nào.
R-7: `npm test` pass.
R-8: `npm run build` pass.
R-9: Tài liệu ORCHESTRATOR.md mô tả đủ vòng lặp, bảng trạng thái chuyển
sang bước tiếp theo, và danh sách lệnh human-gated không được chạy.
R-10: Tự động approve hoặc close thay human.
R-11: Hỗ trợ Multi-WP (nhiều work package song song).
R-12: Chạy như service nền 24/7.

## Ghi chú

State reader dùng CLI của APOS làm giao diện chính, không đọc trực tiếp
file journal hay SQLite trong controller home (`~/.apos/projects/`).
