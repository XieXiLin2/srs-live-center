# 快速开始

> 本文档介绍如何在本地搭建 Oryx Live Center 的开发环境和生产部署。

## 前提条件

| 工具                                         | 最低版本 | 用途          |
| -------------------------------------------- | -------- | ------------- |
| [Node.js](https://nodejs.org/)               | 22+      | 前端构建      |
| [pnpm](https://pnpm.io/)                     | 9+       | 前端包管理    |
| [Python](https://www.python.org/)            | 3.12+    | 后端运行      |
| [uv](https://docs.astral.sh/uv/)            | 最新     | Python 包管理 |
| [Docker](https://www.docker.com/)            | 24+      | 容器化部署    |
| [Docker Compose](https://docs.docker.com/compose/) | v2  | 服务编排      |

外部服务要求：

- **Authentik** (或其他 OAuth2/OIDC Provider) — 用户认证
- **Oryx/SRS** — 直播流媒体服务器

---

## 本地开发

### 1. 克隆项目

```bash
git clone https://github.com/your-username/oryx-live-center.git
cd oryx-live-center
```

### 2. 配置后端

```bash
cd backend

# 复制环境变量模板
cp .env.example .env
```

编辑 `.env`，填入你的 OAuth2 和 Oryx 配置（详见 [配置文档](./configuration.md)）。

```bash
# 安装依赖
uv sync --extra dev

# 启动后端开发服务器
uv run uvicorn app.main:app --reload --port 8000
```

后端运行在 `http://localhost:8000`。

> **Tip**: 设置 `DEBUG=true` 可启用 Swagger 文档，访问 `http://localhost:8000/api/docs`。

### 3. 配置前端

```bash
cd frontend

# 安装依赖
pnpm install

# 启动前端开发服务器
pnpm dev
```

前端运行在 `http://localhost:5173`，Vite 开发服务器自动配置了以下代理：

| 路径      | 代理目标                  | 说明               |
| --------- | ------------------------- | ------------------ |
| `/api/*`  | `http://localhost:8000`   | 后端 API           |
| `/ws/*`   | `ws://localhost:8000`     | WebSocket 弹幕     |
| `/live/*` | `http://localhost:2022`   | Oryx 媒体流 (FLV/HLS) |
| `/rtc/*`  | `http://localhost:2022`   | Oryx WebRTC 信令   |

### 4. 启动 Oryx（可选）

如果你本地没有运行 Oryx，可使用 Docker 快速启动：

```bash
docker run -d --name oryx \
  -p 2022:2022 \
  -p 1935:1935 \
  -p 8000:8000/udp \
  -p 10080:10080/udp \
  -e REACT_APP_LOCALE=zh \
  ossrs/oryx:5
```

### 5. 启动 Redis（可选）

```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

---

## Docker 部署

### 一键启动

```bash
# 创建环境变量文件
cp backend/.env.example .env
# 编辑 .env 填入你的配置
```

```bash
# 构建并启动所有服务
docker compose up -d
```

这会启动以下三个容器：

| 容器名                    | 端口映射         | 说明                        |
| ------------------------- | ---------------- | --------------------------- |
| `oryx-live-center`        | `3000:8000`      | 应用主服务（前端 + 后端）   |
| `oryx-live-center-oryx`   | `1935`, `8000/udp`, `10080/udp` | Oryx/SRS 流媒体   |
| `oryx-live-center-redis`  | (内部)           | Redis 缓存                  |

访问 `http://localhost:3000` 即可使用。

### Docker Compose 配置概览

```yaml
services:
  app:
    build: .
    ports:
      - "3000:8000"        # Web 应用
    volumes:
      - app-data:/app/data # SQLite 数据持久化
    env_file:
      - .env
    depends_on:
      - redis
      - oryx

  oryx:
    image: ossrs/oryx:5
    ports:
      - "1935:1935"        # RTMP 推流
      - "8000:8000/udp"    # WebRTC
      - "10080:10080/udp"  # SRT

  redis:
    image: redis:7-alpine
```

### Docker 多阶段构建

`Dockerfile` 使用多阶段构建，最终镜像仅包含运行时依赖：

1. **Stage 1**: Node.js 22 Alpine — 构建前端 (`pnpm build`)
2. **Stage 2**: Python 3.12 Slim — 安装后端依赖 + 复制前端产物 → 最终镜像

### 自定义端口

修改 `docker-compose.yml` 中的端口映射：

```yaml
ports:
  - "80:8000"    # 将应用映射到 80 端口
```

### 数据持久化

- **应用数据** (SQLite): 存储在 Docker Volume `app-data`，挂载到 `/app/data`
- **Oryx 数据**: 存储在 Docker Volume `oryx-data`
- **Redis 数据**: 存储在 Docker Volume `redis-data`

---

## 验证部署

### 健康检查

```bash
curl http://localhost:3000/api/health
# 返回: {"status": "ok", "app": "Oryx Live Center"}
```

### 测试推流

使用 OBS 或 FFmpeg 推流到 Oryx：

```bash
ffmpeg -re -i input.mp4 \
  -c:v libx264 -c:a aac \
  -f flv rtmp://localhost:1935/live/test
```

然后打开 `http://localhost:3000`，应该能看到名为 `test` 的直播流。

---

## 常见问题

### Q: 前端页面空白？

检查后端是否正常运行，且 `docker compose logs app` 无报错。生产环境下前端静态文件被编译到 `/app/static` 目录中。

### Q: 无法观看直播流？

1. 确认 Oryx 正在运行且有推流
2. 检查 `ORYX_HTTP_URL` 配置是否正确
3. Docker 部署时，确保容器间网络互通（使用服务名 `oryx` 而非 `localhost`）

### Q: OAuth 登录失败？

1. 确认 Authentik 中 Redirect URI 配置为你的域名 + `/auth/callback`
2. 检查 `OAUTH2_CLIENT_ID` 和 `OAUTH2_CLIENT_SECRET` 是否正确
3. 确保 Scope 包含 `openid profile email`
