# 主题新手任务池

这份清单用于维护者快速创建 `good first issue` / `help wanted`，也方便新贡献者挑选低门槛任务。

## 使用方法

1. 从下方复制一个任务标题和正文。
2. 在 GitHub Issues 新建任务。
3. 根据难度添加 `good first issue` 或 `help wanted`。
4. 如果任务来自 Discussions，请在 Issue 中贴上原讨论链接。

## Good First Issue

### 任务 1：补充主题适用场景说明

**标题：** `docs(theme): 补充 <theme> 主题适用场景`

**正文：**

```markdown
目标：补充 `docs/user-guide/themes/<theme>.md` 中的适用场景，让新用户更容易判断是否适合自己。

建议包含：

- 适合什么站点
- 不适合什么站点
- 推荐使用人群
- 与相近主题的区别

验收：

- 文档语言面向普通站长
- 不涉及代码改动
- 链接能正常跳转
```

### 任务 2：补充主题切换面板简介

**标题：** `docs(theme): 为 <theme> 补充 themeSwitch 简介`

**正文：**

```markdown
目标：在 `conf/themeSwitch.manifest.js` 中为 `<theme>` 补充 `summary`，让主题切换面板更容易理解。

验收：

- `summary` 一句话说明主题定位
- 不超过 40 个中文字符
- 不改变主题默认行为
```

### 任务 3：补充主题预览截图

**标题：** `docs(theme): 补充 <theme> 主题预览图`

**正文：**

```markdown
目标：为 `<theme>` 补充或替换预览图。

需要提交：

- `public/images/themes-preview/<theme>.png`
- `public/images/themes-preview/<theme>.webp`

验收：

- 图片能展示主题真实首页
- 图片不包含个人隐私信息
- 文件名与主题目录名一致
```

### 任务 4：整理一个主题风格参考清单

**标题：** `community(theme): 整理 <style> 风格参考站点`

**正文：**

```markdown
目标：为 `<style>` 主题方向整理参考站点，帮助后续开发者拆解 UI。

建议包含：

- 3 到 5 个参考站点
- 每个站点适合借鉴的部分
- 不建议照搬的部分
- 可能适合基于哪个 NotionNext 主题改造

验收：

- 输出到 Discussions 回复或文档草稿
- 不需要写代码
```

## Help Wanted

### 任务 5：认领本月主题协调员

**标题：** `community(theme): 认领 <yyyy-mm> 主题协调员`

**正文：**

```markdown
目标：本月协助整理主题想法、拆分任务和维护 Discussions 汇总。

职责：

- 每周查看一次主题风格建议 Discussions
- 把成熟想法整理成 Theme contribution Issue
- 给低门槛任务加 `good first issue`
- 给需要协作的任务加 `help wanted`
- 月底发布一次主题生态回顾

不要求：

- 亲自实现所有主题
- 回答所有技术问题
- 代替主理人做架构决策

验收：

- 至少整理 1 条主题建议
- 至少创建或更新 1 个可认领任务
- 月底在 Discussions 发一条简短回顾
```

### 任务 6：基于 example 做主题首页雏形

**标题：** `theme: 基于 example 实现 <theme> 首页雏形`

**正文：**

```markdown
目标：复制 `themes/example` 为 `themes/<theme>`，先完成首页最小可运行雏形。

范围：

- 首页布局
- 文章卡片
- 基础导航
- 移动端一列布局

暂不要求：

- 完整文章页
- 所有列表页
- 高级动效
- 完整配置项

验收：

- `yarn dev` 可运行
- 首页无明显布局错位
- 不直接引用其它主题私有组件
```

### 任务 7：补现有主题移动端体验

**标题：** `theme: 改进 <theme> 移动端导航与列表体验`

**正文：**

```markdown
目标：改进 `<theme>` 在移动端的导航、列表卡片和文章页阅读体验。

检查页面：

- 首页
- 文章页
- 分类页
- 标签页
- 搜索页

验收：

- 375px 宽度下不横向滚动
- 菜单可打开/关闭
- 卡片文字不溢出
- 深色模式仍可读
```

### 任务 8：补 AI 主题开发真实案例

**标题：** `docs(ai): 补充一个 AI 辅助主题改造案例`

**正文：**

```markdown
目标：给 `docs/user-guide/development/ai-theme-prompts.md` 或 `notion-next-develop-with-ai.md` 补一个真实案例。

建议包含：

- 参考风格
- 使用的基准主题
- 给 AI 的提示词
- 修改了哪些文件
- 最终效果截图
- 遇到的问题

验收：

- 新手能照着复现
- 不包含私有密钥或个人站点敏感信息
```
