# 快速开始

> 本文档介绍如何在本地搭建 SRS Live Center 的开发环境，以及最小化的生产部署流程。

## 前提条件

| 工具                                               | 最低版本 | 用途          |
| -------------------------------------------------- | -------- | ------------- |
| [Node.js](https://nodejs.org/)                     | 22+      | 前端构建      |
| [pnpm](https://pnpm.io/)                           | 9+       | 前端包管理    |
| [Python](https://www.python.org/)                  | 3.12+    | 后端运行      |
| [uv](https://docs.astral.sh/uv/)                   | 最新     | Python 包管理 |
| [Docker](https://www.docker.com/)                  | 24+      | 容器化部署    |
| [Docker Compose](https://docs.docker.com/compose/) | v2       | 服务编排      |

外部服务要求：

- **OAuth2 / OIDC Provider**（如 Authentik、Keycloak，或本仓库自带的
  [`mock-oauth/`](../mock-oauth/README.md)）— 用户认证
- **SRS 6**（[ossrs/srs:6](https://hub.docker.com/r/ossrs/srs)）— 直播流媒体服务器

> 本项目已经移除 Oryx 依赖，**直接**通过 SRS HTTP API（默认 `:1985`）和
> HTTP-FLV（默认 `:8080`）与 SRS 6 通讯，同时使用 `http_hooks` 做推流/播放鉴权
> 与统计。

---

## 本地开发

### 1. 克隆项目

```bash
git clone https://github.com/XieXiLin2/srs-live-center.git
cd srs-live-center
```

### 2. 启动 SRS 6

本地开发时推荐用 Docker 跑一个 SRS 容器，直接挂载仓库里的 `deploy/srs/srs.conf`：

```bash
docker run --rm -it --name srs-dev \
  -p 1935:1935 -p 1985:1985 -p 8080:8080 \
  -p 8000:8000/udp -p 10080:10080/udp \
  -v "$PWD/deploy/srs/srs.conf:/usr/local/srs/conf/srs.conf:ro" \
  -e CANDIDATE=127.0.0.1 \
  ossrs/srs:6 ./objs/srs -c conf/srs.conf
```

| SRS 端口        | 用途                                |
| --------------- | ----------------------------------- |
| `1935/tcp`      | RTMP 推流                           |
| `1985/tcp`      | SRS HTTP API（供后端查询流 / 客户端） |
| `8080/tcp`      | HTTP-FLV / HLS                      |
| `8000/udp`      | WebRTC UDP 媒体                     |
| `10080/udp`     | SRT                                 |

`srs.conf` 已经把 `http_hooks` 指向 `http://host.docker.internal:8000/api/hooks/*`，
SRS 会主动回调后端来授权 / 上报。

### 3. 启动 Redis（可选）

目前 Redis 仅做预留（聊天/限流等），本地调试可跳过：

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

### 4. 配置并启动后端

```bash
cd backend

# 复制环境变量模板
cp .env.example .env
```

编辑 `.env`，填入你的 OAuth2 参数以及 SRS 地址（详见 [配置文档](./configuration.md)）。

```bash
# 安装依赖（含开发工具）
uv sync --extra dev

# 启动后端开发服务器（自动重载）
uv run uvicorn app.main:app --reload --port 8000
```

后端运行在 `http://localhost:8000`。

> **Tip**: 设置 `DEBUG=true` 可启用 Swagger 文档，访问
> `http://localhost:8000/api/docs`。

### 5. 启动前端

```bash
cd frontend

pnpm install
pnpm dev
```

前端默认跑在 `http://localhost:5173`，Vite 已经自动配置了以下代理：

| 路径      | 代理目标                | 说明                         |
| --------- | ----------------------- | ---------------------------- |
| `/api/*`  | `http://localhost:8000` | 后端 REST API                |
| `/ws/*`   | `ws://localhost:8000`   | WebSocket 聊天 / 观众心跳    |
| `/live/*` | `http://localhost:8000` | HTTP-FLV（经后端反代到 SRS） |
| `/rtc/*`  | `http://localhost:8000` | WebRTC WHIP / WHEP 信令      |

> 开发模式下前端直接打 FastAPI，由 FastAPI 里的媒体代理把 `/live/<stream>.flv`
> 和 `/rtc/v1/*` 转发到 SRS。生产部署推荐用前置 Nginx 替代这个代理（见下文）。

### 6. 一键测试推流

用 FFmpeg 推一路假流到刚启的 SRS，再在浏览器打开 `http://localhost:5173`：

```bash
ffmpeg -re -f lavfi -i "testsrc2=size=1280x720:rate=30" \
       -f lavfi -i "sine=frequency=1000" \
       -c:v libx264 -preset veryfast -tune zerolatency \
       -c:a aac -ar 44100 -b:a 96k \
       -f flv rtmp://localhost:1935/live/test?secret=<room-publish-secret>
```

`<room-publish-secret>` 是你在后台 **直播间管理 → 新建房间** 时生成的
`publish_secret`。没有配置房间的流会被 `on_publish` hook 直接拒绝。

---

## Docker Compose 一键启动

项目根目录提供了完整的 `docker-compose.yml`，默认拉取预构建镜像
`ghcr.io/xiexilin2/srs-live-center:latest`。

### 1. 准备环境

```bash
cp .env.example .env
# 按需修改 OAUTH2_*、JWT_SECRET、SRS_HOOK_SECRET、CANDIDATE 等
```

> **CANDIDATE** 必须是 SRS 所在宿主机的公网 IP（WebRTC ICE 需要）。

### 2. 启动

```bash
docker compose up -d
```

默认编排会启动 3 个容器，**假设宿主机已经有一个外部 Nginx** 负责 80/443：

| 容器                      | 暴露端口                                            | 说明                     |
| ------------------------- | --------------------------------------------------- | ------------------------ |
| `srs-live-center-app`     | `127.0.0.1:8000`                                    | FastAPI + 打包好的 SPA   |
| `srs-live-center-srs`     | `1935`, `127.0.0.1:1985`, `127.0.0.1:8080`, `8000/udp`, `10080/udp` | SRS 6 媒体服务器 |
| `srs-live-center-redis`   | 仅容器内网                                          | 预留缓存                 |

宿主机 Nginx 将 80/443 反代到上面的 loopback 端口，配置样例见
[`deploy/nginx/external.conf.example`](../deploy/nginx/external.conf.example)。

> 想让 Docker Compose 自带 Nginx？取消 `docker-compose.yml` 里 `nginx:` 服务
> 的注释，同时把 `app` / `srs` 的 `127.0.0.1:xxxx:xxxx` 改回 `xxxx:xxxx`，
> 内置 `deploy/nginx/nginx.conf` 会接管 80 端口。

### 3. 验证

```bash
# 容器健康
docker compose ps

# 后端日志
docker compose logs -f app

# 健康检查
curl http://127.0.0.1:8000/api/health
# 返回: {"status": "ok", "app": "SRS Live Center"}
```

### 4. 创建第一个直播间

1. 浏览器访问 `https://your-domain`（或 `http://127.0.0.1:8000`）
2. 使用 OAuth2 账号登录（测试用可以直接接 `mock-oauth`）
3. 进入 **管理后台 → 直播间管理 → 新建房间**
4. 复制页面上展示的 **RTMP / SRT / WHIP** 推流地址给主播即可

---

## 常见问题

### Q: 前端页面空白？

- 确认后端正在运行：`docker compose logs app` 无报错；
- 生产镜像下前端被打包到 `/app/static`，由 FastAPI 兜底返回 SPA；
- 如果使用外部 Nginx，检查反代 `/` → `127.0.0.1:8000` 是否配置正确。

### Q: 推流被拒绝（SRS 日志 `on_publish rejected`）？

1. 推流 URL 里的 `?secret=xxx` 必须匹配 **直播间管理** 里该房间的
   `publish_secret`；
2. 房间必须先在后台创建，未配置的 `stream_name` 会被 `on_publish` 返回 404；
3. 检查 `SRS_HOOK_SECRET` 是否和 `srs.conf` 里 `http_hooks` URL 上的
   `?hook_secret=xxx` 一致。

### Q: 无法播放 FLV？

- 开发模式下走 FastAPI 的 `/live/<stream>.flv` 反代，请确认 SRS 可达且
  `SRS_HTTP_URL` 指向正确的 `http://srs:8080` 或 `http://localhost:8080`；
- 生产环境推荐由前置 Nginx 直接把 `/live/` 反代到 SRS，不走 FastAPI。

### Q: OAuth 登录失败？

1. 确认 IdP 里 **Redirect URI** 与 `.env` 的 `OAUTH2_REDIRECT_URI` **完全一致**；
2. 检查 `OAUTH2_CLIENT_ID` / `OAUTH2_CLIENT_SECRET`；
3. Scope 至少包含 `openid profile email`，如需管理员检测还需返回 `groups`；
4. 本地调试可以先用仓库里的 `mock-oauth/` 取代 Authentik，见
   [`mock-oauth/README.md`](../mock-oauth/README.md)。
