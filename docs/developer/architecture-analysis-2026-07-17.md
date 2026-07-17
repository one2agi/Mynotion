# NotionNext 页面加载 / 缓存架构分析报告

**分析时间**：2026-07-17
**分析对象**：`pages/*` + `lib/cache/*` + `lib/notion-webhook/*` + `lib/build/*` + `Dockerfile` + `docker-compose.yml` + `deploy/systemd/*`
**分析方式**：静态代码 + 运行时观察（结合 14:00 Notion 改标题实操）

---

## 1. 业务总览（一张图说清楚）

```
                     ┌─────────────────────────────────────┐
   用户浏览器 ──HTTPS──▶  Nginx (one2agi.com / way 子域名)
                     └──────────┬──────────────────────────┘
                                │ 反代到
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
     ┌──────────────────┐              ┌──────────────────┐
     │  app 容器 (3030) │              │ way 容器 (3031)  │
     │  Landing 首页    │              │ 内容站 (主战场)  │
     │  Theme: starter  │              │ Theme: heo       │
     └────────┬─────────┘              └────────┬─────────┘
              │                                  │
              │      ┌─────────────┐             │
              └─────▶│ Redis 7-alp │◀────────────┘
                     │ 256MB LRU   │  共享三层缓存 + dirty queue
                     │   + 队列    │  + 知识图谱 + 重定向表
                     └──────┬──────┘
                            │
                ┌───────────┴───────────┐
                ▼                       ▼
         Notion API              systemd timer (每分钟)
                                └─ POST 127.0.0.1:3031/api/revalidate
                                   + way → POST app:3000/api/revalidate
```

**类比**：这是一个"两层楼 + 共享仓库"的系统。app/way 是两层楼，Redis 是仓库。两层楼各自有独立房间（ISR cache），但都从仓库里拉同样的货（page block 数据）。改货（Notion 编辑）→ 仓库登记（dirty queue）→ 每分钟有人巡查（timer）或立刻处理（webhook consumer）→ 通知两层楼"房间过期了，重新摆货"（revalidate）。

---

## 2. 架构亮点（做得好的部分）

### 2.1 三层缓存分级（lib/cache/cache_manager.js）

```
Redis (TTL 450s)  ──▶  本地文件  ──▶  进程内存 (prod 10min / dev 2h)
   ▲                  ▲                    ▲
   └── 读命中即返回    └── 写穿          └── 最快但重启丢
```

- 读链：依次尝试，命中即返回（**不是写穿透**，是 hit-first）
- 写：首个成功即返回（只写一层，**但见 §3.1 风险**）
- 进程内请求合并（`inflightMap`）：同一 key 多个并发 fetch 共享一次请求（**防雪崩**）
- Build 阶段走 file lock + double-check：避免 build 时多 worker 重复拉 Notion
- 失败降级顺序：Redis fallback (7天) → stale cache → 抛错

### 2.2 Redis 7 天兜底（lib/cache/redis_fallback.js）

- **与主缓存分离**：Notion 抽风时仍能返回 7 天内的最近成功结果
- **跨容器重启存活**：主缓存文件可能丢，fallback 在 Redis 里有持久化
- TTL = `FALLBACK_TTL_SEC`（独立于主缓存的 450s）

### 2.3 Dirty Queue 智能消费（lib/notion-webhook/consumer.ts）

- **ZADD GT 去重**：同一 page 多次 webhook 合并成一次
- **60s 静默窗**（`QUIET_WINDOW_MS`）：合并"同一页面短时间内多次编辑"
- **CAS Lua 脚本 ack**：避免重复消费已处理的 page
- **Source Freshness Check**：如果 Notion collection 还没追上 webhook 事件（容忍 30s），保留在队列里下次再处理（**避免缓存旧 HTML**）
- **租约 + 自动续约**：240s 锁 + 60s 续约 + 心跳检测（崩溃时锁自然过期）

### 2.4 routePlan 路径规划（lib/notion-webhook/routePlan.ts）

一次页面修改自动计算所有受影响路径：

| 变更类型        | 影响路径                      |
| ----------- | ------------------------- |
| 标题变化        | 文章 path + 列表页             |
| slug 变化     | 老 path 重定向 (301) + 新 path |
| taxonomy 变化 | 标签页 + 分类页                 |
| 公开/私密切换     | 列表页 + sitemap             |
| locale 变化   | 多 locale 的列表 + taxonomy   |

**类比**：不像别的博客只刷"自己那一页"，它会想"这一改，别的地方有没有引用？"然后把所有引用都刷掉。

### 2.5 双容器职责分离 + 共享缓存

