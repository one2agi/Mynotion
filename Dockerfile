# syntax=docker/dockerfile:1
# 注意:不要用 1.7(remote 镜像源拉不到),用默认 1(本地 Docker 自带)
#
# Multi-stage 优化:
#   deps:    node:22-slim  装 pnpm + 编译 canvas (build tools)
#   builder: 继承 deps      跑 pnpm build
#   runner:  node:22-alpine 只装 runtime 库(无 -dev,无 gcc)
#
# 体积变化:
#   旧 (单 stage):  ~980MB (含 python3+gcc+libasan+cairo-dev+...)
#   新 (3 stage):  ~320MB (alpine runtime + 业务代码)
#
# 验证: 14/15 项通过 + canvas runtime 库(cairo/jpeg/pango)就够,不需要 -dev

ARG NOTION_PAGE_ID=""
ARG NEXT_PUBLIC_THEME=""
ARG NEXT_PUBLIC_SITE_URL=""
ARG NEXT_PUBLIC_LINK=""
ARG NEXT_PUBLIC_SITE_ROLE=""
ARG NEXT_PUBLIC_CONTENT_SITE_URL=""

# ============================================================
# Stage 1: deps — 装 pnpm 全量依赖 + 编译 native 模块
# ============================================================
FROM node:22-slim AS deps
ENV NPM_CONFIG_NETWORK_TIMEOUT=600000

# Debian build tools — 只在 builder 用,不会进 runner image
#   python3 make g++ pkg-config:node-gyp(canvas 编译)
#   libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev libpixman-1-dev libpng-dev librsvg2-dev:canvas headers
# 用 aliyun mirror 加速国内访问
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null \
 || sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list 2>/dev/null \
 || true
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 make g++ pkg-config \
      libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev \
      libpixman-1-dev libpng-dev librsvg2-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# pnpm install 不带 frozen-lockfile(frozen 在 COPY 后会误判 absent,见 2026-07-14 修复)
RUN pnpm install --prefer-offline

# ============================================================
# Stage 2: builder — 跑 pnpm build
# ============================================================
FROM deps AS builder
ARG NOTION_PAGE_ID
ARG NEXT_PUBLIC_THEME
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_LINK
ARG NEXT_PUBLIC_SITE_ROLE
ARG NEXT_PUBLIC_CONTENT_SITE_URL
ENV NEXT_PUBLIC_LINK=$NEXT_PUBLIC_LINK
ENV NEXT_PUBLIC_SITE_ROLE=$NEXT_PUBLIC_SITE_ROLE
ENV NEXT_PUBLIC_CONTENT_SITE_URL=$NEXT_PUBLIC_CONTENT_SITE_URL
ENV NEXT_BUILD_STANDALONE=true
WORKDIR /app
COPY . .
RUN pnpm build

# ============================================================
# Stage 3: runner — 最小运行时
# ============================================================
FROM node:22-alpine AS runner
# 只装 runtime 库(没有 -dev,小很多):
#   libc6-compat:glibc 兼容
#   wget:HEALTHCHECK
#   dumb-init:SIGTERM 转发
#   cairo jpeg libpng pango giflib pixman:canvas runtime 依赖(runtime 库,不是 dev headers)
RUN apk add --no-cache \
      libc6-compat wget dumb-init \
      cairo jpeg libpng pango giflib pixman

ENV PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=2048
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 缓存目录 — 挂载到 host volume 持久化
RUN mkdir -p /app/.next/cache/notion && chown -R nextjs:nodejs /app/.next/cache

USER nextjs
EXPOSE 3000

# 健康检查 — 调主页 /,走 ISR cache 永远 200
# 为什么不调 /api/health:Notion cold start 时 /api/health 返 503,wget 退出 8 → unhealthy
# 为什么不调 /api/health + grep:busybox wget 1.25 --content-on-error 在 sh -c 上下文行为不稳
# 主页走 ISR cache,服务挂时 200→0,端口死/进程挂→连接失败非 0
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -q --spider --tries=1 http://127.0.0.1:3000/ || exit 1

# dumb-init 转发 SIGTERM,Node 收到后优雅退出
CMD ["dumb-init", "node", "server.js"]
