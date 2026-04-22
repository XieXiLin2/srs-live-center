# API 文档

> SRS Live Center 后端 API 参考。所有接口前缀为 `/api`。
>
> 权威来源是 `backend/app/routers/*.py`。启动时设 `DEBUG=true` 可打开交互式
> Swagger：`http://<host>:8000/api/docs`。

## 认证方式

登录后得到 JWT，后续请求带 `Authorization: Bearer <token>`：

```
Authorization: Bearer eyJhbGciOi...
```

---

## 公共

### 健康检查

```
GET /api/health
```

**响应**：

```json
{
  "status": "ok",
  "app": "SRS Live Center"
}
```

### 站点品牌

```
GET /api/branding
```

返回 Logo / 站点名 / 版权文案等，用于前端首屏渲染。

---

## 认证 API (`/api/auth`)

### 获取登录 URL

```
GET /api/auth/login
```

**响应**：

```json
{
  "authorize_url": "https://auth.example.com/application/o/authorize/?response_type=code&client_id=xxx&..."
}
```

### OAuth2 回调

```
POST /api/auth/callback
```

**请求体**：

```json
{ "code": "authorization_code_from_oauth", "state": "csrf_state_token" }
```

**响应**：

```json
{
  "access_token": "jwt_token_string",
  "token_type": "bearer",
  "user": {
    "id": 1,
    "username": "user1",
    "display_name": "用户一",
    "email": "user@example.com",
    "avatar_url": "https://...",
    "is_admin": false,
    "is_banned": false,
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

### 获取当前用户

```
GET /api/auth/me
```

🔒 需要认证。返回同上 `user` 对象。

### 获取登出 URL

```
GET /api/auth/logout
```

**响应**：

```json
{ "logout_url": "https://auth.example.com/application/o/end-session/" }
```

---

## 直播流 API (`/api/streams`)

### 直播间列表（含在线状态）

```
GET /api/streams/
```

**响应**：

```json
{
  "streams": [
    {
      "name": "livestream",
      "display_name": "我的直播",
      "app": "live",
      "video_codec": "H264",
      "audio_codec": "AAC",
      "clients": 5,
      "is_private": false,
      "chat_enabled": true,
      "webrtc_play_enabled": true,
      "is_live": true,
      "formats": ["flv", "webrtc"]
    }
  ]
}
```

> `clients` 是后端自己维护的真实观众数（基于 `/api/viewer` WS 心跳），不是
> 直接取自 SRS。`is_live` 以 SRS `publish.active` 为准。

### 获取播放 URL

```
POST /api/streams/play
```

**请求体**：

```json
{ "stream_name": "livestream", "format": "flv", "token": "watch_token_if_private" }
```

- `format`：`flv` 或 `webrtc`（WHEP）
- `token`：私有房间必填，可以是 `watch_token`，也可以在已登录场景下省略

**响应**：

```json
{ "url": "/live/livestream.flv?token=...", "stream_name": "livestream", "format": "flv" }
```

**错误**：

- `400`：不支持的 `format`
- `401`：私有房且未登录、未带有效 token
- `403`：WebRTC 被禁用（全局或该房间）

### 单直播间统计

```
GET /api/streams/{stream_name}/stats
```

返回当前观众数、累计观众、总观看时长、峰值观众、当前开播时长等（后端自有数据）。

### 聊天室配置

```
GET /api/streams/{stream_name}/chat-config
```

**响应**：

```json
{ "stream_name": "livestream", "chat_enabled": true, "require_login_to_send": true }
```

### 管理：直播间 CRUD

以下需要管理员权限 🔒：

| 方法     | 路径                                                          | 说明                       |
| -------- | ------------------------------------------------------------- | -------------------------- |
| `GET`    | `/api/streams/config`                                         | 所有直播间配置             |
| `GET`    | `/api/streams/config/{stream_name}`                           | 单个直播间配置             |
| `POST`   | `/api/streams/config/{stream_name}`                           | 创建直播间                 |
| `PUT`    | `/api/streams/config/{stream_name}`                           | 更新直播间（部分字段即可） |
| `DELETE` | `/api/streams/config/{stream_name}`                           | 删除直播间                 |
| `POST`   | `/api/streams/config/{stream_name}/rotate-publish-secret`     | 重置推流密钥               |
| `POST`   | `/api/streams/config/{stream_name}/rotate-watch-token`        | 重置观看 Token             |

创建 / 更新请求体示例：

```json
{
  "display_name": "我的直播",
  "is_private": true,
  "publish_secret": "可选，留空自动生成",
  "watch_token": "可选，留空自动生成",
  "chat_enabled": true,
  "webrtc_play_enabled": true
}
```

返回的 `StreamConfigResponse` 额外包含 **展示用** 的推流地址：
`publish_rtmp_url`、`publish_srt_url`、`publish_whip_url`（根据
`PUBLISH_BASE_URL` / `PUBLIC_BASE_URL` 构造）。

---

## 聊天 / 弹幕 API (`/api/chat`)

### WebSocket 聊天

```
WS  /api/chat/ws/{stream_name}?token=<jwt>
```

- `token`：JWT；未登录时可以省略（仅能接收）。
- **被封禁用户** 无法发送消息。
- 消息长度上限 500 字符，空消息会被忽略。

**服务端 → 客户端**（消息）：

```json
{
  "type": "message",
  "id": 1,
  "user_id": 1,
  "username": "user1",
  "display_name": "用户一",
  "avatar_url": "https://...",
  "content": "Hello!",
  "created_at": "2026-01-01T00:00:00Z",
  "is_admin": false
}
```

系统消息：

```json
{ "type": "system", "content": "用户一 joined", "online_count": 5 }
```

错误：

```json
{ "type": "error", "content": "Authentication required to send messages" }
```

**客户端 → 服务端**：

```json
{ "content": "Hello World!" }
```

### 历史消息

```
GET /api/chat/{stream_name}/messages?limit=50&offset=0
```

### 在线人数

```
GET /api/chat/{stream_name}/online
```

---

## 观众会话 API (`/api/viewer`)

真实观众数 / 观看时长的主数据源。

### WebSocket 观众心跳

```
WS  /api/viewer/ws/{stream_name}?token=<jwt_or_watch_token>
```

- 每个观众页面建立一条 WS，断开即视为离开。
- 服务端以此维护 `ViewerSession` 表，用于 **实时观众数、峰值、总观看时长** 等
  统计。

---

## SRS Hooks (`/api/hooks`)

这些接口供 **SRS 6** 回调使用，不是给前端/第三方调用的：

| 方法   | 路径                      | 触发                                        |
| ------ | ------------------------- | ------------------------------------------- |
| `POST` | `/api/hooks/on_publish`   | 推流开始；校验 `publish_secret`             |
| `POST` | `/api/hooks/on_unpublish` | 推流结束；关闭 `StreamPublishSession`       |
| `POST` | `/api/hooks/on_play`      | 观众开始播放；私有流时校验 `watch_token`   |
| `POST` | `/api/hooks/on_stop`      | 观众停止播放                                |
| `POST` | `/api/hooks/on_connect`   | 客户端连接，默认放行                        |
| `POST` | `/api/hooks/on_close`     | 客户端断开                                  |
| `GET`  | `/api/hooks/ping`         | 调试用的简单健康探测                        |

所有 hook URL 都支持通过 query 传 `hook_secret` 做共享密钥校验。

**SRS 约定**：`HTTP 200` + `{"code": 0}` → 允许；`code` 非 0 → 拒绝。

---

## 管理 API (`/api/admin`)

所有管理接口需要管理员权限 🔒。

### 用户管理

| 方法     | 路径                                | 说明                                         |
| -------- | ----------------------------------- | -------------------------------------------- |
| `GET`    | `/api/admin/users`                  | 用户列表（`?limit=50&offset=0&search=`）     |
| `PUT`    | `/api/admin/users/{id}/ban`         | 封禁/解封：`{"is_banned": true}`             |
| `DELETE` | `/api/admin/chat/messages/{id}`     | 删除某条聊天消息                             |

### SRS 系统 / 客户端

| 方法     | 路径                                  | 说明                       |
| -------- | ------------------------------------- | -------------------------- |
| `GET`    | `/api/admin/srs/summary`              | SRS 系统摘要（/api/v1/summaries）|
| `GET`    | `/api/admin/srs/versions`             | SRS 版本信息               |
| `GET`    | `/api/admin/srs/streams`              | SRS 当前流列表             |
| `GET`    | `/api/admin/srs/clients`              | SRS 当前客户端列表         |
| `DELETE` | `/api/admin/srs/clients/{client_id}`  | 踢出某个客户端             |

### 统计（后端数据）

| 方法  | 路径                                        | 说明                                    |
| ----- | ------------------------------------------- | --------------------------------------- |
| `GET` | `/api/admin/stats/play-sessions`            | SRS hook 记录的播放会话                 |
| `GET` | `/api/admin/stats/publish-sessions`         | SRS hook 记录的推流会话                 |
| `GET` | `/api/admin/stats/viewer-sessions`          | **WS 驱动**的观众会话（主数据源）       |
| `GET` | `/api/admin/stats/viewer-sessions.csv`      | 观众会话 CSV 导出（支持过滤，流式返回） |
| `GET` | `/api/admin/stats/viewer-sessions/summary`  | 聚合：总场次/总观看时长/独立登录观众等  |

查询参数（统一）：

- `stream_name`：按直播间过滤
- `user_id`：按用户过滤
- `started_after` / `started_before`：ISO8601 或 `YYYY-MM-DD`，UTC
- `only_ended`：仅返回已结束会话

### 设置

| 方法  | 路径                       | 说明                                |
| ----- | -------------------------- | ----------------------------------- |
| `GET` | `/api/admin/settings`      | 返回当前 SRS/OAuth 相关运行配置     |

品牌化读写通过 `/api/branding`（读）和 `PUT /api/admin/settings/branding`
（写），后者需要管理员权限。

### Edge 节点

| 方法     | 路径                            | 说明                |
| -------- | ------------------------------- | ------------------- |
| `GET`    | `/api/edge/nodes`               | Edge 节点列表（公开） |
| `POST`   | `/api/admin/edge/nodes`         | 登记 Edge 节点      |
| `PUT`    | `/api/admin/edge/nodes/{id}`    | 更新 Edge 节点      |
| `DELETE` | `/api/admin/edge/nodes/{id}`    | 删除 Edge 节点      |

---

## 媒体反向代理（FastAPI 内置）

仅在单容器 / 开发模式下需要；生产建议由前置 Nginx 直接分发。

| 路径模式                     | 后端行为                                          |
| ---------------------------- | ------------------------------------------------- |
| `GET  /{app}/{stream}.flv`   | 流式反代到 `SRS_HTTP_URL`（HTTP-FLV）             |
| `*    /rtc/v1/{...}`         | 反代到 `SRS_API_URL` 的 WHIP / WHEP 信令端点     |
| 其他路径                     | 非文件名匹配时降级为 SPA 路由，返回 `index.html` |

> HLS 文件（`.m3u8` / `.ts`）**不** 经 FastAPI 反代，必须由 Nginx 或直接
> 暴露 SRS `:8080`。
