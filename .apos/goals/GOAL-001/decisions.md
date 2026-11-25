# Decisions for GOAL-001

- 2026-11-25T02:51:07.435Z Trạng thái Goal 'testing' (phase Tester đang viết test, chỉ gặp ở goal có setup) map sang bước 'tests-submit' trong nextStep; thêm một test mới ghim mapping này.
- 2026-11-25T02:51:07.834Z Không lệnh CLI nào của APOS lộ appetite (số lần thử tối đa): goal show, inbox --json, plan --json, metrics show đều không có. Vì vậy readGoalState nhận thêm tham số optional thứ 4 options?: { attemptsMax?: number } mặc định 3 (đúng appetite đã duyệt của GOAL-001), attemptsMax trả về luôn >= attemptsUsed; có tài liệu trong code và ORCHESTRATOR.md.
- 2026-11-25T02:51:08.246Z Default executor của readGoalState resolve APOS CLI từ biến môi trường APOS_CLI, nếu không có thì thử đường dẫn sibling ../apos/dist/cli.js tương đối từ repo này (layout trên máy này); ghi rõ cách resolve trong code và ORCHESTRATOR.md.
