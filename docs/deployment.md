# 部署指南

> 将 SRS Live Center 部署到生产环境的详细说明。

## Docker Compose 部署（推荐）

### 1. 准备服务器

- Linux 服务器（推荐 Ubuntu 22.04+）
- Docker 24+ 和 Docker Compose v2
- 域名（推荐，用于 HTTPS）
- 开放端口：
  - `80/443` → 应用（外部 Nginx）
  - `1935/tcp` → RTMP 推流
  - `10080/udp` → SRT
  - `8000/udp` → WebRTC 媒体
  - （`127.0.0.1:1985` / `127.0.0.1:8080` 仅本机，由外部 Nginx 反代）

### 2. 配置环境变量

```bash
# 克隆项目
git clone https://github.com/XieXiLin2/srs-live-center.git
cd srs-live-center

# 创建环境变量
cp .env.example .env
```

编辑 `.env`，**以下变量必须修改**：

```env
# 安全密钥
APP_SECRET_KEY=<随机字符串>
JWT_SECRET=<随机字符串>
SRS_HOOK_SECRET=<随机字符串>   # 也要写到 srs.conf 的 http_hooks URL 里

# OAuth2 配置
OAUTH2_CLIENT_ID=your-actual-client-id
OAUTH2_CLIENT_SECRET=your-actual-client-secret
OAUTH2_AUTHORIZE_URL=https://auth.yourdomain.com/application/o/authorize/
OAUTH2_TOKEN_URL=https://auth.yourdomain.com/application/o/token/
OAUTH2_USERINFO_URL=https://auth.yourdomain.com/application/o/userinfo/
OAUTH2_LOGOUT_URL=https://auth.yourdomain.com/application/o/end-session/
OAUTH2_REDIRECT_URI=https://live.yourdomain.com/auth/callback

# 生产模式
DEBUG=false
ALLOWED_ORIGINS=https://live.yourdomain.com
PUBLIC_BASE_URL=https://live.yourdomain.com

# WebRTC：SRS 宿主机的公网 IP
CANDIDATE=203.0.113.10
```

生成随机密钥：

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

### 3. 构建和启动

```bash
docker compose up -d
```

默认会拉取预构建镜像 `ghcr.io/xiexilin2/srs-live-center:latest`；如果想本地
构建改成：

```bash
docker compose up -d --build
```

### 4. 验证运行

```bash
# 容器状态
docker compose ps

# 后端日志
docker compose logs -f app

# 健康检查（本机）
curl http://127.0.0.1:8000/api/health
```

---

## 外部 Nginx 反向代理（默认拓扑）

`docker-compose.yml` 默认把 `app` / SRS HTTP 绑到 `127.0.0.1`，假设宿主机已有
一个外部 Nginx 负责 80/443。样例见
[`deploy/nginx/external.conf.example`](../deploy/nginx/external.conf.example)。

关键要点：

```nginx
server {
    listen 80;
    server_name live.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name live.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/live.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/live.yourdomain.com/privkey.pem;

    client_max_body_size 50M;

    # 前端 + 后端 API
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 聊天 / 观众 WS
    location ~ ^/api/(chat|viewer)/ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    # HTTP-FLV 直接反代 SRS（不要走 FastAPI 反代）
    location ~ ^/[^/]+/[^/]+\.flv$ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 86400;
    }

    # WHIP / WHEP 信令
    location /rtc/v1/ {
        proxy_pass http://127.0.0.1:1985;
        proxy_set_header Host $host;
    }
}
```

### 使用内置 Nginx 容器

如果宿主机没有 Nginx，取消 `docker-compose.yml` 里 `nginx:` 服务的注释，同时
把 `app` / `srs` 的端口从 `127.0.0.1:xxxx:xxxx` 改回 `xxxx:xxxx`，内置
`deploy/nginx/nginx.conf` 就会接管 80 端口。

---

## WebRTC 配置

