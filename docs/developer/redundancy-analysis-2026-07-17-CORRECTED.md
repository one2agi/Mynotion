# NotionNext 加载策略冗余分析 — **修正版**

**原报告**：[redundancy-analysis-2026-07-17.md](./redundancy-analysis-2026-07-17.md)
**修正时间**：2026-07-17（同日修正）
**修正原因**：经 4 个独立 subagent 全量查证（含 grep + 读测试 + module re-export 检查），原报告 12 个"冗余候选"中 **0 个是真正可清理的冗余**。

> **本报告替代原报告**。原报告作废，不要按原报告做清理。

---

## 1. 诚实结论

**NotionNext 的缓存层没有真正的冗余**。我之前的报告犯了一个典型的"按模块 grep 找候选 → 没读测试 → 没读生命周期细节"的错误。

**修正后的结论**：
- ✅ 真冗余可删：**0 个**
- ⚠️ 部分冗余（同文件内可合并，价值有限）：**0 个**
- ❌ 不是冗余（原报告判断错误）：**12 个**

**结论：保留所有代码，不要做任何"清理"动作。**

---

## 2. 逐项真实状态

### 🟠 High 候选

#### H1: `getApi()` + `getCacheType()` 是死代码

| 字段 | 原报告判断 | 真实状态 |
|------|----------|---------|
| getApi | 死代码可删 | ❌ **不是死代码**——被 `setDataToCacheStrict` 同文件调用 |
| getCacheType | 死代码可删 | ❌ **不是死代码**——被 `cacheLog`（日志）+ `getApi` 共用 |

**证据**：
- `lib/cache/cache_manager.js:47` — `cacheLog` 内用 `getCacheType()` 输出 `[REDIS]`/`[FILE]`/`[MEMORY]` 前缀
- `lib/cache/cache_manager.js:192` — `setDataToCacheStrict` 用 `getApi()` 决定写入 backend
- 我之前漏看了 `cacheLog` 这个同文件内调用

**教训**：只查"跨模块 import"不够，要查"同文件内调用"。

---

#### H2: `inProcessAllPagesPromises` 与 `inflightMap` 双重防雪崩

| 字段 | 原报告判断 | 真实状态 |
|------|----------|---------|
| 外层 Map | 双重保险冗余 | ❌ **不是冗余**——生命周期完全不同 |

**关键差异**（我之前漏看的核心）：

```js
// inner inflightMap —— 任务结束就回收
inflightMap.set(key, promise)
promise.finally(() => inflightMap.delete(key))  // 成功/失败都删

// outer inProcessAllPagesPromises —— 成功后**继续复用**
inProcessAllPagesPromises.set(cacheKey, promise)
// 成功时没有删除逻辑！只在 promise.catch 时手动 delete
```

**真实语义对比**：

| 机制 | 类比 | 生命周期 |
|------|------|---------|
| `inflightMap` | 银行叫号牌 | 任务结束就回收，下次重新取号 |
| `inProcessAllPagesPromises` | 进程内缓存的"成交记录" | 成功结果永久复用（同进程生命周期内），失败才作废 |

**专属测试证据**（我之前完全没读）：

`__tests__/lib/staticPaths.test.js:54-94`：

```js
it('shares allPages lookups within a process', async () => {
  const first = await getSharedAllPages({ from: 'slug-paths' })
  const second = await getSharedAllPages({ from: 'slug-paths' })
  expect(first).toEqual(second)
  expect(fetchGlobalAllData).toHaveBeenCalledTimes(1)  // 只 fetch 1 次
  expect(getOrSetDataWithCache).toHaveBeenCalledTimes(1)
})
```

**删除外层 Map 的真实后果**：
1. 破坏跨入口共享（`getStaticPathsBase` 和 `pages/[prefix]/index.js` 的 legacy redirect 两个入口会失去同进程结果共享）
2. 破坏这两个专属测试
3. 增加缓存命中失败时的源数据请求次数

**结论**：外层 Map 是**有意的"长生命周期去重"**，与 inner inflightMap 的"短生命周期合并"职责互补。

---

#### H3: 4 个写入函数冗余

| 字段 | 原报告判断 | 真实状态 |
|------|----------|---------|
| 同文件 strict/non-strict 对 | 可合并 | ⚠️ 同文件内**可合并**（但价值有限，~8 行代码） |
| 跨文件 setDataToCache* vs saveFallback* | 可合并 | ❌ **不能合并**——不同 keyspace + 不同 TTL |

**核心证据**：

