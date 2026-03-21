# API 文档

> Oryx Live Center 后端 API 参考文档。所有 API 前缀为 `/api`。

## 认证方式

API 使用 JWT Bearer Token 认证。登录后获取 Token，在请求头中携带：

```
Authorization: Bearer <token>
```

---

## 公共 API

### 健康检查

```
GET /api/health
```

**响应**:
```json
{
  "status": "ok",
  "app": "Oryx Live Center"
}
```

---

## 认证 API (`/api/auth`)

### 获取登录 URL

```
GET /api/auth/login
```

返回 OAuth2 授权 URL，前端跳转到该 URL 进行登录。

**响应**:
```json
{
  "authorize_url": "https://auth.example.com/application/o/authorize/?response_type=code&client_id=xxx&..."
}
```

### OAuth2 回调

```
POST /api/auth/callback
```

**请求体**:
```json
{
  "code": "authorization_code_from_oauth",
  "state": "csrf_state_token"
}
```

**响应**:
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
    "created_at": "2026-01-01T00:00:00Z"
  }
}
```

### 获取当前用户

```
GET /api/auth/me
```

🔒 **需要认证**

**响应**: 同上 `user` 对象。

### 获取登出 URL

```
GET /api/auth/logout
```

**响应**:
```json
{
  "logout_url": "https://auth.example.com/application/o/end-session/"
}
```

---

## 直播流 API (`/api/streams`)

### 获取在线直播列表

```
GET /api/streams/
```

**响应**:
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
      "is_encrypted": false,
      "require_auth": false,
      "formats": ["flv", "hls", "webrtc"]
    }
  ]
}
```

### 获取播放地址

```
POST /api/streams/play
```

**请求体**:
```json
{
  "stream_name": "livestream",
  "format": "flv",
  "key": "encryption_key_if_needed"
}
```

**响应**:
```json
{
  "url": "/live/livestream.flv",
  "stream_name": "livestream",
  "format": "flv"
}
```

**错误情况**:
- `401`: 流要求认证但未登录
- `403`: 加密密钥错误

### 获取流配置列表

```
GET /api/streams/config
```

🔒 **需要管理员**

### 更新流配置

```
PUT /api/streams/config/{stream_name}
```

🔒 **需要管理员**

**请求体**:
```json
{
  "display_name": "我的直播",
  "is_encrypted": true,
  "encryption_key": "secret123",
  "require_auth": false
}
```

### 删除流配置

```
DELETE /api/streams/config/{stream_name}
```

🔒 **需要管理员**

---

## 聊天/弹幕 API (`/api/chat`)

### WebSocket 连接

```
WS /api/chat/ws/{stream_name}?token=jwt_token
```

**连接参数**:
- `stream_name`: 直播流名称
- `token` (可选): JWT Token，不提供则为匿名

**接收消息格式**:
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

**系统消息**:
```json
{
  "type": "system",
  "content": "用户一 joined",
  "online_count": 5
}
```

**错误消息**:
```json
{
  "type": "error",
  "content": "Authentication required to send messages"
}
```

**发送消息**:
```json
{
  "content": "Hello World!"
}
```

> 消息限制：最大 500 字符，空消息会被忽略。
> 被封禁用户无法发送消息。

### 获取聊天记录

```
GET /api/chat/history/{stream_name}?limit=50&offset=0
```

**响应**:
```json
{
  "messages": [...],
  "total": 100
}
```

### 获取在线人数

```
GET /api/chat/online/{stream_name}
```

**响应**:
```json
{
  "online_count": 5
}
```

---

## 管理 API (`/api/admin`)

> 所有管理 API 需要管理员权限 🔒

### 用户管理

| 方法     | 路径                           | 说明                            |
| -------- | ------------------------------ | ------------------------------- |
| `GET`    | `/api/admin/users`             | 用户列表 (`?limit=50&offset=0&search=`) |
| `PUT`    | `/api/admin/users/{id}/ban`    | 封禁/解封用户 (`{"is_banned": true}`) |
| `DELETE` | `/api/admin/chat/messages/{id}`| 删除聊天消息                    |

### Oryx 系统

| 方法   | 路径                          | 说明                |
| ------ | ----------------------------- | ------------------- |
| `GET`  | `/api/admin/oryx/system`      | SRS 系统摘要        |
| `GET`  | `/api/admin/oryx/versions`    | Oryx/SRS 版本信息   |
| `GET`  | `/api/admin/oryx/status`      | 平台运行状态        |
| `GET`  | `/api/admin/oryx/check`       | 健康检查            |

### Oryx 客户端

| 方法     | 路径                               | 说明                |
| -------- | ---------------------------------- | ------------------- |
| `GET`    | `/api/admin/oryx/clients`          | 获取所有客户端      |
| `DELETE` | `/api/admin/oryx/clients/{id}`     | 踢出客户端          |

### Oryx 直播流