WebRTC 需要浏览器能直连 SRS 的 UDP 端口（默认 8000/udp）。

1. `.env` 中写入 SRS 宿主机的 **公网 IP**：

   ```env
   CANDIDATE=203.0.113.10
   ```

2. 防火墙放行 `8000/udp`。
3. 如需完全关闭 WebRTC 播放，把 `WEBRTC_PLAY_ENABLED=false` 传给后端；仍允许
   WHIP 推流。更多细节见 [`webrtc.md`](./webrtc.md)。

---

## Edge 节点（多机房分发）

原点以外的 Edge 节点只做"拉 + 缓存 + 分发"，不跑后端，也不鉴权；鉴权可由
Origin 的 Nginx / FastAPI 在 `on_play` 阶段统一处理。一键脚本与手工配置详见
[`srs-edge.md`](./srs-edge.md)：

```bash
curl -fsSL https://raw.githubusercontent.com/XieXiLin2/srs-live-center/main/deploy/srs-edge-setup.sh -o srs-edge-setup.sh
chmod +x srs-edge-setup.sh
sudo ORIGIN_HOST=origin.example.com \
     ORIGIN_HTTP_BASE=https://origin.example.com \
     CANDIDATE=<edge-public-ip> \
     ./srs-edge-setup.sh
```

---

## 数据备份

### SQLite

```bash
# 容器内备份
docker compose exec app sh -c 'cp /app/data/app.db /app/data/app.db.backup'

# 从宿主机复制出来
docker cp srs-live-center-app:/app/data/app.db ./backup-$(date +%Y%m%d).db
```

### 卷持久化

`docker-compose.yml` 中声明的三个命名卷：

| 卷名         | 内容                                  |
| ------------ | ------------------------------------- |
| `app-data`   | FastAPI 的 SQLite / 上传文件          |
| `srs-data`   | SRS 内置 web 目录（HLS 片段等）       |
| `redis-data` | Redis 数据（当前主要预留）            |

快照这些卷即可完整备份业务状态。

---

## 升级

### 应用

```bash
cd srs-live-center
git pull

# 重新拉取预构建镜像或本地构建
docker compose pull app     # 使用官方镜像
docker compose up -d app    # 应用更新
```

### SRS

如需升级 SRS，修改 `docker-compose.yml` 中 `ossrs/srs:6` 的 tag，然后：

```bash
docker compose pull srs
docker compose up -d srs
```

> SRS 升级通常不会影响 `stream_configs`、`viewer_sessions` 等业务表；但 hook
> 协议 / API 路径如果变动，需要同步更新 `backend/app/srs_client.py` 与
> `routers/hooks.py`。

---

## 监控与日志

```bash
# 全部服务
docker compose logs -f

# 单个服务
docker compose logs -f app
docker compose logs -f srs
docker compose logs -f redis
```

健康检查端点：

```
GET /api/health                    → 应用健康状态（公开）
GET /api/admin/srs/summary         → SRS 系统摘要（需管理员）
GET /api/admin/srs/streams         → SRS 实时流列表（需管理员）
```

---

## 安全建议

1. **修改所有默认密钥**：`APP_SECRET_KEY`、`JWT_SECRET`、`SRS_HOOK_SECRET`
2. **使用 HTTPS**：Nginx + Let's Encrypt
3. **收紧 CORS**：把 `ALLOWED_ORIGINS` 设为实际域名
4. **关闭调试模式**：生产环境 `DEBUG=false`
5. **防火墙**：仅开放必要端口（80、443、1935、8000/udp、10080/udp）
6. **不要把 SRS HTTP API（1985）暴露到公网** — `docker-compose.yml` 默认就是
   `127.0.0.1:1985:1985`，请勿改成 `0.0.0.0`
7. **定期备份**：`app-data` / `srs-data` 两个卷
8. **更新依赖**：定期拉新版 Docker 镜像
