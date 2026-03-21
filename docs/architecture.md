# 架构设计

> Oryx Live Center 的系统架构与技术选型说明。

## 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                            │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  React SPA  │  │  ArtPlayer   │  │  WebSocket Client  │  │
│  │  Ant Design │  │  mpegts.js   │  │  (弹幕/聊天)       │  │
│  │  React Router│  │  hls.js      │  │                    │  │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │ HTTP/REST      │ FLV/HLS/WebRTC     │ WebSocket
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI 后端 (port 8000)                   │
│  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌─────────────┐  │
│  │ Auth API │  │Stream API│  │Chat API │  │  Admin API  │  │
│  │ OAuth2   │  │          │  │WebSocket│  │  Oryx Proxy │  │
│  └────┬─────┘  └────┬─────┘  └────┬────┘  └──────┬──────┘  │
│       │              │             │               │         │
│  ┌────┴──────────────┴─────────────┴───────────────┴──────┐  │
│  │              反向代理 (FLV/HLS/TS 媒体流)               │  │
│  └──────────────────────────┬──────────────────────────────┘  │
└─────────────────────────────┼────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Authentik     │ │   Oryx / SRS    │ │     Redis       │
│   (OAuth2/OIDC) │ │   (port 2022)   │ │   (port 6379)   │
│                 │ │   RTMP: 1935    │ │                 │
│                 │ │   WebRTC: 8000  │ │                 │
│                 │ │   SRT: 10080    │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │     SQLite      │
                    │   (app.db)      │
                    └─────────────────┘
```

## 技术栈

| 层级       | 技术                                          | 说明                           |
| ---------- | --------------------------------------------- | ------------------------------ |
| **前端**   | React 19 + TypeScript                         | 用户界面                       |
| **UI 框架**| Ant Design 6                                  | 企业级组件库                   |
| **播放器** | ArtPlayer + mpegts.js + hls.js                | 直播流播放 (FLV/HLS/WebRTC)   |
| **构建**   | Vite 8                                        | 前端构建与开发服务器           |
| **后端**   | Python 3.12 + FastAPI                         | REST API + WebSocket           |
| **ORM**    | SQLAlchemy 2.0 (async)                        | 异步数据库访问                 |
| **数据库** | SQLite + aiosqlite                            | 嵌入式数据库，可换 PostgreSQL  |
| **认证**   | OAuth2 / OpenID Connect                       | 对接 Authentik                 |
| **JWT**    | python-jose                                   | 登录态管理                     |
| **缓存**   | Redis 7                                       | 聊天/弹幕中间件（预留）       |
| **媒体**   | Oryx / SRS 5                                  | 直播流媒体服务器               |
| **容器**   | Docker + Docker Compose                       | 部署与编排                     |

## 模块说明

### 前端模块

```
frontend/src/
├── api.ts              # Axios API 客户端，统一管理所有后端请求
├── types.ts            # TypeScript 类型定义
├── App.tsx             # 路由配置（React Router v7）
├── store/
│   └── auth.tsx        # 认证状态管理（Context API）
├── components/
│   ├── AppLayout.tsx   # 全局布局（Header + Footer）
│   ├── LivePlayer.tsx  # 播放器组件（ArtPlayer 封装）
│   └── ChatPanel.tsx   # 实时聊天/弹幕面板（WebSocket）
└── pages/
    ├── Home.tsx        # 首页 - 直播列表 + 播放器 + 弹幕
    ├── AuthCallback.tsx # OAuth2 回调页
    └── admin/
        ├── AdminLayout.tsx    # 管理后台布局（侧边栏导航）
        ├── Dashboard.tsx      # 系统概览仪表盘
        ├── StreamsManage.tsx  # 直播流配置管理
        ├── UsersManage.tsx    # 用户管理（封禁/解封）
        ├── OryxClients.tsx    # Oryx 客户端管理
        ├── OryxConfigPage.tsx # 通用 JSON 配置编辑页
        └── OryxPages.tsx      # Oryx 子功能页（DVR/HLS/转推等）
```

### 后端模块

```
backend/app/
├── main.py         # FastAPI 入口、中间件、反向代理、SPA 兜底
├── config.py       # pydantic-settings 配置管理
├── database.py     # SQLAlchemy async engine & session
├── models.py       # ORM 模型（User, ChatMessage, StreamConfig）
├── schemas.py      # Pydantic 请求/响应 Schema
├── auth.py         # JWT 工具 + OAuth2 Token 交换 + 依赖注入
└── routers/
    ├── auth.py     # /api/auth/* — 登录/注册/用户信息
    ├── chat.py     # /api/chat/* — WebSocket 弹幕 + 历史记录
    ├── streams.py  # /api/streams/* — 直播列表/播放地址/流配置
    └── admin.py    # /api/admin/* — 用户管理 + Oryx API 代理
```

## 请求流程

### 用户观看直播

```
1. 浏览器请求 GET /api/streams/  →  后端查询 Oryx API 获取在线流列表
2. 用户选择直播  →  POST /api/streams/play  →  后端返回播放 URL
3. ArtPlayer 通过相对路径 /live/stream.flv 请求媒体流
4. 后端 main.py 反向代理将请求转发到 Oryx HTTP 服务器
5. FLV 流通过 StreamingResponse 实时推送给浏览器
```

### 弹幕发送

```
1. 浏览器建立 WebSocket 连接: ws://host/api/chat/ws/{stream_name}?token=xxx
2. 服务端验证 JWT Token，关联用户
3. 用户发送消息 → 服务端保存到 SQLite → 广播给同房间所有连接
4. 支持匿名观看（不能发言），登录后可发送弹幕
```

### OAuth2 登录

```
1. 前端请求 GET /api/auth/login → 后端生成 Authentik 授权 URL
2. 浏览器跳转 Authentik → 用户登录 → 带 code 回调到 /auth/callback
3. 前端取 code → POST /api/auth/callback → 后端交换 token + 获取 userinfo
4. 后端创建/更新用户 → 签发 JWT → 返回给前端
5. 前端存储 JWT 到 localStorage，后续请求带 Authorization header
```

## 媒体流反向代理

后端 `main.py` 内置了媒体流反向代理，匹配路径 `/{app}/{stream}.(flv|m3u8|ts|aac|mp3)`：

- **FLV 流**: 使用 `StreamingResponse` 实时流式代理
- **HLS 文件** (`.m3u8`、`.ts`): 完整读取后返回
- **其他路径**: 降级为 SPA 路由兜底 (`index.html`)

这样设计的好处是：**浏览器无需直接访问 Oryx 的地址**，只需通过同域请求即可获取媒体流，避免跨域问题。

## 数据库模型

| 模型           | 表名             | 说明                              |
| -------------- | ---------------- | --------------------------------- |
| `User`         | `users`          | 用户信息，OAuth2 同步             |
| `ChatMessage`  | `chat_messages`  | 弹幕/聊天消息记录                 |
| `StreamConfig` | `stream_configs` | 直播流配置（加密、鉴权等）        |

## CDN 支持

当配置了 `CDN_BASE_URL` 时，播放地址会自动使用 CDN 域名替代相对路径：

- 未配置 CDN: `/live/stream.flv`（走后端反向代理）
- 已配置 CDN: `https://cdn.example.com/live/stream.flv`（直接访问 CDN）
