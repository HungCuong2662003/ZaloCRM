# Huong Dan Chay Local ZaloCRM

File nay tom tat cach chay project trong thu muc hien tai:

```text
D:\ZaloCRM-main\ZaloCRM-main
```

## 1. Project nay gom nhung gi

- `frontend/`: giao dien Vue 3 + Vuetify.
- `backend/`: API Node.js + Fastify + Prisma.
- `backend/prisma/`: schema DB va migrations.
- `docker-compose.yml`: chay full stack bang Docker.
- `.env`: cau hinh local that, co mat khau va secret. Khong gui file nay cho nguoi khac.

Service Docker:

- `zalo-crm-app`: backend + frontend build san, mo port web.
- `zalo-crm-db`: PostgreSQL 16, luu du lieu CRM.
- `zalo-crm-redis`: Redis, dung cho queue/cache/event.
- `zalo-crm-minio`: luu file/anh/video attachment neu dung MinIO/S3 local.
- `zalo-crm-backup`: backup PostgreSQL vao thu muc `backups/`.
- `zalo-crm-clamav`: quet virus file upload, mac dinh co the tat qua env.

## 2. Can cai gi tren may

Bat buoc:

- Docker Desktop.
- Docker Compose, co san trong Docker Desktop.
- Git neu muon pull code.

Khong can cai PostgreSQL rieng tren Windows. PostgreSQL chay trong container `zalo-crm-db`.

Neu muon dev rieng frontend/backend khong qua Docker thi moi can Node.js 20+, npm.

## 3. File cau hinh can co

Project can file `.env` o root.

Neu chua co:

```powershell
Copy-Item .env.example .env
```

Bien quan trong trong `.env`:

```env
APP_PORT=3080
DB_PORT=5433
REDIS_PORT=6379
MINIO_PORT=9000
MINIO_CONSOLE_PORT=9001

DB_USER=crmuser
DB_PASSWORD=...
DB_NAME=zalocrm

JWT_SECRET=...
ENCRYPTION_KEY=...

APP_URL=http://localhost:3080
CRM_LOGIN_URL=http://localhost:3080

STORAGE_DRIVER=local
REDIS_URL=redis://redis:6379
```

Luu y:

- `JWT_SECRET`, `ENCRYPTION_KEY`, `DB_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` nen doi thanh gia tri rieng.
- `DATABASE_URL` trong `.env` co the bi cu, nhung Docker Compose se override bang:

```text
postgresql://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}
```

## 4. Chay lan dau

Mo PowerShell tai root project:

```powershell
cd D:\ZaloCRM-main\ZaloCRM-main
docker compose up -d --build
```

Ap dung migration DB:

```powershell
docker exec zalo-crm-app npx prisma migrate deploy
docker compose restart app
```

Mo web:

```text
http://localhost:3080
```

Lan dau vao `/setup` de tao to chuc va tai khoan admin.

## 5. Chay lai moi ngay

Neu da build roi:

```powershell
cd D:\ZaloCRM-main\ZaloCRM-main
docker compose up -d
```

Mo:

```text
http://localhost:3080
```

## 6. Tat project

Tat container, giu du lieu:

```powershell
docker compose down
```

Khong dung lenh xoa volume neu chua backup, vi volume chua DB va file.

## 7. Cap nhat code roi chay lai

Sau khi sua code:

```powershell
docker compose build app
docker compose up -d app
docker exec zalo-crm-app npx prisma migrate deploy
docker compose restart app
```

Xem log:

```powershell
docker logs --tail 100 zalo-crm-app
```

## 8. Du lieu luu o dau

Du lieu nam trong Docker volumes:

- `pg_data`: PostgreSQL, luu user, contact, chat, Zalo account, cookie/session, job gui nhom.
- `redis_data`: Redis queue/cache.
- `minio_data`: file object MinIO.
- `file_storage`: file local trong `/var/lib/zalo-crm/files`.
- `clamav_data`: database virus ClamAV.

Xem volume:

```powershell
docker volume ls
```

DB khong nam trong file `.sql` trong source. Restart app khong mat data. `docker compose down` cung khong mat data.

Data chi mat neu xoa volume, vi du:

```powershell
docker compose down -v
```

Khong chay lenh tren neu chua backup.

## 9. Backup va restore DB

Backup:

```powershell
docker exec zalo-crm-db pg_dump -U crmuser zalocrm > backup-zalocrm.sql
```

Restore can can than vi ghi lai DB:

```powershell
Get-Content backup-zalocrm.sql | docker exec -i zalo-crm-db psql -U crmuser -d zalocrm
```

Neu DB user/name trong `.env` khac, thay `crmuser` va `zalocrm` cho dung.