```js
// writeFreshCache 同时调两个，**业务上必须独立**：
await setDataToCacheStrict(cacheKey, data)  // 主链短 TTL（~7.5min）
await saveFallbackStrict(cacheKey, data)    // fallback 长 TTL（7/30 天）
```

两者：
- 写**不同的 Redis key**（主链 vs `fallback:` 前缀）
- 写**不同的 TTL**
- 业务上是"两个独立持久层"（主缓存 + 跨重启兜底）

**建议**：保留原 4 个函数。每个名字清晰、职责单一，比 1 个带 boolean flag 的函数更好读。

---

### 🟡 Medium 候选

#### M1: `bootstrapRouteSnapshots` HSETNX vs `putRouteSnapshot` HSET 语义分裂

**原报告判断**：语义分裂 = bug

**真实状态**：❌ **设计正确的非对称语义**

**核心证据**（我之前漏看的"真理源"测试）：

`__tests__/lib/notion-webhook/routeState.redis.test.ts:55-76`：

```js
it('atomic bootstrap preserves a preexisting dirty snapshot', async () => {
  // 先 put pageA → 然后 bootstrap → 断言 pageA 仍为 'Dirty title'
  // (HSETNX 不覆盖),pageB 用 'Directory title'
})
```

这个测试**显式编码了设计意图**：

| 函数 | 语义 | 触发场景 |
|------|------|---------|
| `putRouteSnapshot` (HSET 覆盖) | consumer 看到新事件 → 用最新 view 替换 | 正常运行 |
| `bootstrapRouteSnapshots` (HSETNX 不覆盖) | 冷启动/全量重建 → **只填缺失字段，保留 consumer 已写入的"脏"数据** | 部署后首跑 / admin 触发 |

**改 bootstrap 用 HSET 会破坏这个测试** = 改坏设计。

**BOOTSTRAP_KEY** 的作用：内部 Lua 幂等屏障，不是死代码。

---

#### M2: `fetchFreshConfiguredGlobalData` 一份数据写 2-3 个 cache key

**原报告判断**：冗余 key，浪费内存

**真实状态**：❌ **3 个 key 全部有 active reader，是契约的一部分**

| Cache key | 角色 | 真实消费者 |
|----------|------|-----------|
| `site_${pageId}` | 单 pageId 级 | `getSiteDataByPageId` (维护脚本/debug) |
| `global_data_${locale}_${pageId}` | locale 显式 | `fetchGlobalAllData` 当 caller 传 `locale='zh'` |
| `global_data_default_${pageId}` | 默认 fallback | `fetchGlobalAllData` 当 caller 不传 locale |

`fetchGlobalAllData` 接受两种 locale 输入，**返回的 key 必须分别存在**；少写一个会触发 cache miss → Notion 重试。

**测试证据**：`__tests__/lib/db/freshSiteData.test.js:165-251` 的 4 个回归测试**独立断言 3 个 key 全部写入**。

---

#### M4: `revalidateTargets.ts` 文件名误导

**原报告判断**：命名误导

**真实状态**：⚠️ **仓库统一命名风格**（warmAll.ts、warmPath.ts、routePlan.ts 都是同款——1 个函数 + 复数文件名）

修复应一并改，否则破坏一致性。原报告把它列为 isolated bug 是错的。

---

### 🟢 Low 候选

#### L1: `pages/[prefix]/[slug]/[...suffix].js` 与 `index.js` 重叠

**原报告判断**：路径解析重叠

**真实状态**：❌ **filter 互斥，路由分工清晰**

```js
// index.js:22 — 只选"恰好 1 个 /" 的 slug
filterFn: row => checkSlugHasOneSlash(row)

// [...suffix].js:22 — 只选"≥ 2 个 /" 的 slug（如日期分层文章）
filterFn: row => checkSlugHasMorThanTwoSlash(row)
```

日期型 slug（`/article/2023/10/29/test`）必须走 catch-all，删除会破坏路由。

---

#### L2: `EmptyData` 与 `getEmptyData` 跨文件重复

**原报告判断**：跨文件重复定义

**真实状态**：❌ **两套不同形状契约，各自服务不同渲染路径**

| 文件 | 形态 | 用途 |
|------|------|------|
| `lib/db/SiteDataFallback.js` | 25+ 字段完整 SiteData | 老 `lib/db/SiteDataApi.js` 路径 |
| `lib/site/processors/empty.processor.ts` | 12 字段最小 SiteData | 新 `lib/site/site.service.ts` 路径 |

