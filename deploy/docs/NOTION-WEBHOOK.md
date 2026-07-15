# Notion Webhook 主动刷新运维指南

这套流程把 Notion 页面变更先写入 Redis 队列，再由 VPS 上的一分钟
systemd timer 调用现有 `/api/revalidate`。定时任务不可用时，原有五分钟
ISR、Notion Worker/直连兜底、Redis 内容缓存和评论功能仍然工作。

## 前置条件

- 应用监听宿主机 `127.0.0.1:3030`，容器名为 `notionnext-app`。
- `/opt/notionnext/.env.production` 归 root 所有且权限为 `0600`。
- 环境文件中有唯一、非空的 `REVALIDATION_TOKEN`。
- 应用已包含 `/api/notion-webhook`、`{bootstrap:true}` 和
  `{dirty:true}` 的实现；先部署应用，再安装 timer。

以下两个变量只能放在服务器私有环境文件，绝不能添加
`NEXT_PUBLIC_` 前缀：

```dotenv
NOTION_WEBHOOK_VERIFICATION_TOKEN=
NOTION_WEBHOOK_SETUP_MODE=false
```

## 安装与一次性验证

在本地仓库执行：

```bash
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps install
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps begin-setup
```

然后在 Notion Connection 管理页面创建订阅，Webhook URL 为：

```text
https://www.one2agi.com/api/notion-webhook
```

只订阅六类页面事件：

- `page.content_updated`
- `page.properties_updated`
- `page.created`
- `page.deleted`
- `page.undeleted`
- `page.moved`

Notion 发出验证请求后，显式执行下面的敏感操作。它是唯一会把一次性
验证 token 输出到终端的模式；不要录屏、复制到聊天或保存到 shell 历史。

```bash
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps show-token
```

把该值粘贴到 Notion Connection 的验证表单。验证成功后执行：

```bash
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps finish
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps status
```

`finish` 从容器直接复制 mode `0600` 的临时 token 文件，原子更新
`.env.production`，删除 setup mode 和容器临时文件，只重建 `app`，执行
一次路由状态 bootstrap；仅当响应包含 `ok:true` 时才启用 timer。

## 日常检查与禁用

```bash
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps status
ssh tencent-vps 'sudo journalctl -u notionnext-notion-refresh.service --since "30 min ago" --no-pager'
```

禁用主动刷新：

```bash
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps disable
```

该命令只停止 service/timer，不清 Redis、不删除 Docker volume，也不修改
五分钟 ISR。随后在 Notion Connection UI 暂停或删除订阅即可完整停用入口。

## 回滚

1. 先执行 `disable`，再暂停 Notion 订阅。
2. 如需回滚应用，用现有部署流程恢复上一个镜像 tag，只重建 `app`。
3. 不执行 `docker compose down -v`，不删除 `redis-data` 或
   `notion-cache` volume。
4. 修复后可重复执行 `install`；重新验证订阅时从 `begin-setup` 开始。

systemd oneshot 和 runner 的 `flock` 共同防止任务重叠。单次 HTTP 调用最多
240 秒，service 在 250 秒超时。Authorization 通过 curl 标准输入配置传递，
不会出现在进程参数中。