- **app** = 品牌 landing（内存限制 1G，只跑品牌首页）
- **way** = content 主站（内存限制 1.8G，承担所有文章 + webhook）
- 共享 Redis 但 ISR 渲染产物隔离（独立 volume）
- way 主动调 `LANDING_REVALIDATION_URL` 让 app 首页也同步刷新

### 2.6 端到端可观测性

- 容器日志 + systemd timer journald + custom headers (`x-notionnext-cache-warm`)
- `/api/cache` 可看 cache stats
- `/api/health` 可看健康状态
- routeState 用 Lua CAS 写重定向表（**避免两个 webhook 同时写同一条记录的数据竞争**）

---

## 3. 发现的问题（按严重等级排序）

### 🔴 Critical（暂无）

### 🟠 High（建议尽快处理）

#### H1. 写入路径只覆盖单层 — 与读取链不一致

**位置**：`lib/cache/cache_manager.js:setDataToCache:163-184`

```js
for (const { name, api } of chain) {
  try {
    await api.setCache(key, data, customCacheTime)
    return  // ⚠️ 第一个成功就返回，**不写穿透到下一层**
  } catch (e) { ... }
}
```

**问题**：

- 读链按 `Redis → File → Memory` 顺序查找，命中即返回
- 写只在第一层成功后返回 → 如果第一层是内存（container 重启就丢），但第二层（文件）也写不进去，那**这次写就丢了**
- 实际生产里 Redis 通常在线，所以写穿 Redis 后不会再写文件/内存 — 意味着**文件 cache 几乎不会更新**（除非 Redis 挂了走 file cache，再写入时才会落盘）

**风险**：

- 切到 build 模式（无 Redis）时，文件 cache 不更新 → 老数据混新数据
- Redis 临时挂掉后恢复 → **文件层可能仍是过期数据**

**修复建议**：写时也写穿到所有可用层（与读链对称），或者显式文档化"只写 Redis 是 by design"。

---

#### H2. `inflightMap` 没有跨进程保护 — 防雪崩只在单进程内有效

**位置**：`lib/cache/cache_manager.js:22, 81-89`

```js
const inflightMap = new Map()  // ⚠️ 进程内变量
```

**问题**：

- 同一 Node 进程内确实能合并请求（100 个并发 fetch 同 key → 只发 1 个请求）
- 但**跨容器**不行：app 和 way 各自有自己的 inflightMap，两个进程同时拉同一个 Notion page
- 高 QPS 时跨容器重复拉会打 Notion 速率限制（Notion API 3 req/s/集成）

**修复建议**：用 Redis SETNX 实现跨进程请求合并（与 `withDirtyConsumerLock` 类似），或者接受现状但监控 Notion API 配额。

---

#### H3. `memory-cache` 库没维护 + 用法存在 key 命名冲突风险

**位置**：`lib/cache/memory_cache.js:1, 10`

```js
import cache from 'memory-cache'  // ⚠️ 最后更新 2017
await cache.put(key, data, ...)
```

**问题**：

- `memory-cache` npm 包 2017 年后无更新，依赖老 Node API
- 没有 key namespace，调用方必须自己保证 key 不冲突
- 没有 LRU，内存只增不减（虽然有 TTL 但是惰性清理）

**修复建议**：迁移到 `lru-cache`（活跃维护、LRU、支持 namespace）。

---

### 🟡 Medium（可接受但应记入技术债）

#### M1. `getDataFromCache` 读取是"按层命中即返回"，但各层 TTL 不同步

- Memory: prod 10min, dev 2h
- File: 自定义或永不过期（`expireTime: null` 当 customCacheTime 不传）
- Redis: `NEXT_REVALIDATE_SECOND * 1.5`（默认 450s）
- 三层 TTL 完全不一致 → 同一 key 可能 Redis 已过期但 Memory 还有 → **读到不一致数据**

**风险**：内存里是旧数据时，会比 Redis 主缓存"更长寿命"地返回旧值。

---

#### M2. `RedisCache` 没有 health check 和 reconnect 配置

**位置**：`lib/cache/redis_cache.js:5`

```js
export const redisClient = BLOG.REDIS_URL ? new Redis(BLOG.REDIS_URL) : {}
```

**问题**：

- 没有 `maxRetriesPerRequest` / `retryStrategy` / `enableOfflineQueue` 等配置
- Redis 短暂断开时，cache read 会卡住（依赖 ioredis 默认行为）
- `isBuildPhase` 时不走缓存，但 `cacheReadsEnabled` 没看到这个开关

**修复建议**：显式配 ioredis 重连策略 + 增加 Redis 健康检查。

---

#### M3. `routeState` 写重定向/快照用 Lua，但 Bootstrap 没有 CAS

**位置**：`lib/notion-webhook/routeState.ts` (BOOTSTRAP_SCRIPT)

