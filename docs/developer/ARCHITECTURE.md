# 架构总览

[English](./ARCHITECTURE.en.md)

## 核心链路

NotionNext 的主流程可以简化为：

1. **数据获取层**（`lib/db/`）  
   从 Notion 拉取数据、做结构归一化、字段映射、缓存与去重。
2. **服务端数据组装层**（`lib/db/SiteDataApi.js`）  
   统一产出 `allPages` / `tagOptions` / `categoryOptions` / `siteInfo` 等。
3. **路由层**（`pages/`）  
   在 `getStaticProps/getStaticPaths` 中做页面级过滤、分页、渲染准备。
   例外：locale 路由下的 4 个页面（见下文「Locale JSON 数据端点」）用 `getServerSideProps`。
4. **主题层**（`themes/`）  
   各主题通过统一的数据契约消费 `props`，渲染不同 UI。

### Locale JSON 数据端点

`next.config.js` 用 rewrites（而非 Next.js 原生 i18n）剥离 locale 前缀：

```js
{ source: '/:locale(zh|en)/:path*', destination: '/:path*' }
```

HTML 路由正常（rewrites 在请求时生效）。但 Next.js 只在构建时为**真实的页面文件路径**生成 `/_next/data/{buildId}/*.json`，不会为 rewrite 的源路径生成。客户端 router 预取 `/_next/data/{buildId}/zh-CN/archive.json` 找不到文件，会返回 404 并 fallback 到整页 reload，丢失 SPA 导航。

**取舍**：locale 路由下的 4 个顶层页面因此改用 `getServerSideProps`，在请求时 SSR，跳过预生成 JSON 文件查找。多段路径的页面（`[prefix]/[slug]`、`category/[slug]`、`tag/[slug]`、`search/[keyword]`）保留 `getStaticProps`，因为其 rewrite 后的多段路径仍能匹配 Next.js 生成的数据文件。

涉及页面（commits `5d81d8fb` / `573c577e` / `33d1b338` / `5e705434`）：

| 页面 | 改前 | 改后 |
| --- | --- | --- |
| `pages/index.js` | `getStaticProps` | `getServerSideProps` |
| `pages/archive/index.js` | `getStaticProps` | `getServerSideProps` |
| `pages/page/[page].js` | `getStaticProps` + `getStaticPaths` | `getServerSideProps` |
| `pages/dashboard/[[...index]].js` | `getStaticProps` + `getStaticPaths` | `getServerSideProps` |

回归保护：`__tests__/pages/locale-routing.test.js` 结构化校验上述 4 个页面必须导出 `getServerSideProps` 且不得导出 `getStaticProps`。

## 数据优先级

配置读取优先级（高 -> 低）：

1. Notion Config 表同名键
2. 环境变量（`.env.local` / 部署平台 env）
3. `blog.config.js` + `conf/*.config.js`

## 为什么强调“数据层下沉”

如果某个排序/过滤策略属于“全局业务规则”，优先放在数据层而非分散在多个页面路由中。  
好处：

- 减少改动面和重复逻辑
- 降低漏改风险（分页/分类/搜索路由容易遗漏）
- 让所有主题行为一致

## 缓存与构建相关

- 缓存模块位于 `lib/cache/`
- 构建阶段并发与预热逻辑位于 `lib/build/`
- 这些模块会影响 CI/CD 和大站点构建速度，改动时需要附带验证说明

