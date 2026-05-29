# 关于站点缓存
> 迁移自：[关于站点缓存](https://docs.tangly1024.com/article/cache-of-notion-next)
> 发布日期：2024-9-6
> 最后编辑：2024-9-6
> 原栏目：🛠 站点配置

> **⚠️**
>
在了解如何修改站点配置之前，我们需要了解一下NotionNext的缓存机制。


## 前言

你可能会遇到这样的问题，修改了站点的菜单、标题、公告后，访问网站首页发现已经生效了，但是点击到里面的文章子页面后发现，每个文章子页面的标题、菜单、公告都是错误的旧版，

这是怎么回事？


## 关于缓存


### 独立缓存

每个子页面的缓存都是独立的，例如首页、文章详情页。

![image.png](/legacy/12e0baae06d9fb7f.png)

![image.png](/legacy/67243d1442c50650.png)

因此左上角的标题和右下角的公告，在每个子页面都有一个独立的缓存，修改标题后，首页的标题生效了，但是打开每个子页面中还会显示上一个缓存的版本。


### 缓存更新机制

页面数据的只有在用户访问后才会手动触发，访问站点的任意页面，默认会展示站点初次部署，或上次更新后的页面缓存。

这是为了让用户可以第一时间打开页面，而无需等待抓取Notion最新数据。

什么时候更新？

1. 从首页博客列表进入此文章，并在此页面按下F5进行刷新

1. 直接从搜索引擎或其它直接链接访问到这篇文章。

这两种情况会触发NotionNext去重新拉取数据，同时页面不会等待拉取结果，会直接返回上一个缓存版本。拉取数据可能耗费几秒时间，拉取完会自动渲染出新的页面版本并进行缓存，以备下一位用户或你的下一次访问。
此时再第二次刷新页面，返回的就是最新拉取并渲染出的版本，页面的内容就是正确的了。

每次只会拉取一个页面的数据。


### 公共部分的配置

标题、菜单、公告这些公共部分的内容修改后，每个页面都要刷新两次才能看到最新版本。

这样如果你发表了上百篇文章后，要去每一个文章页面更新公共部分会很困难。


### 解决缓存问题的办法

修改了公共的配置、标题这些之后，建议整体重新部署一下项目。
等这些固定下来后，后续更新文章的时候，就只要单独请求最新的文章即可完成更新流程。

## 按需刷新缓存（On-Demand Revalidation）

NotionNext 支持通过接口主动刷新页面缓存，适合以下场景：

1. 在 Notion 中发布或修改文章后，希望指定页面立即更新。
1. 修改首页、分类页、标签页等列表内容后，希望主动刷新对应页面。
1. 使用 Notion Webhook、自动化脚本或 CI 在内容变更后触发刷新。

### 开启方式

在 Vercel、服务器环境变量或 `.env.local` 中配置 `REVALIDATION_TOKEN`：

```bash
REVALIDATION_TOKEN=your-secret-token-here
```

`REVALIDATION_TOKEN` 是刷新接口的访问密钥。不要把真实 Token 提交到 GitHub，也不要写进公开文档或截图。

### 刷新单个页面

请求 `POST /api/revalidate`，并在 `Authorization` 请求头中传入 Token：

```bash
curl -X POST https://your-site.com/api/revalidate \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"path": "/article/my-post"}'
```

`path` 需要填写站点内路径，例如：

| 页面 | 示例 |
| --- | --- |
| 首页 | `/` |
| 文章页 | `/article/my-post` |
| 分类页 | `/category/随笔` |
| 标签页 | `/tag/NotionNext` |

### 批量刷新多个页面

如果一次内容更新影响多个页面，可以传入 `paths`：

```bash
curl -X POST https://your-site.com/api/revalidate \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"paths": ["/", "/article/my-post", "/tag/NotionNext"]}'
```

### 清理本地缓存并刷新首页

当你修改了公共配置、菜单、公告、站点标题等内容，可以使用 `all: true` 清理本地 Notion 缓存，并刷新首页：

```bash
curl -X POST https://your-site.com/api/revalidate \
  -H "Authorization: Bearer your-secret-token-here" \
  -H "Content-Type: application/json" \
  -d '{"all": true}'
```

注意：`all: true` 会清理 NotionNext 的本地缓存，并立即刷新首页；其它文章页、分类页、标签页仍会在下次访问或单独 revalidate 时生成最新缓存。若你要确保某几篇文章立即更新，建议同时使用 `paths` 指定这些页面。

### 自动化触发

你可以把上面的请求接入 Notion Webhook、GitHub Actions、Vercel Cron 或其它自动化工具。自动化工具只需要能发送 `POST` 请求，并带上：

- `Authorization: Bearer <REVALIDATION_TOKEN>`
- `Content-Type: application/json`
- JSON body：`path`、`paths` 或 `all`

### 常见返回

| 状态码 | 含义 |
| --- | --- |
| `200` | 请求已处理，返回每个路径的刷新结果 |
| `401` | Token 错误或未传 Token |
| `405` | 请求方法错误，只支持 `POST` |
| `503` | 未配置 `REVALIDATION_TOKEN`，接口未启用 |

### 与重新部署的区别

按需刷新适合“内容已经改了，只想让某些页面尽快更新”的场景；重新部署适合升级代码、安装依赖、修改构建配置、切换大范围站点设置等场景。若站点使用静态导出部署，仍需要按对应平台重新构建发布。


## 其它

- 所有人看到的都是一样的内容，只要有一个人去触发了更新，其他人就能看到更新后的版本

- 可以参考《[vercel快速重新部署项目](https://www.notion.so/51692c88623649e8b650132c7f8321da?pvs=25)》

## 原文链接

https://docs.tangly1024.com/article/cache-of-notion-next
