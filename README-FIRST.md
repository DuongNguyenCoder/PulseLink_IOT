# PulseLink Agent Foundation

Bộ nền tảng để thống nhất cách các AI coding agent làm việc trong repository PulseLink.

## Mục tiêu
- Một bộ quy tắc nghiệp vụ/kỹ thuật thống nhất cho mọi agent.
- Giữ nguyên stack đã chọn: ESP32-S3 + Fastify 5 + TypeScript + Prisma 7.10 + PostgreSQL + FCM.
- Feature nhỏ, module rõ, kiểm thử được, migration có kiểm soát.
- Không để agent tự ý nâng major version, xóa dữ liệu hoặc thay đổi kiến trúc.

## Cách áp dụng
1. Sao lưu `D:\project-PulseLink` hoặc commit thay đổi hiện tại trước khi chép file.
2. Giải nén ZIP vào `D:\project-PulseLink`, chọn **Merge/Keep both** nếu Windows hỏi.
3. Các file hướng dẫn ở root như `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/`, `.windsurf/`, `.github/` áp dụng ở root repository.
4. File trong `server/api/` áp dụng cho backend API.
5. Bộ này có các file code mới trong `server/api/src/`. Nếu đã có file trùng tên, hãy so sánh trước khi ghi đè. `src/server.ts`, `package.json`, `tsconfig.json` và `prisma7.config.ts` là các file cần review khi tích hợp.
6. Không thay thế `prisma/schema.prisma` của bạn bằng schema mẫu; giữ model/migration đã tạo và chỉ cập nhật generator output theo hướng dẫn bên dưới.

## Cấu hình Prisma 7.10
- Bộ này thống nhất dùng Prisma 7.10.x; `prisma` và `@prisma/client` phải cùng major (tốt nhất cùng minor).
- Prisma 7.10 có thể nhận `prisma7.config.ts`. Vì repo hiện có cả `prisma.config.ts` và `prisma7.config.ts`, không tự ý đổi tên hoặc xóa file nào. Trước khi chỉnh Prisma, xác minh file CLI đang dùng bằng lệnh và package scripts hiện tại; giữ cả hai cho đến khi tác động được review.
- Trong `prisma/schema.prisma`, generator nên dùng:
  `provider = "prisma-client"`
  `output = "../src/generated/prisma"`
  (đường dẫn tính từ thư mục `prisma/`).
- `datasource db` giữ `provider = "postgresql"`; URL nằm trong `prisma7.config.ts`.
- Prisma 7 cần driver adapter khi chạy ứng dụng PostgreSQL.

## Cài các dependency bổ sung
Từ `D:\project-PulseLink\server\api`:
```powershell
npm install zod dotenv pg @prisma/adapter-pg
npm install -D @types/pg prettier
```

Sau khi merge package scripts/dependencies, chạy:
```powershell
npm install
npx prisma validate
npx prisma generate
npm run typecheck
npm run build
npm run dev
```

Nếu `prisma validate` báo lỗi config hoặc schema, dừng lại và sửa lỗi trước; không chạy migration một cách mù quáng.
