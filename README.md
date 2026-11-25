# apos-orchestrator

Bộ orchestration cho APOS. APOS là lớp kiểm chứng và cố tình không có
orchestration (không start/wake/watch agent) — repo này là phần còn thiếu
đó, giữ riêng ngoài repo APOS theo đúng quy ước của nó (cấm thư mục
`runtime/` và cổng runtime trong APOS).

Ba phần:

1. **State reader** — đọc trạng thái Goal/project từ lệnh APOS
   (`apos inbox --json`, `apos goal list`, `apos goal show`) thành JSON.
2. **State machine** — từ trạng thái, quyết định bước tiếp theo đúng quy
   trình APOS (approve → select → lead propose → tests submit → code →
   package submit → red thì sửa lại, green thì chờ human close).
3. **Agent loop** — lặp: đọc trạng thái → gọi đúng role agent (theo skill
   trong `.apos/skills` của project đích) → kiểm chứng bằng lệnh APOS.
   Không bao giờ tự chạy lệnh chỉ human được chạy; gặp gate human thì
   dừng lại và báo cáo.

Phát triển qua chính APOS (xem `brief.md` và Goal trong `.apos/`).
