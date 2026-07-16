# 品牌首页与内容站域名分工设计

## 目标

`www.one2agi.com` 只承载 starter 品牌首页；`way.one2agi.com` 承载文章、独立页面、归档、分类、标签、搜索、评论、知识图谱、RSS 与内容 Sitemap。两个容器复用同一 Notion 数据库、Redis 原始数据、Webhook 队列和路由状态，但不共享 Next.js 构建产物或渲染缓存。

## 产品边界

- `www` 的 `/` 保留为品牌首页，首页中的站内内容链接直接指向 `way`。
- `www` 的历史内容 URL 使用 HTTP 308 保留路径和查询参数跳转到 `way`。
- `www` 的 `/_next/*`、`/api/*`、公开静态资源、`robots.txt` 和 `sitemap.xml` 不参与内容跳转。
- `way` 是内容页唯一 canonical 主机；`www` Sitemap 只含首页，`way` Sitemap 含完整内容。

## 配置契约

- `NEXT_PUBLIC_SITE_ROLE=landing|content`：声明构建角色。
- `NEXT_PUBLIC_LINK`：当前容器的公开 canonical 根地址。
- `NEXT_PUBLIC_CONTENT_SITE_URL`：内容站根地址，主站生成跨域内容链接时使用。
- `LANDING_REVALIDATION_URL`：内容容器访问主站 `/api/revalidate` 的 Docker 内网地址。
- `REVALIDATION_TOKEN`：两个容器共用的服务端鉴权令牌。

## 链接与跳转

SmartLink 在 `landing` 角色下将除 `/` 和锚点外的相对站内链接转换为 `way` 的绝对地址，并采用当前标签页普通导航。nginx 作为兼容兜底：根路径代理到 starter，基础设施路径继续代理到主站容器，其余路径返回 308 到 `way$request_uri`。

## Webhook 与缓存

Webhook 仍由 `www/api/notion-webhook` 接收并写入共享 Redis 队列。每分钟任务改为调用 `way:3031/api/revalidate`；`way` 只消费一次队列并执行现有 Notion 新鲜读取、路由分析、知识图谱更新和本地 ISR 刷新。当现有路由计划要求刷新 `/` 时，`way` 额外用相同 Bearer Token 调用 `LANDING_REVALIDATION_URL`，刷新 starter 首页。远程刷新失败视为本次路径失败，队列任务保留并重试。

这使正文变化只刷新文章和知识图谱；标题、摘要、Slug、分类、标签、发布与删除等会影响列表的变化同时刷新 `way` 列表和 `www` 首页。Redis 原始 Notion 数据、页面块、Webhook 队列和路由状态共享；两容器的 `.next`、build ID、JS/CSS 和 ISR 渲染结果保持隔离。

## SEO

- `www` 的 canonical 为 `https://www.one2agi.com/`。
- `way` 的 canonical、RSS 和内容 Sitemap 均使用 `https://way.one2agi.com`。
- `www/sitemap.xml` 不读取文章数据，仅返回品牌首页。
- 308 迁移使历史链接权重归并到 `way`，并避免双域内容重复收录。

## 故障与回滚

- `way` 暂时不可用时，`www` 品牌首页仍可独立访问。
- 主站首页远程刷新失败不会丢 Webhook 任务；下一分钟重试。
- 删除 nginx 内容跳转块、将定时任务端口改回 3030，即可恢复旧行为；共享 Redis 数据无需迁移。
