---
name: yon-deploy
description: "Deploy latest API + Web to baobao.click server after CI success. Compares commit hash to confirm the correct image is running. Use when: 'deploy to server', 'update yon api', 'deploy yon', '更新服务器', '部署'. Server: ubuntu@baobao.click, container: yum-api on port 3100, image: ghcr.io/zxcrf/yum-api."
---

# yon-deploy — Deploy API + Web to baobao.click

Deploys `ghcr.io/zxcrf/yum-api:latest` to `ubuntu@baobao.click` after verifying
the latest `docker-api.yml` CI run succeeded. Guards with commit-hash comparison
so a stale or in-progress build is never deployed.

## Step 1 — Verify CI succeeded

```bash
gh run list --workflow=docker-api.yml --branch=main --status=success --limit=1 \
  --json headSha,conclusion,updatedAt,databaseId \
  --jq '.[0]'
```

Extract `headSha` (full) and `databaseId`.

Also get local HEAD:

```bash
git rev-parse HEAD
```

**Gate**: check if any API-relevant files changed between `headSha` and `HEAD`:

```bash
git diff --name-only <headSha> HEAD -- \
  apps/api/ packages/shared/ Dockerfile .dockerignore pnpm-lock.yaml
```

- Output is **empty** → no API changes since last build; image at `headSha` is current → proceed.
- Output is **non-empty** → API files changed but docker build has not run yet. Stop and report:
  > "API files changed since last build (`<headSha short>`). Waiting for
  > `docker-api.yml` to complete for HEAD `<HEAD short>`. Retry after CI succeeds."

## Step 2 — Get current image digest on server

```bash
ssh ubuntu@baobao.click "docker inspect yum-api --format='{{.Image}} {{.Config.Image}}' 2>/dev/null || echo 'not running'"
```

Save the current `Image` digest (sha256:...) as `BEFORE_DIGEST`.
Also note the image tag currently running (e.g. `ghcr.io/zxcrf/yum-api:latest`).

## Step 3 — Pull latest image

```bash
ssh ubuntu@baobao.click "docker pull ghcr.io/zxcrf/yum-api:latest 2>&1 | tail -3"
```

After pull, get the new digest:

```bash
ssh ubuntu@baobao.click "docker inspect ghcr.io/zxcrf/yum-api:latest --format='{{.Id}}' 2>/dev/null"
```

Save as `AFTER_DIGEST`.

**If `BEFORE_DIGEST == AFTER_DIGEST`**: server already running the latest image.
Report: "Already up to date (digest `<sha256 short>`). No restart needed." and stop.

## Step 4 — Restart container

```bash
ssh ubuntu@baobao.click "docker stop yum-api && docker rm yum-api && docker run -d \
  --name yum-api \
  --restart unless-stopped \
  --network yon-net \
  -p 127.0.0.1:3100:3000 \
  --env-file /etc/yum-api/.env \
  ghcr.io/zxcrf/yum-api:latest"
```

## Step 5 — Verify health

Wait 3 seconds, then:

```bash
ssh ubuntu@baobao.click "curl -sf http://127.0.0.1:3100/api/health"
```

Expected: `{"ok":true}` with exit code 0.

Also verify via public domain:

```bash
ssh ubuntu@baobao.click "curl -sf -o /dev/null -w '%{http_code}' https://yon.baobao.click/api/health"
```

Expected: `200`.

## Step 6 — Confirm deploy with commit hash

```bash
ssh ubuntu@baobao.click "docker inspect yum-api --format='{{.Image}}'"
```

Report final summary:

```
✅ Deployed successfully
  Commit : <headSha short 7>
  Image  : ghcr.io/zxcrf/yum-api:sha-<headSha short 7>
  Digest : <AFTER_DIGEST first 19 chars>
  Health : {"ok":true}
  URL    : https://yon.baobao.click
```

## Error handling

- **docker pull unauthorized**: `docker login ghcr.io` token may have expired.
  Re-authenticate: `ssh ubuntu@baobao.click "echo '<PAT>' | docker login ghcr.io -u zxcrf --password-stdin"`
- **health check fails**: run `ssh ubuntu@baobao.click "docker logs yum-api --tail=50"` to diagnose.
  Roll back with: `ssh ubuntu@baobao.click "docker stop yum-api && docker rm yum-api && docker run -d --name yum-api --restart unless-stopped -p 127.0.0.1:3100:3000 --env-file /etc/yum-api/.env ghcr.io/zxcrf/yum-api:<previous-sha-tag>"`
- **CI gate fails (no matching headSha)**: check `gh run list --workflow=docker-api.yml --limit=5` to see build status.
- **API up but DB calls fail (`ENOTFOUND yon-pg`)**: yum-api not on `yon-net`, OR `DATABASE_URL` has literal quotes. See `docs/ops/infra.md`.

## Related docs

Database, R2 buckets, backup, env vars, restore procedures → `docs/ops/infra.md`.
