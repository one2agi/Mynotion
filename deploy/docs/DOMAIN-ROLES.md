# one2agi 双域名运行边界

## 当前职责

| 能力                               | `www.one2agi.com` | `way.one2agi.com`  |
| ---------------------------------- | ----------------- | ------------------ |
| 主题                               | starter           | heo                |
| 首页                               | 品牌落地页        | 内容首页           |
| 文章、Page、归档、分类、标签、搜索 | 308 到 way        | 正式页面           |
| 评论、知识图谱、RSS                | 不对用户提供      | 正式入口           |
| Sitemap                            | 仅品牌首页        | 完整内容           |
| Webhook HTTP 入口                  | 接收并入共享队列  | 可用但不是订阅地址 |
| Webhook 队列消费                   | 否                | 是，每分钟一次     |

## 缓存边界

共享 Redis 中的 Notion 原始数据、文章 blocks、7 天兜底、Webhook 队列、
路由状态和知识图谱来源。两个容器不得共享 `.next`、build ID、JS/CSS 或
ISR 渲染结果；`notion-cache` 与 `notion-cache-way` 保持独立。

## 部署

共享代码变化使用：

```bash
cd /home/morav/myblog/NotionNext
./deploy/scripts/deploy.sh tencent-vps
```

脚本构建、传输并启动同一 tag 的 `notionnext` 与 `notionnext-way`，同步
Compose/nginx 配置，再检查 3030、3031、知识图谱和 www 内容 308。
`deploy-way.sh` 只用于 heo 主题文件紧急更新，不能发布共享逻辑。

## 人工验收

```bash
curl -I https://www.one2agi.com/
curl -I 'https://www.one2agi.com/article/3213?from=legacy'
curl -I https://way.one2agi.com/article/3213
curl -s https://www.one2agi.com/sitemap.xml
curl -s https://way.one2agi.com/sitemap.xml
```

预期：品牌首页 200；www 文章 308 且 `Location` 保留路径和查询参数；way
文章 200；www Sitemap 只有一个 URL；way Sitemap 含内容 URL。

## 回滚

将两个服务同时切回上一个 tag，并恢复上一个 nginx 配置。不要执行
`docker compose down -v`，共享 Redis 数据和两套独立 Next 缓存无需迁移。