| 方法   | 路径                                | 说明                |
| ------ | ----------------------------------- | ------------------- |
| `GET`  | `/api/admin/oryx/streams`           | 所有流（SRS API）   |
| `POST` | `/api/admin/oryx/streams/query`     | 活跃流查询          |
| `POST` | `/api/admin/oryx/streams/kickoff`   | 踢出直播流          |

### Oryx 推流密钥

| 方法   | 路径                      | 说明                |
| ------ | ------------------------- | ------------------- |
| `GET`  | `/api/admin/oryx/secret`  | 查询推流密钥        |
| `POST` | `/api/admin/oryx/secret`  | 更新推流密钥        |

### Oryx 录制 (DVR)

| 方法   | 路径                          | 说明                |
| ------ | ----------------------------- | ------------------- |
| `GET`  | `/api/admin/oryx/dvr`         | 录制配置查询        |
| `POST` | `/api/admin/oryx/dvr`         | 更新录制配置        |
| `GET`  | `/api/admin/oryx/dvr/files`   | 已录制文件列表      |

### Oryx HLS

| 方法   | 路径                         | 说明                |
| ------ | ---------------------------- | ------------------- |
| `GET`  | `/api/admin/oryx/hls`        | HLS 配置查询        |
| `POST` | `/api/admin/oryx/hls`        | 更新 HLS 配置       |
| `GET`  | `/api/admin/oryx/hls/ll`     | HLS 低延迟配置      |
| `POST` | `/api/admin/oryx/hls/ll`     | 更新低延迟配置      |

### Oryx 转推/转发

| 方法   | 路径                          | 说明                |
| ------ | ----------------------------- | ------------------- |
| `GET`  | `/api/admin/oryx/forward`     | 转推配置查询        |
| `POST` | `/api/admin/oryx/forward`     | 创建/更新转推       |

### Oryx 转码

| 方法   | 路径                             | 说明                |
| ------ | -------------------------------- | ------------------- |
| `GET`  | `/api/admin/oryx/transcode`      | 转码配置查询        |
| `POST` | `/api/admin/oryx/transcode`      | 应用转码配置        |
| `GET`  | `/api/admin/oryx/transcode/task` | 转码任务状态        |

### Oryx 虚拟直播 & 摄像头

| 方法   | 路径                        | 说明                |
| ------ | --------------------------- | ------------------- |
| `GET`  | `/api/admin/oryx/vlive`     | 虚拟直播列表        |
| `POST` | `/api/admin/oryx/vlive`     | 更新虚拟直播        |
| `GET`  | `/api/admin/oryx/camera`    | IP 摄像头列表       |
| `POST` | `/api/admin/oryx/camera`    | 更新摄像头配置      |

### Oryx HTTP 回调 & 系统

| 方法   | 路径                         | 说明                |
| ------ | ---------------------------- | ------------------- |
| `GET`  | `/api/admin/oryx/hooks`      | HTTP 回调配置       |
| `POST` | `/api/admin/oryx/hooks`      | 更新回调配置        |
| `GET`  | `/api/admin/oryx/limits`     | 系统限制            |
| `POST` | `/api/admin/oryx/limits`     | 更新系统限制        |
| `GET`  | `/api/admin/oryx/cert`       | SSL 证书状态        |

### Oryx 直播间 & VHost

| 方法   | 路径                             | 说明                |
| ------ | -------------------------------- | ------------------- |
| `GET`  | `/api/admin/oryx/rooms`          | 直播间列表          |
| `POST` | `/api/admin/oryx/rooms/create`   | 创建直播间          |
| `POST` | `/api/admin/oryx/rooms/update`   | 更新直播间          |
| `POST` | `/api/admin/oryx/rooms/remove`   | 删除直播间          |
| `GET`  | `/api/admin/oryx/vhosts`         | VHost 列表          |

### 应用设置 & CDN

| 方法  | 路径                       | 说明                |
| ----- | -------------------------- | ------------------- |
| `GET` | `/api/admin/settings`      | 应用设置（非敏感）  |
| `GET` | `/api/admin/cdn/config`    | CDN 配置            |

---

## 媒体流代理

以下路径由后端反向代理到 Oryx：

| 路径模式                            | 示例                       | 说明                 |
| ----------------------------------- | -------------------------- | -------------------- |
| `/{app}/{stream}.flv`               | `/live/test.flv`           | FLV 直播流（流式）   |
| `/{app}/{stream}.m3u8`              | `/live/test.m3u8`          | HLS 播放列表         |
| `/{app}/{stream}.ts`                | `/live/test-0.ts`          | HLS TS 片段          |
| `/{app}/{stream}.aac`               | `/live/test.aac`           | AAC 音频流           |
| `/{app}/{stream}.mp3`               | `/live/test.mp3`           | MP3 音频流           |

> 不匹配上述模式的路径会降级到 SPA 路由 (`index.html`)。
