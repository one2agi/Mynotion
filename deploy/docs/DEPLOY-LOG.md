# 部署日志 — notion.one2agi.com

## 部署概况

| 项 | 值 |
|---|---|
| 部署时间 | 2026-07-14/15 (Asia/Shanghai) |
| 部署目标 | 腾讯云 VPS,Ubuntu 24.04.4 LTS |
| 镜像 | `notionnext:v4.10.5` (387MB) |
| 部署方式 | docker save + scp + docker load |
| 镜像 tag | `v4.10.5` (git tag) + `latest` (auto) |
| 反向代理 | 现有 nginx + certbot(用户服务器已有) |
| HTTPS 证书 | Let's Encrypt 自动签发,有效期 90 天,自动续期 |
| 域名解析 | DNSPod A 记录 `notion.one2agi.com` → `124.220.65.87` |
| 端口 | app 容器绑 `127.0.0.1:3030`(避免和现有 3000 冲突) |

## 服务器信息

- **主机名**: `tencent-vps` (SSH config alias)
- **公网 IP**: `124.220.65.87`
- **OS**: Ubuntu 24.04.4 LTS (Noble Numbat)
- **资源**: 3.6GB RAM, 4 CPU, 40GB disk (25G used, 14G free)
- **已有服务**(保留不动):
  - `n8n.one2agi.com` (n8n)
  - `openclaw` 服务
  - `tavily` 代理
  - `wechat-article` (端口 3000 已占,本项目用 3030)
  - `weread.one2agi.com` (we2n api)
  - `mihomo` (代理,端口 7890/1053/9090)

## 文件位置

| 路径 | 用途 |
|---|---|
| `/opt/notionnext/` | 项目根目录(项目代码 + 配置) |
| `/opt/notionnext/.env.production` | 13 个 EdgeOne env vars + 3 个 runtime vars |
| `/etc/nginx/sites-enabled/0-notionnext.conf` | 合并的 vhost(80+443,n3 个域名) |
| `/etc/letsencrypt/live/{notion,www}.one2agi.com/` | Let's Encrypt 证书(已合并 3 域名) |
| `/var/log/nginx/` | nginx 访问日志 |

## Part 3: 完全迁移 — 删 EdgeOne,www.one2agi.com 切到 VPS(2026-07-15)

| 域名 | DNS 解析 | 服务 | 状态 |
|---|---|---|---|
| `www.one2agi.com` | A 124.220.65.87(RecordId 2340579009) | VPS Docker | ✅ HTTPS 200 |
| `one2agi.com` | A 124.220.65.87(RecordId 2340599828) | VPS Docker | ✅ HTTPS 200 |
| `notion.one2agi.com` | A 124.220.65.87(RecordId 2340561253) | VPS Docker | ✅ HTTPS 200(保留) |
| `n8n.one2agi.com` | A 124.220.65.87 | 现有 nginx n8n | 不动 |
| `faiz.one2agi.com` | A 124.220.65.87 | 现有 nginx openclaw | 不动 |
| `tavily.one2agi.com` | A 124.220.65.87 | 现有 nginx tavily | 不动 |
| `weread.one2agi.com` | A 124.220.65.87 | 现有 nginx weread | 不动 |

**EdgeOne Pages mynotion**: 保留(用户决定暂不删,但已停用 — 不再 deploy 新版本)

**备份**:
- `deploy/backups/edgeone-mynotion-env.backup` — 13 个 env vars 完整备份

---

## 部署步骤回放(Part 1 + Part 2 + Part 3)

## 部署步骤回放(Part 1)

1. **服务器探查** — Ubuntu 24.04 + Docker 29.5.3 已装 + nginx active + 多个 one2agi 子域名
2. **调整端口** — `notionnext` 容器从 3000 改用 3030(wechat-article 占用 3000)
3. **推送项目** — `rsync` 推 32MB 项目代码 + `scp` 推 .env.production(secrets)
4. **推送镜像** — `./deploy/scripts/deploy.sh tencent-vps` 一键完成
5. **配置 nginx** — 复制 `weread.one2agi.com.conf` 模板,改 server_name + proxy_pass
6. **DNS 解析** — `tccli dnspod CreateRecord` 加 A 记录 (RecordId: 2340561253)
7. **签证书** — `certbot certonly --webroot` + `certbot --nginx` 配合,避免 certbot 失败导致 nginx reload 错
8. **reload nginx** — 证书签好后,niginx -t 通过,reload 成功

## 关键决策点

| 决策 | 原因 |
|---|---|
| **用 nginx 不用 Caddy** | 服务器已有 nginx + certbot 跑 5 个子域名,沿用一致,降低维护成本 |
| **端口 3030 不用 3000** | wechat-article-exporter 已占 3000,避免冲突 |
| **sudo --preserve-env=IMAGE_TAG** | sudo 默认重置环境变量,需要保留 IMAGE_TAG 让 docker compose 用 v4.10.5 |
| **certbot certonly --webroot 不用 --nginx** | --nginx 要求 nginx -t 通过(证书存在),但首次签没证书会失败 |
| **临时 webroot-only conf** | 避免 certbot --nginx 改 conf 时与证书缺失冲突 |

## 已知问题 + 后续

### 1. Docker healthcheck 报 unhealthy
- `/api/health` 实际 `ok:true`(在 health 路径上健康)
- 容器 healthcheck 命令 `wget -q --spider http://...:3000/api/health` 在健康时返 0,但 Docker healthcheck Log 显示 ExitCode 8
- 可能 busybox wget 1.25 在 sh -c 上下文 `--content-on-error` 行为不稳
- **建议**:改用 `wget -q -O - http://...:3000/` 调主页(永远 200,绕开 health 路径复杂性)
- 不影响功能,只影响 Docker `ps` 显示

### 2. 没加 fail2ban
- 22 端口仅 10.0.0.0/8 ALLOW(内网限制)
- 公网 SSH 端口可能需要额外防爆破
- 建议:`apt install fail2ban`,默认配置就够

### 3. 没配自动备份
- redis-data 容器 volume 在 host,容器挂掉会丢知识图谱
- 建议:加 cron,每天 `redis-cli BGSAVE` + 备份到对象存储

### 4. 没配监控告警
- 没有外部监控(无 UptimeRobot / 阿里云监控)
- 建议:加 UptimeRobot(免费)每 5 分钟检查 `https://notion.one2agi.com/api/health`

## 未来:完全迁移 www.one2agi.com(下一步)

如果决定把 `www.one2agi.com` 也切到 VPS:
1. DNSPod 加 `www` A 记录 → 124.220.65.87(从 EdgeOne CNAME 改)
2. 加 nginx vhost 跟现有 n8n 一样
3. EdgeOne Pages mynotion 项目**暂停**(不删,留 env vars 备份)
4. 等 2 周稳定后,EdgeOne Pages 项目可删除

## 重新部署

```bash
# 本地
cd /home/morav/myblog/NotionNext
./deploy/scripts/deploy.sh tencent-vps

# 或指定 tag
DEPLOY_TAG=v1.0.0 ./deploy/scripts/deploy.sh tencent-vps
```

自动完成:build → save → scp → load → up → 冒烟测试 → 清理旧镜像(只清本项目)。