## 10. Kiem tra trang thai

Xem container:

```powershell
docker ps
```

Xem log app:

```powershell
docker logs --tail 100 zalo-crm-app
```

Xem bang trong DB:

```powershell
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c "\dt"
```

Kiem tra job gui nhom:

```powershell
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c "select id, state, sent, failed, zalo_account_id, created_at from group_send_jobs order by created_at desc limit 20;"
```

## 11. Dang nhap va dung co ban

1. Mo `http://localhost:3080`.
2. Neu lan dau, vao `/setup`, tao org va admin.
3. Dang nhap admin.
4. Vao quan ly nick Zalo, them nick bang QR.
5. Sau khi nick connected, vao Chat/Contacts/Friends/Groups/Marketing.
6. Voi tinh nang gui nhom:
   - Vao `Marketing > Quet nhom`.
   - Chon nick Zalo.
   - Quet/lay danh sach nhom.
   - Chon nhom.
   - Bam `Gui tin nhom`.
   - Chon `Luu job` hoac `Luu + chay`.
   - Bam `Theo doi job` de xem trang thai/log.

## 12. Port local

- Web CRM: `http://localhost:3080`
- PostgreSQL host port: `127.0.0.1:5433`
- Redis host port: `127.0.0.1:6379`
- MinIO S3: `http://localhost:9000`
- MinIO console: `http://localhost:9001`

## 13. Dev khong dung Docker app

Thuong khong can. Neu can dev tach frontend/backend:

Backend:

```powershell
cd backend
npm install
npm run dev
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Van nen chay DB/Redis/MinIO bang Docker:

```powershell
docker compose up -d db redis minio minio-init
```

Can sua `DATABASE_URL` cho backend local tro toi port host:

```env
DATABASE_URL=postgresql://crmuser:<DB_PASSWORD>@127.0.0.1:5433/zalocrm
REDIS_URL=redis://127.0.0.1:6379
```

## 14. Loi hay gap

Port `3080` bi trung:

```env
APP_PORT=3081
```

Sau do:

```powershell
docker compose up -d app
```

Bang DB thieu sau khi them code moi:

```powershell
docker exec zalo-crm-app npx prisma migrate deploy
docker compose restart app
```

Frontend khong thay thay doi:

```powershell
docker compose build app
docker compose up -d app
```

Zalo mat ket noi:

- Vao trang nick Zalo.
- Kiem tra nick co `connected` khong.
- Neu can, quet QR lai.

## 15. Luu y bao mat

- Chay local thi nguoi ngoai khong xem DB neu may khong mo port ra internet.
- `docker-compose.yml` bind PostgreSQL vao `127.0.0.1`, ben ngoai mang khong vao duoc DB truc tiep.
- File `.env` co secret va mat khau, khong gui len GitHub, khong chup man hinh public.
- DB co the luu Zalo session/cookie/credential. Ai co quyen admin CRM hoac lay duoc DB co the lay duoc phien Zalo.
- Neu dua len VPS/internet, bat buoc doi toan bo secret, dat firewall, dung HTTPS/reverse proxy, khong expose MinIO console.

## 16. Job gui nhom tu chay lai khi bat du an

Co.

Tu ban nay, khi app start lai:

- Job `queued` hoac `running` se tu resume sau khoang 45 giay.
- Job `stopped` co `last_error = server_restarted` do code cu dung nham khi restart cung se tu resume.
- Delay 45 giay de nick Zalo reconnect truoc.
- Job `draft`, `stopped` do bam dung tay, `completed`, `failed`, `deleted` se khong tu chay.
- Job da qua gio dung `stopAt` trong luc server tat se bi chuyen sang `stopped`.
- Job khong lap `repeat=false` se bo qua nhom da co log `sent/failed`, giam gui lap sau crash.
- Job lap `repeat=true` se resume tu chu ky moi.

Dung nhu sau:

1. Tao job tren giao dien.
2. Bam `Luu + chay` hoac bam `Start`.
3. Neu tat app/mat dien/restart may trong luc job dang `queued/running`, lan sau chay:

```powershell
docker compose up -d
```

Job se tu chay lai, khong can bam `Start` lai.

Neu muon sua noi dung/nhom:

1. Vao `Marketing > Quet nhom`.
2. Bam `Theo doi job`.
3. Neu job dang chay thi bam `Dung`.
4. Bam `Sua`, doi noi dung/nhom/delay/gio dung.
5. Bam `Luu + chay`.

Kiem tra job trong DB:

```powershell
docker exec zalo-crm-db psql -U crmuser -d zalocrm -c "select id, state, sent, failed, cycles, started_at, finished_at from group_send_jobs order by created_at desc limit 20;"
```