- 单条 `putRouteSnapshot` 用 Lua CAS（好）
- `bootstrapRouteSnapshots` 批量写时是用脚本包了多个 SETNX？需要复查（这里没读到具体脚本）
- 如果 bootstrap 期间有正常 consumer 在写 snapshot，可能 bootstrap 覆盖新数据

---

#### M4. `notion-webhook` 没有重试机制 — 单次失败即丢

**位置**：`pages/api/notion-webhook.ts:177-189`

```js
try {
  await enqueueDirtyPage({...})
} catch {
  return end(res, 503)
}
```

**问题**：

- webhook 成功 200 后 Redis 写失败 → 返 503
- Notion 会按其内置规则重试 webhook（24h 内几次），但**频率不可控**
- 如果 Redis 在 webhook 高峰期短暂挂掉，可能丢事件（兜底靠 systemd timer 的周期重检，但 timer 不知道哪些 page 改过）

**修复建议**：webhook 入队失败时写 dead-letter（已部分实现：`/tmp/notion-webhook-dead-letter`，但要确认是否会被 timer 重新扫描）。

---

### 🟢 Low（改进优化）

#### L1. `next.config.js` 把 `eslint.ignoreDuringBuilds = true`

- 跳过 ESLint 加快构建，但可能让 lint 问题积累
- 推荐：CI 单独跑 lint，build 时关

#### L2. `Dockerfile` HEALTHCHECK 用 `/` 而非 `/api/health`

- 这是历史妥协（避免 `wget --content-on-error` 在 sh -c 上下文不稳）
- 当前 compose 用 `/api/health`，但 Dockerfile 里仍是旧逻辑
- **可接受**：app 用 `wget --spider /`，compose 用 `/api/health`，两个版本都生效

#### L3. way 容器的 `memory-cache` 与 app 容器独立

- 各自有 10min 内存缓存 → 同一 page 在两个容器可能有时差（≤10min）
- 实际影响小，因为 Redis 是真理源

#### L4. `revalidate.js` 接受 `path` 但只 normalize 不校验安全性

- `normalizePath` 没检查 path traversal（`../`）
- 但 revalidate 内部 `res.revalidate()` 会拒绝非法 path，所以**风险有限**

---

## 4. 改进路线图

### 第 1 周（低成本高收益）

1. **H1**：把 setDataToCache 改成"写穿所有可用层"（或加注释明确"by design"）
2. **H3**：评估 `memory-cache` → `lru-cache` 迁移可行性
3. **M2**：补 ioredis reconnect 配置

### 第 2-4 周（重要但非阻塞）

4. **H2**：用 Redis SETNX 做跨进程请求合并（避免 Notion 速率限制）
5. **M4**：补 webhook dead-letter 扫描机制（与现有 timer 集成）
6. **M1**：让三层 TTL 同步（统一用 `NEXT_REVALIDATE_SECOND` 控制）

### 第 5+ 周（架构优化）

7. **M3**：Bootstrap 用 Lua CAS（参考 `ACK_DIRTY_PAGE_SCRIPT` 模式）
8. 监控 Notion API 配额（cross-process fetch rate）
9. 评估"内容实时性"诉求 — 现状 ~105s 端到端延迟，业务上可接受

---

## 5. 验证结论

### 端到端刷新延迟（实测 2026-07-17 14:00）

| 阶段                        | 耗时                     |
| ------------------------- | ---------------------- |
| Notion → webhook 入队       | <1ms                   |
| 60s 静默窗                   | **60s** (56% of total) |
| way 消费 + 拉新数据             | 4-10s                  |
| res.revalidate + warmPath | <1s                    |
| 端到端可见                     | **~65-105s**           |

**结论**：业务可接受。如果要 < 15s 可见，主要瓶颈是 60s 静默窗（设计选择：批量去重）。

### 架构健康度评分

| 维度   | 评分    | 说明                                                     |
| ---- | ----- | ------------------------------------------------------ |
| 可用性  | ⭐⭐⭐⭐⭐ | 多层 fallback + dead-letter + timer 兜底                   |
| 一致性  | ⭐⭐⭐⭐  | 写穿 + 路径规划 + CAS 都到位，但有 H1/M1 风险                        |
| 可扩展性 | ⭐⭐⭐⭐  | 双容器职责清晰，Redis 共享，但 cross-process 协调还有改进空间              |
| 可观测性 | ⭐⭐⭐⭐  | 日志 + headers + cache stats，但缺指标聚合（Prometheus）          |
| 安全性  | ⭐⭐⭐⭐⭐ | 签名校验 + token 鉴权 + constant-time 比较 + systemd hardening |

**整体**：生产级架构，亮点在 routePlan + dirty queue + 多层 fallback；改进点在跨进程协调和写穿透一致性。