# 主题生态与 AI 开发教程计划

## 背景

社区反馈中提到：NotionNext 已有较高的 GitHub 热度和架站数量，但普通用户选择工具时，第一印象往往来自主题视觉呈现，而不是技术架构本身。

现有主题已经覆盖博客、文档、作品集、官网、导航、杂志等场景，但如果能持续补充更多设计语言，并提供一套“用 AI 辅助迁移/二次创作主题”的教程，会更容易吸引非专业开发者参与主题共建。

## 目标

把“更多主题设计风格 + AI 辅助主题开发教程”沉淀为可跟踪的计划任务，后续可拆成 Discussions、Issue 或 PR。

## 已落地入口

- 主题风格征集：`.github/DISCUSSION_TEMPLATE/theme-idea.yml`
- 主题贡献任务：`.github/ISSUE_TEMPLATE/theme_contribution.yml`
- 入门教程：[借助 AI 开发 NotionNext](../user-guide/development/notion-next-develop-with-ai.md)
- AI 提示词包：[AI 主题开发提示词包](../user-guide/development/ai-theme-prompts.md)
- 社区活动方案：[NotionNext 主题共创挑战](../community/THEME_CHALLENGE.zh-CN.md)
- 长期运营模型：[主题生态长期运营模型](../community/THEME_ECOSYSTEM_OPERATING_MODEL.zh-CN.md)
- 新手任务池：[主题新手任务池](../community/GOOD_FIRST_THEME_TASKS.zh-CN.md)
- 进阶指南：[主题迁移指南](./THEME_MIGRATION_GUIDE.zh-CN.md)

## 长期运营原则

这个方向应按“社区自运转”设计，而不是依赖主理人持续手动推进：

- 主理人只做方向判断、高风险 PR 守门和争议裁决。
- 主题协调员每月整理想法、拆 Issue、维护任务池。
- 新贡献者从文档、截图、单组件、单页面开始。
- 所有成熟经验沉淀为模板、提示词、任务池和文档。
- 能由社区互相回答的问题，不进入主理人私聊队列。

## 计划任务

### 1. 梳理主题设计方向

优先整理适合 NotionNext 的主题风格候选：

- 日式便当 / 卡片式圆角矩形布局
- Google Material / 扁平化内容布局
- 经典博客主题致敬，例如 Hexo、WordPress、Typecho 风格
- 极简作品集 / 个人品牌站
- SaaS / Product Hunt / 开源项目官网
- Magazine / Starter / GitBook 这类功能型主题

交付物：

- 在 Discussions 发起“主题风格征集”帖
- 整理候选风格、参考站点、适用场景与可复用组件
- 将成熟方向转为 `help wanted` / `good first issue`

### 2. 编写 AI 辅助主题开发教程

在现有 [借助 AI 开发 NotionNext](../user-guide/development/notion-next-develop-with-ai.md) 的基础上，补充面向“主题搬运 / 二次创作”的专项教程。

建议覆盖：

- 如何拆解一个喜欢的网站 UI：布局、字号、色彩、间距、组件层级
- 如何让 AI 生成主题结构改造方案
- 如何选择基准主题：`example`、`simple`、`starter`、`endspace` 等
- 如何把设计稿或参考站点映射到 `themes/<id>/components`
- 如何调整 Tailwind class、CSS 变量和主题 `config.js`
- 如何适配深色模式、移动端和图片预览
- 如何补齐主题文档、预览图和 `themeSwitch.manifest`

交付物：

- 入门教程：`docs/user-guide/development/notion-next-develop-with-ai.md`
- 进阶补充：`docs/developer/THEME_MIGRATION_GUIDE.zh-CN.md`
- 可复制的 AI 提示词模板

### 3. 建立主题贡献任务模板

为了降低社区参与门槛，后续可补充一个主题贡献 Issue 模板或 Discussion 模板。

模板建议包含：

- 主题名称与目标用户
- 参考设计链接或截图
- 计划基于哪个现有主题二次开发
- 首页、列表页、文章页、标签页、搜索页、404 页覆盖情况
- 深色模式、移动端、SEO、预览图、文档检查项

交付物：

- `.github/ISSUE_TEMPLATE/theme_request.yml` 或 Discussion 模板
- 主题贡献检查清单
- 示例任务：从一个小型主题改造开始，而不是一次性迁移完整复杂站点

## 建议拆分顺序

1. 先在 Discussions 收集主题风格与参考站点。
2. 补充 AI 辅助主题开发教程，帮助用户把想法变成可运行主题。
3. 为 1 到 2 个简单主题方向创建 `good first issue`。
4. 跑通“参考站点拆解 → 主题实现 → 文档 → 预览图 → PR”的完整流程。

## 验收标准

- 新贡献者能根据教程复制一个现有主题并完成可预览的视觉改造。
- 新主题 PR 能明确说明目标场景、设计参考、配置项、预览图和移动端表现。
- 主题目录、用户文档、开发者文档、预览图和主题切换 manifest 保持同步。
- 社区讨论中的主题建议能被归档为可认领任务，而不是只停留在聊天记录里。
