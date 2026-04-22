# 架构设计

> SRS Live Center 的系统架构与技术选型说明。
>
> 本项目是原 `oryx-live-center` 的重构版：**去掉了 Oryx 中间层，直接与 SRS 6
> 的 HTTP API / `http_hooks` 对接**。

## 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                            │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  React SPA  │  │  ArtPlayer   │  │  WebSocket Client  │  │
│  │  Ant Design │  │  mpegts.js   │  │  聊天 + 观众心跳   │  │
│  │  React Router│  │  WHEP (SDP) │  │                    │  │
│  └──────┬──────┘  └──────┬───────┘  └─────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │ HTTP/REST      │ FLV / WebRTC       │ WebSocket
          ▼                ▼                    ▼
┌──────────────────────────────────────────────────────────────┐
│               Nginx（外部或内置）/ FastAPI（dev）             │
│      /api/*  →  FastAPI        /live/*  →  SRS HTTP-FLV       │
│      /rtc/v1/* →  SRS WHIP/WHEP（HTTP 信令）                  │
└──────────────────────────────────────────────────────────────┘
          │                       │                    
          ▼                       ▼                    
┌──────────────────────────┐   ┌──────────────────────────────┐
│    FastAPI 后端 (:8000)   │   │        SRS 6 媒体服务器       │
│  ┌──────┐  ┌──────────┐  │   │  RTMP :1935 / SRT :10080/udp │
│  │ auth │  │ streams  │  │   │  HTTP-FLV :8080              │
│  │ chat │  │ viewer   │  │◀──┤  HTTP API  :1985             │
│  │ admin│  │ branding │  │   │  WebRTC    :8000/udp         │
│  │ hooks│  │ edge     │  │   │                              │
│  └──┬───┘  └────┬─────┘  │   │  http_hooks → /api/hooks/*   │
│     │           │         │   └──────────────┬───────────────┘
│     │    SRS HTTP API     │                  │ HTTP POST
│     └─────(httpx)─────────┼──────────────────┘ on_publish /
│                           │                    on_unpublish
│  ┌──────────┐  ┌────────┐ │                    on_play / on_stop
│  │ SQLite   │  │ Redis  │ │
│  └──────────┘  └────────┘ │
└──────────────────────────┘
```

和旧架构最大的不同：**所有原本由 Oryx 管理 API 提供的能力（直播状态、客户端
管理、推流密钥、直播间等）现在都由后端自己维护**，SRS 只保留「谁在推、谁在看
RTMP/WebRTC」这种媒体层事实。

## 技术栈

| 层级        | 技术                                          | 说明                                  |
| ----------- | --------------------------------------------- | ------------------------------------- |
| **前端**    | React 19 + TypeScript 5.9                     | 用户界面                              |
| **UI 框架** | Ant Design 6                                  | 企业级组件库                          |
| **播放器**  | ArtPlayer + mpegts.js + 原生 WebRTC (WHEP)    | 直播流播放（FLV / WebRTC）            |
| **构建**    | Vite 8                                        | 前端构建与开发服务器                  |
| **后端**    | Python 3.12 + FastAPI                         | REST API + WebSocket                  |
| **ORM**     | SQLAlchemy 2.0 (async) + aiosqlite            | 异步 DB 访问，可换 PostgreSQL         |
| **认证**    | OAuth2 / OpenID Connect                       | 对接 Authentik / Keycloak / mock-oauth |
| **JWT**     | python-jose                                   | 登录态                                |
| **缓存**    | Redis 7                                       | 预留：聊天、限流                      |
| **媒体**    | SRS 6 （ossrs/srs:6）                         | 直播流媒体服务器                      |
| **容器**    | Docker + Docker Compose                       | 部署与编排                            |
| **反代**    | Nginx（外部或内置）                           | 同域入口 + HTTP-FLV / WHEP 分发       |

## 模块说明

### 前端模块

```
frontend/src/
├── api.ts              # Axios 客户端，统一管理所有后端请求
├── types.ts            # TypeScript 类型定义
├── App.tsx             # 路由（React Router v7）
├── store/
│   ├── auth.tsx        # 登录/JWT 状态
│   └── branding.tsx    # 站点品牌配置
├── components/
│   ├── AppLayout.tsx   # 全局布局
│   ├── LivePlayer.tsx  # ArtPlayer + WebRTC WHEP 封装
│   └── ChatPanel.tsx   # WebSocket 聊天面板
└── pages/
    ├── Home.tsx
    ├── AuthCallback.tsx
    └── admin/
        ├── AdminLayout.tsx     # 后台布局
        ├── Dashboard.tsx       # 系统概览
        ├── StreamsManage.tsx   # 直播间管理（CRUD 推流密钥 / 观看 Token）
        ├── StreamDetail.tsx    # 单直播间详情 + 实时统计
        ├── UsersManage.tsx     # 用户管理（封禁/解封）
        ├── SrsClients.tsx      # SRS 客户端管理（踢人）
        ├── Sessions.tsx        # 观众会话历史 + CSV 导出
        ├── EdgeManage.tsx      # Edge 节点登记
        └── Settings.tsx        # 品牌 / 全局设置
```

### 后端模块

```
backend/app/
├── main.py                # FastAPI 入口、SRS 反代、SPA 兜底
├── config.py              # pydantic-settings 配置
├── database.py            # SQLAlchemy async engine & session
├── models.py              # ORM：User、StreamConfig、ChatMessage、
│                          #      StreamPublishSession、ViewerSession 等
├── schemas.py             # Pydantic 请求/响应
├── auth.py                # JWT + OAuth2 + 依赖注入
├── srs_client.py          # 与 SRS HTTP API 通信（httpx）
├── stats_reconciler.py    # 后台对账协程：修正遗漏的 on_stop / on_unpublish
└── routers/
    ├── auth.py       # /api/auth/*     — OAuth2 登录、JWT 签发
    ├── streams.py    # /api/streams/*  — 房间列表 / 播放 / CRUD
    ├── chat.py       # /api/chat/*     — WebSocket 聊天 + 历史
    ├── viewer.py     # /api/viewer/*   — WS 观众心跳（真实观众数来源）
    ├── hooks.py      # /api/hooks/*    — SRS http_hooks 入口
    ├── admin.py      # /api/admin/*    — 用户 / SRS 状态 / 统计
    ├── edge.py       # /api/edge/*     — Edge 节点登记
    └── branding.py   # /api/branding   — 站点品牌设置
```

## 关键流程

### 用户观看直播

```
1. GET /api/streams/
     → 后端列出 StreamConfig + 调 SRS API /api/v1/streams 合并"是否正在推"
2. POST /api/streams/play  body={stream_name, format}
     → 后端按隐私/Token 规则生成播放 URL，并把 watch_token 透传
3. 播放器按格式请求：
     FLV   → GET  /live/<stream>.flv?token=xxx
     WebRTC→ POST /rtc/v1/whep/?app=live&stream=...&token=...
4. Nginx 把 /live/ 与 /rtc/ 直接反代给 SRS；dev 环境下由 FastAPI 反代。
5. 同时前端建立 WS /api/viewer/ws/<stream>?token=xxx，用于后端真实观众统计。
```

### 推流鉴权

```
1. 主播用 RTMP/SRT/WHIP 推到 SRS：/live/<stream>?secret=<publish_secret>
2. SRS 触发 http_hooks → POST /api/hooks/on_publish?hook_secret=xxx
3. 后端校验：
     - hook_secret 匹配？
     - stream_name 在 StreamConfig 中？
     - 请求参数里的 secret == publish_secret？
   任一失败 → 返回 {"code": 403}，SRS 拒推。
4. 成功 → 写 StreamPublishSession（开播时间），标记 is_live=True。
```

### 观看鉴权（私有直播）

```
1. 观众请求 /live/<stream>.flv?token=xxx
2. SRS 触发 http_hooks → POST /api/hooks/on_play?hook_secret=yyy
3. 后端根据 StreamConfig：
     - 公开流：直接允许
     - 私有流：token == watch_token ？或者 token 是合法 JWT ？
   未通过 → {"code": 403}，SRS 立刻断开连接。
4. 通过 → 写 StreamPlaySession；观众的实时数量由 /api/viewer 的 WS 心跳
   独立计算（更精准，不会因 SRS hook 丢失而残留"幽灵观众"）。
```

### 统计对账

详见 [`stats-architecture.md`](./stats-architecture.md)。简而言之：

- 「是否正在推流」以 SRS `publish.active` 为准；
- 「当前观众数 / 观看时长 / 峰值」以后端 `ViewerSession`（WS 心跳）为准；
- `stats_reconciler` 每分钟巡检，把因进程崩溃或网络抖动遗漏的会话补齐关闭。

## 数据库模型

| 模型                    | 表名                       | 说明                                           |
| ----------------------- | -------------------------- | ---------------------------------------------- |
| `User`                  | `users`                    | 用户，OAuth2 同步；含 `is_admin`、`is_banned` |
| `StreamConfig`          | `stream_configs`           | 直播间：推流密钥、观看 Token、聊天开关等       |
| `StreamPublishSession`  | `stream_publish_sessions`  | 每次开播/下播记录（SRS hook 驱动）             |
| `StreamPlaySession`     | `stream_play_sessions`     | SRS `on_play`/`on_stop` 记录（辅助）           |
| `ViewerSession`         | `viewer_sessions`          | **主要**观众会话（WS 心跳驱动）                |
| `ChatMessage`           | `chat_messages`            | 聊天/弹幕消息                                  |
| `EdgeNode`              | `edge_nodes`               | 已登记的 Edge 节点                             |
| `AppSetting`            | `app_settings`             | 可在后台修改的品牌/配置键值对                  |

## 媒体代理

生产环境推荐：**前置 Nginx 直接把 `/live/` 反代到 `srs:8080`、`/rtc/v1/`
反代到 `srs:1985`**，FastAPI 只处理 `/api/*`、`/ws/*` 以及 SPA 静态资源。

单容器 / 开发环境下，`backend/app/main.py` 自带了 FLV 和 WHIP/WHEP 的 HTTP
反代作为兜底，确保打到 FastAPI 端口也能看直播。

## WebRTC 开关层级

全局 `WEBRTC_PLAY_ENABLED` → 每房间 `webrtc_play_enabled`。任一关闭，WHEP 即
被拒绝；WHIP（推流）不受此开关影响。详见 [`webrtc.md`](./webrtc.md)。