两者服务于不同的 fallback stack，不是冗余。

---

## 3. 修正后的整体判断

| 维度 | 原报告判断 | 修正后判断 |
|------|----------|----------|
| 真冗余可删数 | 8-12 处 | **0 处** |
| 可清理代码量 | ~180 行 | **0 行** |
| 优先级清理 | 3 批路线图 | **不需要清理** |

**结论**：保留所有现有代码。

---

## 4. 我错在哪（教训）

### 4.1 漏看的"真理源"：测试文件

CLAUDE.md 调试纪律写明："**写代码前,先跑真实系统。如果你没看到 bug 就修,你就是在猜**"。

我犯了**完全相反**的错误：没读测试就下结论。每个候选的"真冗余"判断都能被对应的测试文件推翻：

| 候选 | 推翻证据（测试文件） |
|------|---------------------|
| H2 | `__tests__/lib/staticPaths.test.js:54-94` |
| M1 | `__tests__/lib/notion-webhook/routeState.redis.test.ts:55-76` |
| M2 | `__tests__/lib/db/freshSiteData.test.js:165-251` |
| L1 | `lib/utils/post.js:69-96` 的 filter 实现 |

### 4.2 漏看的"语义生命周期"

我只看"是否有引用"，没看"成功/失败后是否清理"。

H2 的关键不在于"两个 Map 看起来都防重复"，而在于：
- inner inflightMap：**成功后删除**（任务完成就回收）
- outer inProcessAllPagesPromises：**成功后保留**（进程级结果复用）

**这是两种完全不同的"防重复"语义**，不是冗余。

### 4.3 漏看的"仓库风格一致性"

M4（命名误导）我没看同目录其他文件的命名风格就下 isolated case 结论。其实 warmAll.ts/warmPath.ts/routePlan.ts 都是同款——单函数 + 复数文件名。

---

## 5. 正确的清理 vs 真正不能动的边界

### ✅ 可以做（命名/格式，不影响行为）

1. **M4 一致性改造**：把 `revalidateTargets.ts` 改名为 `revalidateContentPath.ts` —— 但同时把 `warmAll.ts → warmAllContentPaths.ts`、`warmPath.ts → warmRevalidatedPath.ts`、`routePlan.ts → planRouteRevalidation.ts` 也改，否则破坏一致性
2. **H3 同文件合并**：`setDataToCache`/`setDataToCacheStrict` 用 `{strict}` 参数合并（~8 行代码变化，**价值有限**，4 个清晰命名可能更好读）
3. **H1 `getCacheType` 提取常量**：把 `getCacheType()` 改成纯字符串常量 `BACKEND = 'redis'/'file'/'memory'`，消除函数调用开销

**但都不推荐现在做**——没有真实收益。

### ❌ 绝对不能动

| 模块 | 为什么不能动 |
|------|------------|
| `inProcessAllPagesPromises` | 测试锁定了"成功后保留"的语义 |
| `bootstrapRouteSnapshots` HSETNX | 测试锁定了"保留 consumer 已 put 的脏 page"语义 |
| 3 个 cache key | 测试锁定了契约 |
| `getApi` + `getCacheType` | `cacheLog` 和 `setDataToCacheStrict` 实际使用 |
| catch-all vs index filter 互斥 | 路由分工，删除 catch-all 会破日期型文章 |
| 两个 EmptyData 不同 shape | 服务不同的 fallback stack |

---

## 6. 最终建议

**所有代码保持原样**。这份"修正版"作为未来重构者的"不要瞎删"参考。

如果之后想做架构优化，应该聚焦在**真正有收益**的方向：
1. **架构报告 H1**（写入策略不对称）—— 这是真问题，但需要谨慎设计
2. **架构报告 M4**（webhook dead-letter 重扫）—— 这是真缺失
3. **架构报告 H3**（memory-cache 换 lru-cache）—— 这是真依赖风险

但**这三项都是优化项，不是冗余清理**。

---

## 7. 元教训（给我的）

我应该：
1. **任何"删代码"建议前，先读对应模块的测试** —— 测试是真理源
2. **任何"重复/冗余"判断前，对比完整生命周期（成功/失败/异常路径）**
3. **任何"命名/风格"判断前，看仓库整体一致性**
4. **诚实承认错误**——这次的报告如果没人复核就直接进代码，会删掉关键的去重逻辑和契约保护。

按 epistemic_calibration_protocol：原报告整体置信度应从 65% 下调到 **15%**。修正后置信度 **95%**（基于 4 个独立 subagent 的交叉验证）。