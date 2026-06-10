FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @yon/shared build 2>/dev/null || true
RUN pnpm --filter @yon/api exec next build
# Dereference all of sharp's runtime deps (sharp + @img/* + detect-libc + semver)
# from the .pnpm virtual store into /tmp/sharp-deps so the runner COPY gets real files.
# sharp is not hoisted to root in pnpm workspace — it lives in apps/api/node_modules.
RUN SHARP_PNPM=$(realpath /app/apps/api/node_modules/sharp | sed 's|/node_modules/sharp$||') && \
    mkdir -p /tmp/sharp-deps && \
    cp -rL "$SHARP_PNPM/node_modules/." /tmp/sharp-deps/

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder /app/apps/api/.next/standalone ./
COPY --from=builder /app/apps/api/.next/static ./apps/api/.next/static
COPY --from=builder /app/apps/api/public ./apps/api/public

# sharp is in serverExternalPackages — not bundled by Next.js standalone.
# pnpm places it under apps/api/node_modules (not hoisted to root).
# Copy the dereferenced real files (symlinks would be dangling in runner).
COPY --from=builder /tmp/sharp-deps ./node_modules

EXPOSE 3000
CMD ["node", "apps/api/server.js"]
