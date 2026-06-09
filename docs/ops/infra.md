# Yummy or Not — 基础设施

服务器 `ubuntu@baobao.click`，1 vCPU / 1GB RAM。

## 网络拓扑

```
Internet → Caddy (TLS) → 127.0.0.1:3100 → yum-api (Next.js, port 3000)
                                               │
                                          yon-net (Docker bridge)
                                               │
                                            yon-pg (PostgreSQL 17)
```

## 容器

| 容器 | 镜像 | 网络 | 端口 | 数据 |
|---|---|---|---|---|
| `yum-api` | `ghcr.io/zxcrf/yum-api:latest` | `yon-net` | 127.0.0.1:3100→3000 | 无状态 |
| `yon-pg` | `postgres:17-alpine` | `yon-net` | 127.0.0.1:5432→5432 | volume `yon-pgdata` |

## 数据库

从 Neon 迁移至自托管 (2026-06-09)。应用使用 `pg` 驱动，连接纯靠 `DATABASE_URL`。

| 项目 | 值 |
|---|---|
| 容器 | `yon-pg`，`postgres:17-alpine` |
| 网络 | `yon-net`（yum-api 必须加入此网络，否则 `yon-pg` DNS 无法解析） |
| 数据 | named volume `yon-pgdata` → `/var/lib/docker/volumes/yon-pgdata/_data` |
| 凭证 | `/etc/yum-api/pg.env` (mode 600): `POSTGRES_USER=yon POSTGRES_DB=yon POSTGRES_PASSWORD=…` |
| 应用 URL | `DATABASE_URL=postgresql://yon:<pw>@yon-pg:5432/yon` in `/etc/yum-api/.env`（**无引号**） |

重建 `yon-pg`（含低内存调优参数）：

```bash
ssh ubuntu@baobao.click 'docker run -d --name yon-pg --restart unless-stopped \
  --network yon-net -p 127.0.0.1:5432:5432 \
  --env-file /etc/yum-api/pg.env -v yon-pgdata:/var/lib/postgresql/data \
  --shm-size=128m postgres:17-alpine \
  -c shared_buffers=96MB -c effective_cache_size=256MB -c work_mem=2MB \
  -c maintenance_work_mem=32MB -c max_connections=15 -c wal_compression=on \
  -c max_wal_size=512MB -c min_wal_size=80MB -c checkpoint_completion_target=0.9 \
  -c max_worker_processes=2 -c max_parallel_workers=1 \
  -c max_parallel_workers_per_gather=0 -c random_page_cost=1.1'
```

## R2 对象存储

| Bucket | 用途 | 访问 | Token |
|---|---|---|---|
| `yon-prod` | 用户照片 | **私有**（public dev-url 已禁用） | `S3_*` in `/etc/yum-api/.env` |
| `yon-db-backups` | 数据库备份 | **私有** | 独立 token in `/etc/yum-api/backup.env`（仅此 bucket） |

照片读取使用 **presigned S3 GET URL**（24h TTL）。`resolvePhotoUrl` 是异步函数。

⚠️ `storage.ts` 中 S3 SDK 必须使用**静态 import**。Next.js standalone bundler (nft) 不追踪动态 `await import()`，会导致运行时找不到模块。

## 备份

| 项目 | 值 |
|---|---|
| 脚本 | `/usr/local/bin/yon-pg-backup.sh` (mode 750, root) |
| Cron | `/etc/cron.d/yon-pg-backup` — 每天 03:30 UTC |
| 日志 | `/var/log/yon-pg-backup.log` |
| 保留 | R2 lifecycle `expire-14d` — 14 天后自动删除 |
| 大小 | ~19KB（`pg_dump -Fc` custom format） |

工作原理：`docker exec yon-pg pg_dump` 管道到 `amazon/aws-cli` 容器 `s3 cp`，不写本地文件。

手动备份：`sudo /usr/local/bin/yon-pg-backup.sh`

### 恢复流程

```bash
ssh ubuntu@baobao.click
# 读取凭证
eval $(sudo grep -v '^#' /etc/yum-api/backup.env | xargs -I{} echo 'export {}')
eval $(sudo grep -v '^#' /etc/yum-api/pg.env | xargs -I{} echo 'export {}')

# 下载 dump
docker volume create yon-restore-tmp
docker run --rm \
  -e AWS_ACCESS_KEY_ID=${BACKUP_S3_ACCESS_KEY_ID} \
  -e AWS_SECRET_ACCESS_KEY=${BACKUP_S3_SECRET_ACCESS_KEY} \
  -v yon-restore-tmp:/data \
  amazon/aws-cli s3 cp s3://${BACKUP_BUCKET}/<DUMP_FILE> /data/restore.dump \
    --endpoint-url ${BACKUP_ENDPOINT} --region auto

# 恢复（scratch DB 验证，或恢复到 yon 主库）
docker run --rm --network yon-net \
  -e PGPASSWORD=${POSTGRES_PASSWORD} \
  -v yon-restore-tmp:/data \
  postgres:17-alpine sh -c '
    psql -h yon-pg -U yon -d yon -c "CREATE DATABASE yon_restore_test;"
    pg_restore -h yon-pg -U yon -d yon_restore_test --no-owner --no-privileges /data/restore.dump
  '

# 清理
docker volume rm yon-restore-tmp
```

## 环境变量

所有在 `/etc/yum-api/.env`（mode 600, root）。

⚠️ **值不能带引号**。Docker `--env-file` 不会去引号 — `DATABASE_URL="postgres://…"` 会导致容器看到字面量 `"`，pg 连接失败。

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | `postgresql://yon:<pw>@yon-pg:5432/yon` |
| `PHOTO_STORAGE` | `s3` |
| `S3_ENDPOINT` | `https://a2fb6c4e09957c7f8efac7687cdc1dbd.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | `yon-prod` |
| `S3_ACCESS_KEY_ID` | (photo bucket token) |
| `S3_SECRET_ACCESS_KEY` | (photo bucket token) |
| `S3_NO_ACL` | `true` |
| `PHOTO_PUBLIC_BASE_URL` | (legacy, no longer used for S3 reads) |
