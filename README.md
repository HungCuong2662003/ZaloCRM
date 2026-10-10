# CRM Zalo - Quản lý nhiều tài khoản và công việc nhóm

Mã nguồn: [HungCuong2662003/ZaloCRM](https://github.com/HungCuong2662003/ZaloCRM).

Ứng dụng web tự lưu trữ để quản lý nhiều tài khoản Zalo, hội thoại, khách hàng, thành viên, link nhóm và job chạy nền. Frontend dùng Vue 3 + Vuetify; backend dùng Node.js + Fastify + Prisma; dữ liệu chính lưu PostgreSQL.

## Chức năng

### 1. Quản lý nhiều tài khoản Zalo

- Thêm nick bằng QR tại **Cài đặt > Kênh > Zalo** (`/settings/channels/zalo`).
- Xem trạng thái kết nối, quản lý phiên đăng nhập và cấu hình proxy theo tài khoản.
- Chọn nick để thao tác với nhóm, thành viên, link và job của nick đó.
- Job gắn với ID tài khoản Zalo; đổi nick trên giao diện không chuyển job sang nick khác.

### 2. Chat và tin nhắn nhanh

- Gửi/nhận tin cá nhân và nhóm, cập nhật hội thoại qua Socket.IO.
- Chat hỗ trợ ảnh, video, audio, file, sticker, trả lời, chuyển tiếp và cảm xúc theo khả năng SDK.
- Lưu nội dung bằng **Lưu tin này**, chọn lại qua **Tin nhắn nhanh** trong form gửi riêng và form job gửi nhóm.
- Mẫu nhanh lưu văn bản. Ảnh của job được chọn riêng, không mặc định đi kèm mẫu.

### 3. Quét nhóm và quản lý thành viên

**Marketing > Quét nhóm** (`/marketing/group-scan`):

- Lấy danh sách nhóm của nick đang chọn, tìm và chọn nhóm cần xử lý.
- Quét thành viên bằng worker nền, theo dõi trạng thái quét.
- Lọc thành viên, xuất Excel và lưu vào tệp khách hàng.
- Tạo job gửi nhóm từ nhóm đã chọn, không cần quét thành viên trước.

**Marketing > Thành viên quét** (`/marketing/group-audience`):

- Xem thành viên đã lưu theo nick và nhóm nguồn.
- Lọc tên/UID, bạn bè, đã nhắn, đã kết bạn và không liên hệ.
- Mở modal gửi tin riêng, nhập nội dung/chọn mẫu và đính kèm ảnh.
- Gửi lời mời kết bạn, xem trạng thái và lỗi từng thành viên.

Gửi người lạ có thể bị Zalo từ chối do quyền riêng tư, hạn mức hoặc tình trạng tài khoản. Chỉ liên hệ người đã đồng ý nhận tin.

### 4. Job gửi tin nhóm

Trong **Quét nhóm**, chọn nick và nhóm rồi bấm **Gửi tin nhóm**:

- Nhập nội dung hoặc chọn tin nhắn nhanh; thêm ảnh có preview.
- Đặt khoảng delay thấp nhất/cao nhất giữa các lần gửi.
- Chọn ngày, giờ dừng; bật lặp danh sách nhóm và thời gian nghỉ giữa vòng nếu cần.
- **Lưu job** giữ bản nháp; **Lưu + chạy** bắt đầu gửi.
- **Theo dõi job** mở màn riêng: trạng thái, tiến độ, số gửi/lỗi, số vòng, log từng nhóm.
- **Tải lại** lấy tiến độ mới nhất; không cần mở CMD để theo dõi nghiệp vụ.
- Có **Start**, **Dừng**, **Sửa**, **Xóa**. Dừng job trước khi sửa nhóm, nội dung hoặc lịch chạy.
- Job và log lưu tại `group_send_jobs`, `group_send_job_logs`, không chỉ nằm trong RAM.

**Khôi phục sau restart:** backend tìm lại job đang chờ/đang chạy và một số job lỗi kết nối hoặc DB tạm thời. Watchdog kiểm tra mỗi 30 giây. Job bản nháp, đã hoàn thành, dừng thủ công hoặc quá giờ dừng không tự bật vô điều kiện. Nick phải kết nối mới gửi được.

Đóng trình duyệt không dừng job. Tắt máy, Docker hoặc backend thì job không chạy; cần khởi động server lại.

### 5. Job lấy nội dung dịch vụ từ API

Nút **Auto dịch vụ** trong **Quét nhóm** tạo job riêng cho nick và nhóm đã chọn:

- Lấy danh sách dịch vụ từ API, gom theo category và gửi lần lượt các category.
- Cấu hình delay, chu kỳ gửi, ngày/giờ dừng.
- Xem category cuối và lỗi API trong màn theo dõi job.

Cấu hình tùy chọn trong `.env`:

| Biến | Ý nghĩa |
|---|---|
| `MXHCARE_API_KEY` | Khóa API, bắt buộc khi dùng chức năng này |
| `MXHCARE_API_URL` | Endpoint, mặc định `https://mxhcare.com/api/v2` |
| `USD_TO_VND` | Tỷ giá quy đổi |
| `SELLING_MARKUP_PERCENT` | Phần trăm cộng vào giá |
| `MXHCARE_RATE_PER` | Số đơn vị hiển thị cùng giá |
| `COMPANY_WEBSITE`, `COMPANY_PHONE`, `SUPPORT_USERNAME` | Thông tin liên hệ trong nội dung gửi |

API nhận POST dạng form với `key` và `action=services`. Không cần chạy bot Telegram để dùng job này. Không đưa khóa API lên GitHub.

### 6. Quét tin nhắn lấy link nhóm

Trong **Marketing > Link nhóm** (`/marketing/group-links`):

- Chọn nick, nhóm nguồn hoặc phạm vi quét trên màn hình.
- Trích link Zalo, Telegram, Facebook và web từ tin nhắn đã có trong DB CRM.
- Lưu URL chuẩn hóa, nick/nhóm/tin nhắn nguồn và thời gian phát hiện.
- Lọc trùng theo **nick + URL chuẩn hóa**; quét lại không tạo bản ghi trùng cho cùng nick.
- Lưu lần quét cuối, số tin quét, số link tìm thấy và lỗi theo nhóm nguồn.
- Lọc và xuất Excel để xem lại kết quả.

**Giới hạn:** quét dữ liệu CRM đã nhận/đồng bộ, không bảo đảm lấy toàn bộ lịch sử Zalo. Nhóm chưa có tin trong DB có thể không ra link. Phát hiện link Telegram/Facebook không đồng nghĩa hỗ trợ tự join các nền tảng đó; luồng tham gia bên dưới dành cho Zalo.

### 7. Nhập, kiểm tra và tham gia nhóm Zalo

Trong **Link nhóm**:

- Paste nhiều link hoặc import TXT/CSV/XLSX, bấm **Lưu + kiểm tra link**.
- Chuẩn hóa link, lọc trùng theo nick; xem kết quả nhập và kiểm tra.
- Xem tên/ID nhóm, số thành viên, tình trạng link, quyền xem thành viên/nhắn tin và tình trạng nick trong nhóm.
- Lọc nhóm đã/chưa tham gia, chờ duyệt, link sống/chết/chưa rõ và quyền nhóm.
- **Tham gia** từng link hoặc **Tham gia tất cả link đã chọn**, có khoảng delay giữa lần xử lý.
- Xuất Excel toàn bộ hoặc danh sách đã chọn.
- Link lưu theo nick; cùng link có thể tồn tại ở nhiều nick với trạng thái tham gia khác nhau.

Nhóm yêu cầu duyệt có thể chỉ nhận yêu cầu, chưa phải đã join. Lỗi giới hạn request/kết nối không đủ để kết luận link chết. Quyền nhắn tin có thể chưa xác định hoặc thay đổi sau khi tham gia.

### 8. Job tự tham gia nhóm

Phần **Auto tham gia nhóm** trong **Link nhóm**:

- Tạo job từ link đã chọn hoặc tất cả link hợp lệ theo tiêu chí.
- Chọn tình trạng link, quyền nhắn tin, quyền xem thành viên và tình trạng nick trong nhóm.
- Đặt số nhóm tối đa mỗi ngày, khoảng delay và thời điểm dừng.
- Đủ hạn mức ngày thì chờ; xem thời điểm chạy tiếp trên giao diện.
- Có Start/Dừng/Sửa/Xóa, thống kê đã join/bỏ qua/lỗi và log.
- Lưu DB tại `group_join_jobs`, `group_join_job_logs`.

Đổi nick trên giao diện không chuyển job nick cũ sang nick mới. Chọn đúng nick trước khi tạo job mới.

### 9. CRM, báo cáo và tích hợp

| Module | Chức năng |
|---|---|
| Khách hàng | Hồ sơ, ghi chú, tag, trạng thái/pipeline, rà soát trùng, lịch sử tương tác |
| Tệp khách hàng | Lưu, import và quản lý danh sách tại `/marketing/lists` |
| Lịch hẹn | Tạo, theo dõi và cấu hình nhắc hẹn |
| Dashboard/Báo cáo | Tổng quan, vận hành nick, sale, pipeline, tương tác và audit |
| Phân quyền | Người dùng, phòng ban, nhóm quyền và phạm vi dữ liệu |
| Kho media | Quản lý tệp; lưu local hoặc object storage tùy cấu hình |
| Tích hợp | Cầu Zalo - Telegram, AI, API key và webhook; cần cấu hình dịch vụ tương ứng |

Một số màn cài đặt vẫn là **Coming Soon** hoặc thuộc extension không có trong bản Community. Tên menu không chứng minh chức năng đã hoàn chỉnh. AI, tích hợp và đồng bộ phụ thuộc cấu hình, quyền và dịch vụ bên ngoài.

## Chạy bằng Docker Desktop

### Chuẩn bị

- Docker Desktop chạy Linux containers; Git để clone/cập nhật.
- Không cần cài PostgreSQL, Redis hoặc Node.js riêng khi dùng Compose.
- Chạy đủ app, PostgreSQL, Redis, MinIO, ClamAV nên dành ít nhất 4 GB RAM và theo dõi thực tế.

### Cài mới

1. Clone và tạo cấu hình trong PowerShell:

   ```powershell
   git clone https://github.com/HungCuong2662003/ZaloCRM.git
   cd ZaloCRM
   Copy-Item .env.example .env
   ```

2. Sửa `.env`: tạo `JWT_SECRET` ngẫu nhiên tối thiểu 32 ký tự, `ENCRYPTION_KEY` là 64 ký tự hex, đặt mật khẩu riêng PostgreSQL và MinIO. Chạy lại lệnh sau để tạo từng secret khác nhau:

   ```powershell
   docker run --rm node:20-alpine node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Các biến cần rà soát:

   ```dotenv
   APP_PORT=3080
   APP_URL=http://localhost:3080
   CRM_LOGIN_URL=http://localhost:3080
   DB_USER=crmuser
   DB_NAME=zalocrm
   DB_PASSWORD=THAY_BANG_MAT_KHAU_RIENG
   JWT_SECRET=THAY_BANG_SECRET_NGAU_NHIEN
   ENCRYPTION_KEY=THAY_BANG_64_KY_TU_HEX
   MINIO_ROOT_USER=crmstorage
   MINIO_ROOT_PASSWORD=THAY_BANG_MAT_KHAU_RIENG
   STORAGE_DRIVER=local
   REDIS_URL=redis://redis:6379
   AUTOMATION_STUB_MODE=false
   FRIEND_INVITE_TEST_MODE=false
   ```

   Không dùng nguyên mật khẩu/secret mẫu. Compose dựng `DATABASE_URL` từ `DB_USER`, `DB_PASSWORD`, `DB_NAME`; dùng mật khẩu phù hợp URL hoặc mã hóa ký tự đặc biệt. Không ghi đè `.env` nếu máy đã có cấu hình.

3. Build, khởi động và áp migration:

   ```powershell
   docker compose up -d --build
   docker compose exec app npx prisma migrate deploy
   docker compose restart app
   docker compose ps
   ```

   Image hiện tại không tự áp migration khi startup. Nếu build, healthcheck hoặc migration lỗi, xử lý trước khi sử dụng.

4. Mở [http://localhost:3080](http://localhost:3080). Lần đầu vào `/setup` tạo tổ chức và tài khoản chủ, đăng nhập rồi thêm nick bằng QR.

Máy đã có DB/tài khoản chỉ cần mở Docker Desktop và chạy `docker compose up -d`; không tạo tổ chức hoặc đăng nhập QR lại nếu phiên còn hợp lệ.

### Bật, dừng và cập nhật

Chạy trong thư mục có `docker-compose.yml`:

```powershell
# Bật lại bản đã build
docker compose up -d

# Dừng tạm, giữ container và dữ liệu
docker compose stop

# Gỡ container, giữ named volumes và dữ liệu
docker compose down

# Xem trạng thái và log kỹ thuật
docker compose ps
docker compose logs --tail 100 app
```

Sau khi backup DB và kiểm tra thay đổi local, cập nhật:

```powershell
git pull --ff-only origin main
docker compose up -d --build app
docker compose exec app npx prisma migrate deploy
docker compose restart app
```

`restart: unless-stopped` chỉ hoạt động khi Docker engine chạy. Có thể bật Docker Desktop cùng Windows; nếu đã chủ động stop/down, chạy lại `docker compose up -d`. Muốn chạy liên tục cần máy chủ hoạt động liên tục, không phải máy đã tắt.

## Dữ liệu lưu ở đâu?

| Nơi lưu | Nội dung |
|---|---|
| PostgreSQL, volume `pg_data` | User, tài khoản/phiên Zalo, khách hàng, tin nhắn, thành viên, link, job và log |
| Redis, volume `redis_data` | Queue, cache và dữ liệu vận hành |
| Volume `file_storage` | File local tại `/var/lib/zalo-crm/files` |
| Volume `minio_data` hoặc R2/S3 | Object storage, tùy driver/cấu hình |
| Thư mục `backups/` | Backup PostgreSQL do service backup tạo |

Tên volume thực tế thường có tiền tố Compose project; xem bằng `docker volume ls`. Chép source/clone GitHub sang máy khác **không chép DB, phiên Zalo hoặc media**; cần backup/restore và `.env` riêng.

**Không chạy `docker compose down -v` hoặc xóa volume khi chưa backup: có thể mất DB và file. Backup DB không bao gồm toàn bộ media hoặc Redis.**

## Bảo mật và giới hạn

- Repo public chỉ chứa code và cấu hình mẫu. Không commit `.env`, cookie/session/IMEI Zalo, token, API key, DB dump, media riêng hoặc dữ liệu khách hàng.
- Phiên Zalo trong DB là dữ liệu nhạy cảm. Người có quyền DB hoặc export credential có thể lấy thông tin phiên; không chia sẻ quyền admin CRM.
- Local không đồng nghĩa không ai truy cập được: Compose publish cổng web và MinIO trên host. Kiểm tra firewall, LAN, port forwarding và reverse proxy trước khi mở public.
- Backend kết nối Zalo và dịch vụ được bật. AI/API/object storage bên ngoài có thể nhận dữ liệu theo chức năng và cấu hình.
- MinIO có thể cho tải file qua URL trong bucket public; URL khó đoán không phải cơ chế xác thực.
- ClamAV mặc định chưa bật quét trong app; cấu hình `MEDIA_AV_ENABLED` và chính sách lỗi phù hợp.
- Delay, hạn mức và retry không bảo đảm tránh khóa nick. Không spam, né giới hạn nền tảng hoặc liên hệ người chưa đồng ý.
- Đã tham gia không đồng nghĩa được nhắn; chờ duyệt chưa phải join thành công.
- Tạo job thành công chỉ chứng minh cấu hình đã lưu. Kiểm tra trạng thái, log và tin trong Zalo để xác nhận gửi thật.

## Cấu trúc và tài liệu

```text
frontend/         Giao diện Vue, màn CRM và Marketing
backend/src/      API, SDK Zalo, worker và logic job
backend/prisma/   Schema PostgreSQL và migrations
backend/tests/    Kiểm thử backend
docker/           Dockerfile và cấu hình container
docs/             Tài liệu bổ sung
scripts/          Công cụ triển khai và vận hành
```

- [Hướng dẫn chạy local chi tiết](HUONG-DAN-CHAY-LOCAL.md).
- [Cài đặt](HUONG-DAN-CAI-DAT.md).
- [Hướng dẫn production](docs/HUONG-DAN-TRIEN-KHAI-PRODUCTION-COMMUNITY.md): rà lại repo, domain và cấu hình trước khi dùng.
- [Chính sách bảo mật](SECURITY.md).
- [Lịch sử thay đổi](CHANGELOG.md).

Kiểm thử tập trung sau khi cài dependency backend:

```powershell
npm --prefix backend test -- tests/group-scan-routes.test.ts tests/group-scan-worker.test.ts tests/group-link-discovery.test.ts tests/group-send-recovery.test.ts
```

Test không thay thế xác nhận gửi/join thật. Không thử trên người hoặc nhóm chưa đồng ý.

## Giấy phép

Copyright (C) 2026 Nguyễn Tiến Lộc (Loc Nguyen).

- Xem [LICENSE](LICENSE), [NOTICE](NOTICE), [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md), [CONTRIBUTING.md](CONTRIBUTING.md).
- Phát hành theo GNU AGPL v3. Khi phân phối hoặc phục vụ bản chỉnh sửa qua mạng, thực hiện nghĩa vụ cung cấp mã nguồn tương ứng theo giấy phép. `NOTICE` còn có thông báo attribution/thương hiệu; đọc trước khi đổi tên/logo hoặc phân phối.

Dự án độc lập, không phải sản phẩm chính thức của Zalo/VNG. Tự động hóa có thể vi phạm điều khoản nền tảng và làm tài khoản bị hạn chế. Phần mềm cung cấp nguyên trạng, không bảo đảm hoạt động với mọi tài khoản hoặc mọi thay đổi API.
