> 尽量按此模板PR内容，或粘贴相关的ISSUE链接。

## 已知问题

1. (示例)版本号管理不规范
   - 版本号直接写在环境变量中，容易出错
   - 多处维护版本号，可能不一致

## 解决方案

1. (示例)将版本号管理从 `.env.local` 迁移到 `package.json`
   - 统一从 `package.json` 读取版本号
   - 使用 IIFE 优雅处理版本号获取逻辑
   - 保持向后兼容，支持环境变量覆盖

## 改动收益

1. (示例)更规范的版本管理
   - 统一从 `package.json` 读取
   - 保持与 npm 生态一致
   - 减少人为错误

## 具体改动

1. （示例）`blog.config.js`
   - 移除原有的静态版本号配置
   - 在文件末尾添加动态版本号获取逻辑
   - 保持向后兼容，优先使用环境变量
   - 添加错误处理和默认值

## 测试确认

- [ ] 本地开发环境测试通过
- [ ] 生产环境构建测试通过
- [ ] （如适用）版本号正确显示
- [ ] （如适用）环境变量配置正常工作

## 用户文档（`docs/user-guide/`）

若本 PR 新增或改变用户可见能力，例如 API、环境变量、配置项、主题选项、插件开关、部署方式、CLI 命令或迁移步骤，请同步维护 `docs/user-guide/` 中对应说明，便于用户知道如何使用。

若本 PR **未** 修改 `docs/user-guide/`、`docs/developer/` 中与站长相关的说明，请勾选「不适用」并在“文档说明”里写明原因。

- [ ] 不适用（无文档改动）
- [ ] 已按 [维护工作流](https://github.com/notionnext-org/NotionNext/blob/main/docs/user-guide/MAINTENANCE_WORKFLOW.md) 自检
- [ ] 新功能 / 新配置 / 新 API 已补充使用方法，或已创建紧跟的 docs PR
- [ ] 路径符合 `docs/user-guide/` 目录约定
- [ ] 已更新 [user-guide/README.md](https://github.com/notionnext-org/NotionNext/blob/main/docs/user-guide/README.md)（新增/移动文章时）
- [ ] 已更新 [ARTICLE_INDEX.md](https://github.com/notionnext-org/NotionNext/blob/main/docs/user-guide/ARTICLE_INDEX.md)（新 slug 或路径变更时）
- [ ] 环境变量名与 `conf/*.config.js` 一致（若文档涉及配置）
- [ ] 示例中无真实 Token、`.env`、私有 ID
- [ ] 保留或更新了「原文链接」（若源自 docs.tangly1024.com）

文档说明（可选）：对应官方 slug / URL、是否与功能 PR 配套

## 主题贡献（如适用）

若本 PR 新增主题、重做主题视觉、或改变主题配置，请对照 [主题迁移指南](https://github.com/notionnext-org/NotionNext/blob/main/docs/developer/THEME_MIGRATION_GUIDE.zh-CN.md) 自检。

- [ ] 不适用（非主题 PR）
- [ ] 主题代码位于 `themes/<id>/`
- [ ] 未直接引用其它主题目录的私有组件
- [ ] 已验证首页、文章页、列表页、搜索页、404 页
- [ ] 已验证移动端与深色模式
- [ ] 已补充 `docs/user-guide/themes/<id>.md`
- [ ] 已提交 `public/images/themes-preview/<id>.png` 与 `.webp`
- [ ] 已更新 `conf/themeSwitch.manifest.js`
