# 部署指南

> 将 Oryx Live Center 部署到生产环境的详细说明。

## Docker Compose 部署（推荐）

### 1. 准备服务器

- Linux 服务器（推荐 Ubuntu 22.04+）
- Docker 24+ 和 Docker Compose v2
- 域名（可选，推荐用于 HTTPS）
- 开放端口：80/443（Web）、1935（RTMP）、8000/udp（WebRTC）、10080/udp（SRT）

### 2. 配置环境变量

```bash
# 克隆项目
git clone https://github.com/your-username/oryx-live-center.git
cd oryx-live-center

# 创建环境变量
cp backend/.env.example .env
```

编辑 `.env` 文件，**以下变量必须修改**：

```env
# 安全密钥（使用随机值）
APP_SECRET_KEY=<随机字符串>
JWT_SECRET=<随机字符串>

# OAuth2 配置
OAUTH2_CLIENT_ID=your-actual-client-id
OAUTH2_CLIENT_SECRET=your-actual-client-secret
OAUTH2_AUTHORIZE_URL=https://auth.yourdomain.com/application/o/authorize/
OAUTH2_TOKEN_URL=https://auth.yourdomain.com/application/o/token/
OAUTH2_USERINFO_URL=https://auth.yourdomain.com/application/o/userinfo/
OAUTH2_REDIRECT_URI=https://live.yourdomain.com/auth/callback

# 生产模式
DEBUG=false
ALLOWED_ORIGINS=https://live.yourdomain.com
```

生成安全密钥：

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

### 3. 构建和启动

```bash
docker compose up -d --build
```

### 4. 验证运行

```bash
# 检查容器状态
docker compose ps

# 检查日志
docker compose logs -f app

# 健康检查
curl http://localhost:3000/api/health
```

---

## Nginx 反向代理

推荐使用 Nginx 作为前端反向代理，提供 HTTPS 和域名绑定。

### 配置示例

```nginx
server {
    listen 80;
    server_name live.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name live.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    client_max_body_size 100M;

    # 主应用
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket 弹幕
    location /api/chat/ws/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # FLV 直播流（长连接）
    location ~* \.(flv)$ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 86400;
    }

    # HLS 直播流
    location ~* \.(m3u8|ts)$ {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache off;
        add_header Cache-Control "no-cache";
    }
}
```

---

## WebRTC 配置

如果需要使用 WebRTC 播放，需要配置 `CANDIDATE` 环境变量：

```env
# .env
CANDIDATE=your-server-public-ip
```

并确保以下端口开放：

- `8000/udp` — WebRTC UDP 媒体
- 端口范围可在 Oryx 中自定义

---

## CDN 配置

### 配置 CDN 拉流

1. 在 CDN 服务商（如 Cloudflare、AWS CloudFront）创建拉流分发
2. 源站设置为 Oryx HTTP 地址（如 `http://your-server:2022`）
3. 在 `.env` 中配置：

```env
CDN_BASE_URL=https://cdn.yourdomain.com
CDN_PULL_SECRET=your-cdn-auth-secret
```

配置后，播放地址会自动使用 CDN 域名。

---

## 数据备份

### SQLite 数据库

```bash
# 备份
docker compose exec app cp /app/data/app.db /app/data/app.db.backup

# 或从宿主机
docker cp oryx-live-center:/app/data/app.db ./backup-$(date +%Y%m%d).db
```

### Oryx 数据

```bash
# Oryx 数据存储在 oryx-data volume
docker run --rm -v oryx-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/oryx-backup-$(date +%Y%m%d).tar.gz /data
```

---

## 升级

### 更新应用

```bash
cd oryx-live-center
git pull

# 重新构建
docker compose up -d --build

# 查看日志确认无误
docker compose logs -f app
```

### 更新 Oryx

修改 `docker-compose.yml` 中的 Oryx 镜像版本：

```yaml
oryx:
  image: ossrs/oryx:5  # 更新为最新版本
```

```bash
docker compose pull oryx
docker compose up -d oryx
```

---

## 监控和日志

### 查看日志

```bash
# 所有服务
docker compose logs -f

# 单个服务
docker compose logs -f app
docker compose logs -f oryx
docker compose logs -f redis
```

### 健康检查端点

```
GET /api/health              → 应用健康状态
GET /api/admin/oryx/check    → Oryx 健康状态（需管理员）
GET /api/admin/oryx/status   → 平台运行状态（需管理员）
```

---

## 安全建议

1. **修改所有默认密钥**: `APP_SECRET_KEY`、`JWT_SECRET`
2. **使用 HTTPS**: 通过 Nginx + Let's Encrypt 配置
3. **限制 CORS**: 将 `ALLOWED_ORIGINS` 设为实际域名
4. **关闭调试模式**: 生产环境 `DEBUG=false`
5. **防火墙**: 仅开放必要端口 (80, 443, 1935, 8000/udp)
6. **定期备份**: 数据库和 Oryx 数据
7. **更新依赖**: 定期更新 Docker 镜像和应用依赖
