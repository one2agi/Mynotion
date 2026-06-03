# 主题性能优化（第 1 轮）

日期：2026-06-03
分支：`codex/performance-optimization-main`
版本目标：`4.9.5.8`

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
