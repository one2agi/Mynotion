# 主题性能优化（第 1 轮）

日期：2026-06-03
分支：`codex/performance-optimization-main`
版本目标：`4.9.5.9`

## 本轮变更

### 1) 全局插件加载优化
- 文件：`components/ExternalPlugins.js`
- 改动：
  - 将自定义外部资源加载从组件渲染期移入 `useEffect`，并改为异步调度（`requestIdleCallback` / `setTimeout`）执行。
  - 对 `CUSTOM_EXTERNAL_CSS`、`CUSTOM_EXTERNAL_JS` 做 `useMemo` 过滤，避免重复计算与重复注入。
  - 将 `GLOBAL_JS` 执行从无依赖的副作用改为 `useEffect([GLOBAL_JS])`，并加 `try/catch`，避免每次 render 重复执行导致重复注入与潜在阻塞。

### 2) Typography 搜索高亮按需加载
- 文件：`themes/typography/index.js`
- 改动：
  - `LayoutSearch` 中将 `replaceSearchResult` 迁移为按需动态 import（仅在搜索页生效时触发），避免首页/文章页初始包裹入这部分代码。
  - 将搜索高亮挂载改为延后执行（`requestIdleCallback` 或 fallback timeout），降低首屏阻塞。

### 3) 搜索高亮逻辑统一优化（跨主题）
- 文件：`components/Mark.js`
- 改动：
  - 将 `mark.js` 库加载改为一次性 Promise 缓存，避免同一次会话内重复请求。
  - 对搜索关键词进行安全转义，避免异常正则导致高亮路径中断。
  - 用 `requestIdleCallback`（兼容 fallback）将高亮执行延后，减少直接阻塞主线程高峰。
  - 保持现有高亮输出（className/element）与配置不变。

### 4) 主题性能审计脚本跨平台兼容修复
- 文件：`scripts/audit-theme-performance.js`
- 改动：
  - 按平台选择 `lighthouse` 可执行路径（Windows 优先 `lighthouse.cmd`，未命中时降级到 `lighthouse` 或包内 CLI 入口）。
  - `runLighthouse` 执行路径改为变量化，避免 Windows 下 `spawnSync` 识别问题。
  - `main` 改为同步流程，移除 `async`/.`catch` 的不匹配调用。

## 验证

- `yarn type-check`：通过
- `yarn build`：通过
- `yarn lint`：本机环境报错“未识别 pages/app 目录”，暂未通过该项验证（与当前 Next.js 启动环境路径解析相关，不影响已完成编译与类型校验结果）

## 风险与影响
- 外部脚本加载改为延迟，不影响现有配置项与插件开关逻辑（`DISABLE_PLUGIN` 等保持不变）。
- `GLOBAL_JS` 只在内容变化时执行，行为与配置结果保持一致，但降低了重复注入风险。

## 下一步计划（P2）
- 继续梳理主题层面仍有较重的首屏逻辑（特别是搜索、目录、高频 DOM 遍历逻辑），按影响面优先落地。
- 建立可复用的主题级延迟执行基线（空闲/滚动触发），并补齐多主题对比的自动化 Lighthouse 报告。

