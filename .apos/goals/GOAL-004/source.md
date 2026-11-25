# Brief: Hỗ trợ Multi-WP — nhiều work package song song (nhận R-11 từ GOAL-001)

## Bối cảnh

GOAL-001 của apos-orchestrator đã loại R-11 "Hỗ trợ Multi-WP (nhiều
work package song song)" với lý do hoãn sang GOAL-002: "Multi-WP cần
máy trạng thái cho nhiều package song song và integration gate; làm
sau khi Solo chạy được." GOAL-002 đóng mà không nhận R-11, nên
`apos inbox` báo orphan-requirement cho R-11 từ 25/11 10:48 +07.
GOAL-003 sau đó cũng loại Multi-WP (R-9, out-of-scope, "làm sau khi
Solo chạy được live") — kiểm tra lại lúc 11:54 +07 ngày 25/11, inbox
vẫn chỉ còn đúng một mục: orphan R-11, và APOS ghi rõ cách xử lý là
một Goal mới nhận R-11 (giữ nguyên requirement id) hoặc loại nó bằng
exclusion.

Điều kiện hoãn giờ đã đủ: Solo đã chạy được live (GOAL-002/GOAL-003
trong so-chi-tieu) và runner đã tự lái trọn một Goal bằng chế độ drive
(GOAL-003 của apos-orchestrator, đóng 25/11 11:30 +07, gate green cả
hai đường green ngay và đỏ-rồi-green). Đây là lúc nhận R-11.

## Vấn đề

State machine và runner hiện tại chỉ biết một package duy nhất trong
một Goal: một trạng thái package, một handover, một lần submit. Một
Goal có nhiều work package song song (ví dụ hai WP độc lập cùng làm
trong một Goal) thì loop không phân biệt package nào đã sẵn sàng nộp,
package nào đang đỏ, và không có bước nào kiểm tra các package hợp
lại với nhau trước khi đóng Goal.

## Yêu cầu

R-11: Hỗ trợ Multi-WP (nhiều work package song song). — Nhận lại
requirement R-11 từ GOAL-001, giữ nguyên id R-11 theo đúng yêu cầu
của inbox notice.
R-1: State machine theo dõi trạng thái theo từng package: package nào
đã code-ready (có handover đã kiểm chứng), package nào đang đỏ, package
nào đã green — và trả bước tiếp theo đúng cho từng package. Trường hợp
một package (Solo) vẫn chạy đúng như hiện tại, không phá behaviour cũ.
R-2: Có integration gate: khi mọi package đã green riêng lẻ thì có một
bước kiểm tra hợp nhất trước khi Goal được đóng (thiết kế do Lead
quyết: APOS đã có sẵn lệnh `integration gate` / `integration complete`
cho Multi-WP — loop lái các lệnh này — hay một bước trong package submit).
R-3: Runner ở chế độ drive xử lý được nhiều package: nhận handover
theo từng package (cách truyền handover cho từng package do Lead
quyết), giữ drive-state theo từng package, không bao giờ submit lại
commit đã đỏ của bất kỳ package nào.
R-4: Bằng chứng live: mở rộng `npm run test:live` (hoặc script mới)
tự dựng project mẫu và lái trọn một Goal thật có 2 package song song
CHỈ bằng runner ở chế độ drive, cả hai package đều green. Live test
đi qua cả hai đường như Solo: green ngay lần nộp đầu, và đỏ một lần
rồi green sau khi fix (ít nhất ở một package). Check live phải tự đủ:
tự dựng project mẫu của nó, vì mỗi check của gate chạy trong một
worktree mới riêng (xem APOS #70).
R-5: Các test cũ vẫn pass, không phá behaviour đã có (state machine
Solo, state reader, dry-run, runner live, chế độ drive).
R-6: `npm test` pass.
R-7: `npm run build` pass.
R-8: Tài liệu ORCHESTRATOR.md cập nhật: bảng trạng thái theo từng
package, cách runner drive xử lý nhiều package, và integration gate.
R-9: Chạy như service nền 24/7. (out-of-scope — giữ nguyên như
GOAL-001/002/003: chạy nền cần thêm giám sát, log và cơ chế dừng an toàn.)
R-10: Runner tự chạy lệnh human (approve/select/close, --on-behalf).
(out-of-scope — runner không bao giờ chạy lệnh human-gated; human gate
luôn dừng lại để human quyết.)

## Ghi chú

Đây là bản draft để coordinator/PM dùng làm đầu vào khi tạo Goal —
chưa phải Goal đã duyệt. Size/appetite/số lần thử do PM đề xuất và
Human quyết ở gate A, như các Goal trước. R-9 và R-10 giữ nguyên là
out-of-scope như GOAL-001/002/003 (chạy nền 24/7 cần thêm giám sát;
runner không bao giờ chạy lệnh human-gated).
