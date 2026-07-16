# VPS 双域名：品牌首页与内容站分离

此部署模式适用于同一个 Notion 内容库、两个产品入口：

- `www.one2agi.com`：starter 品牌首页，只负责首次访问和导流。
- `way.one2agi.com`：heo 内容站，负责文章、作品、归档、搜索、评论和知识图谱。

## 用户访问结果

主站首页中的文章和列表链接直接打开 `way`。历史 `www` 内容链接返回 308，
完整保留路径和查询参数，因此旧收藏、外链和搜索权重不会丢失。`www` 的
Next.js 资源、API、图片、`robots.txt` 和只含首页的 Sitemap 不会被误跳转。

## 更新结果

两个站复用 Notion、Redis 和 Webhook 队列，但只由 `way` 消费队列。正文变化
通常在 60 秒静默合并窗口加下一次一分钟任务内刷新 `way`；标题、摘要、
Slug、分类、标签、发布和删除变化还会刷新 `www` 首页。Webhook 不可用时，
5 分钟 ISR 继续作为访问触发的兜底。

## 缓存是否共享

| 层                                   | 是否共享 | 原因                       |
| ------------------------------------ | -------- | -------------------------- |
| Notion 原始数据、blocks、7 天兜底    | 是       | 内容事实相同，避免重复拉取 |
| Webhook 队列、路由状态、知识图谱来源 | 是       | 一个事件只解析和消费一次   |
| `.next`、build ID、JS/CSS、ISR HTML  | 否       | 主题和域名不同，禁止串页面 |

挂载 `/app/.next/cache` 只是两套独立的 Next.js 运行缓存，不代表共享 Pages
Router 的完整 ISR HTML；不要把两个 volume 合并。

## 发布与验证

共享代码使用协调部署脚本：

```bash
./deploy/scripts/deploy.sh tencent-vps
```

部署后至少验证：`www/` 为 200、`www/archive` 为 308、`way/archive` 为 200、
两个 Sitemap 的域名和内容边界正确、systemd timer 调用端口 3031。

详细的服务器文件、命令和回滚步骤见仓库中的
[`deploy/docs/DOMAIN-ROLES.md`](https://github.com/notionnext-org/NotionNext/blob/main/deploy/docs/DOMAIN-ROLES.md)。
