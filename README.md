# SRS Live Center

> 一个基于 [SRS 6](https://github.com/ossrs/srs) 的直播管理中心。
> 支持 **RTMP / SRT / WebRTC** 推拉流，集成 **公开/私有直播、推流与观看鉴权、
> 播放统计、弹幕聊天、多直播间、Edge 边缘分发**。

本项目是之前 `oryx-live-center` 的重构版：**移除了 Oryx 依赖，改为直接与 SRS HTTP API / http_hooks 对接**，更轻量、可控。

---

## ✨ 功能特性

- 🎥 **SRS 6 直接对接**：无 Oryx 中间层
- 🔐 **公开 / 私有直播**
  - 公开：任何人可观看，无需鉴权
  - 私有：需登录或携带 **Watch Token**
- 🛡 **推流鉴权**：`on_publish` 校验 `publish_secret`
- 📊 **播放统计**：`on_play` / `on_stop` 自动记录观众 session、观看时长
- 📡 **开播/下播状态**：`on_publish` / `on_unpublish` 实时更新房间状态
- 💬 **弹幕聊天**：可开关，登录后才能发言
- 🎬 **ArtPlayer 5.x**：FLV 与 HLS 自动选择
- 🏠 **多直播间**：每个房间可配置独立名称、推流密钥、观看密钥、聊天开关
- 🌐 **SRS Edge**：附一键脚本与文档，支持边缘节点回源分发
- 🔑 **Authentik OAuth2**：登录集成（可换任何兼容 OIDC 的 IdP）
- 🏗 **FastAPI + React 19 + Ant Design 6**

---

## 📁 目录结构

```
srs-live-center/
├── backend/               # FastAPI 后端
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── models.py
│       ├── schemas.py
│       ├── database.py
│       ├── auth.py        # JWT / OAuth / 依赖
│       ├── srs_client.py  # 与 SRS HTTP API 通信
│       └── routers/
│           ├── auth.py
│           ├── streams.py # 房间 CRUD + 播放/推流 URL 下发
│           ├── hooks.py   # SRS http_hooks 入口
│           ├── admin.py
│           └── chat.py    # WebSocket 聊天
├── frontend/              # React + Vite SPA
├── deploy/
│   ├── srs/srs.conf       # SRS Origin 配置
│   ├── nginx/nginx.conf   # Nginx 反向代理
│   └── srs-edge-setup.sh  # Edge 一键部署脚本
├── docs/
│   ├── srs-edge.md        # Edge 部署文档
│   └── ...
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

---

## 🚀 快速开始

### 1. 准备环境

```bash
cp .env.example .env
# 按需修改 .env：OAuth、JWT、SRS_HOOK_SECRET、CANDIDATE 等
```

> **CANDIDATE** 必须是 SRS 所在主机的公网 IP（WebRTC ICE 用）。

### 2. 启动

```bash
docker compose up -d --build
```

容器角色（**默认使用宿主机外部 Nginx**）：

| 容器 | 暴露端口 | 说明 |
| --- | --- | --- |
| `app` | `127.0.0.1:8000` | FastAPI + SPA，仅 loopback 暴露给宿主机 Nginx |
| `srs` | `1935`(TCP), `127.0.0.1:1985`, `127.0.0.1:8080`, `8000/udp`, `10080/udp` | SRS 6 媒体服务器 |
| `redis` | — | 状态缓存 |

宿主机 Nginx 把 80/443 反代到上面的 loopback 端口。
配置示例已经放在 [`deploy/nginx/external.conf.example`](deploy/nginx/external.conf.example)，
按 README 顶部的备注复制到 `/etc/nginx/sites-available/` 即可。

> **不想用外部 Nginx？** 取消 `docker-compose.yml` 中 `nginx:` 服务的注释，
> 并把 `app` / `srs` 的 `127.0.0.1:xxxx:xxxx` 改回 `xxxx:xxxx`，
> 内置 `deploy/nginx/nginx.conf` 即会作为单容器入口。

打开浏览器访问 <https://your-domain> 即可。

### 3. 创建直播间

1. 使用 OAuth2 账号登录
2. 管理员进入 **管理后台 → 直播间管理**
3. 新建一个房间：
   - `stream_name`：唯一推流名（URL 最后一段）
   - `display_name`：显示名称
   - `is_private`：是否私有（需登录/Token 才能看）
   - `publish_secret`：推流鉴权密钥
   - `watch_token`：私有观看 Token（可给观众分享）
   - `chat_enabled`：聊天开关
4. 复制后端返回的推流地址，推流到 SRS

---

## 🔑 鉴权流程

### 推流（on_publish）

`rtmp://<host>/live/<stream_name>?secret=<publish_secret>`

SRS 回调 `POST /api/hooks/on_publish`，后端校验 `secret`；校验失败返回非 0，SRS 拒绝推流。

### 播放（on_play）

**公开直播**：无需任何参数。

**私有直播**：播放 URL 带 `token`：

```
http://<host>/live/<stream_name>.flv?token=<watch_token_or_user_jwt>
```

SRS 回调 `POST /api/hooks/on_play`：
- 若 `token == watch_token` → 允许
- 若 `token` 是登录用户 JWT 且有效 → 允许
- 否则拒绝

同时后端写入一条 `StreamPlaySession`，`on_stop` 时关闭并累加总观看时长。

---

## 💬 聊天 / 弹幕

- 每个房间可关闭聊天
- 只有 **已登录、未被封禁** 的用户可发送
- 前端 `ChatPanel` 通过 `ws://<host>/api/chat/ws/<stream_name>?token=<jwt>` 订阅
- 历史消息通过 REST `GET /api/chat/{stream_name}/messages`

---

## 🌐 SRS Edge（多地域分发）

参见 [`docs/srs-edge.md`](docs/srs-edge.md) 与一键脚本 [`deploy/srs-edge-setup.sh`](deploy/srs-edge-setup.sh)。

## WebRTC 开关

如需「只允许 WebRTC 推送、不允许 WebRTC 播放」或按直播间粒度控制 WHEP，请阅读
[`docs/webrtc.md`](docs/webrtc.md)（全局开关 `WEBRTC_PLAY_ENABLED` + 每直播间开关）。

最简用法：

```bash
curl -fsSL .../deploy/srs-edge-setup.sh -o srs-edge-setup.sh
chmod +x srs-edge-setup.sh
sudo ORIGIN_HOST=origin.example.com \
     ORIGIN_HTTP_BASE=https://origin.example.com \
     CANDIDATE=<edge-public-ip> \
     ./srs-edge-setup.sh
```

---

## 🛠 本地开发

### 后端

```bash
cd backend
uv sync --extra dev
uv run uvicorn app.main:app --reload
```

### 前端

```bash
cd frontend
pnpm install
pnpm dev   # http://localhost:5173 -> 自动代理 /api、/live、/rtc
```

还需要在另一终端启动一个 SRS 容器（或直接 docker compose 起）：

```bash
docker run --rm -it --name srs-dev \
  -p 1935:1935 -p 1985:1985 -p 8080:8080 -p 8000:8000/udp \
  -v "$PWD/deploy/srs/srs.conf:/usr/local/srs/conf/srs.conf:ro" \
  -e CANDIDATE=127.0.0.1 \
  ossrs/srs:6 ./objs/srs -c conf/srs.conf
```

---

## 📜 许可

MIT
