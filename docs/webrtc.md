# WebRTC 开关指南

> 在某些场景下 WebRTC 播放不可用或不合适（UDP 被封、带宽不够、只想用 HLS/FLV 做
> 分发），但又希望**继续接受 WebRTC 推流（WHIP）**。本项目提供了两级开关来满足
> 这种需求：**全局开关** 与 **每直播间开关**。

---

## 概念

| 动作 | 协议 | 是否受开关影响 |
| --- | --- | --- |
| **推流** | WebRTC **WHIP**（OBS 29+ / Web 推送 SDK） | ❌ 不受影响 |
| **推流** | RTMP / SRT | ❌ 不受影响 |
| **播放** | WebRTC **WHEP**（低延迟） | ✅ 受开关控制 |
| **播放** | HTTP-FLV / HLS | ❌ 不受影响 |

> 关键：本开关**只影响 WebRTC 播放（WHEP）**，不影响推流。也就是说你可以
> 「只允许 WebRTC 推送，不允许 WebRTC 播放」。

---

## 两级生效规则

只要下面**任一**条件不满足，前端就拿不到 `webrtc` 播放选项、后端也会拒绝
`format=webrtc` 的播放请求（HTTP 403）：

1. **全局开关** `settings.webrtc_play_enabled` 为 `true`  
2. **本直播间的** `StreamConfig.webrtc_play_enabled` 为 `true`

逻辑上：`effective = global_switch AND room_switch`。

---

## 1. 全局开关（服务级）

通过环境变量配置，重启生效：

```env
# .env
WEBRTC_PLAY_ENABLED=true    # 默认为 true；设为 false 全局禁用 WebRTC 播放
```

对应后端配置字段：`Settings.webrtc_play_enabled`（位于 `backend/app/config.py`）。

**关闭后行为：**

- `GET /api/streams/` 返回的 `formats` 数组里**不会**包含 `"webrtc"`
- `POST /api/streams/play` 收到 `format=webrtc` 时返回 403：
  ```json
  { "detail": "WebRTC playback is disabled on this server" }
  ```
- 管理后台「系统设置」会显示 `webrtc_play_enabled=false`

> 对 **OBS WHIP 推流** 无影响 —— 主播照常使用 SRS 的 `/rtc/v1/whip/` 推流。

---

## 2. 每直播间开关

在管理后台「直播间管理 → 编辑直播间」里，切换 **允许 WebRTC 播放** 开关。
对应 API 字段：`StreamConfig.webrtc_play_enabled`（数据库字段）。

**行为：**

- 全局开关为 `true` 时，本开关决定该房间是否能用 WebRTC 播放
- 全局开关为 `false` 时，**本开关被忽略**（全局已强制关闭）
- 关闭本开关后：
  - 前端只会显示 FLV 作为可选格式
  - 强制请求 WebRTC 播放将返回 403：
    ```json
    { "detail": "WebRTC playback is disabled for this room" }
    ```

---

## 3. 典型场景

### 场景 A：WHIP 推流 + FLV 播放（最常见）

```env
WEBRTC_PLAY_ENABLED=false
```

- 主播：OBS 29+ 用 WHIP 推到 `https://live.example.com/rtc/v1/whip/?app=live&stream=demo`
- 观众：前端只看到 FLV 选项，走 `https://live.example.com/live/demo.flv`

### 场景 B：保留 WebRTC 低延迟播放，但个别房间想关掉

```env
WEBRTC_PLAY_ENABLED=true
```

然后到管理后台，把对应房间 **允许 WebRTC 播放** 关闭即可。

### 场景 C：完全禁用 WebRTC

同时需要在 SRS 配置里关掉 WebRTC：

```nginx
# deploy/srs/srs.conf
rtc_server {
    enabled off;
}
```

此时本开关无意义，但保持 `WEBRTC_PLAY_ENABLED=false` 可以让前端不误显示
WebRTC 选项。

---

## 4. 前后端字段参考

### 后端

| 位置 | 字段 | 类型 | 说明 |
| --- | --- | --- | --- |
| `Settings.webrtc_play_enabled` | 环境变量 `WEBRTC_PLAY_ENABLED` | `bool` | 全局开关 |
| `StreamConfig.webrtc_play_enabled` | 数据库列 | `bool` | 每直播间开关 |
| `StreamInfo.webrtc_play_enabled` | API 响应 | `bool` | 已取 AND 的有效值 |
| `StreamInfo.formats` | API 响应 | `list[str]` | 关闭后不再含 `"webrtc"` |

### 前端

- `types.ts`：`StreamInfo.webrtc_play_enabled`, `StreamConfig.webrtc_play_enabled`
- `pages/admin/StreamsManage.tsx`：表格列 + 编辑表单开关
- `pages/Home.tsx` / `LivePlayer.tsx`：已基于 `StreamInfo.formats` 决定可选项，无需额外改动

---

## 5. 开启/关闭后的验证

```bash
# 查看有效配置
curl http://localhost:8000/api/admin/settings -H "Authorization: Bearer $JWT"
# -> {"webrtc_play_enabled":"false", ...}

# 验证 play 接口是否拒绝 WebRTC
curl -X POST http://localhost:8000/api/streams/play \
  -H 'Content-Type: application/json' \
  -d '{"stream_name":"demo","format":"webrtc"}'
# -> 403 {"detail":"WebRTC playback is disabled on this server"}

# FLV 播放依然正常
curl -X POST http://localhost:8000/api/streams/play \
  -H 'Content-Type: application/json' \
  -d '{"stream_name":"demo","format":"flv"}'
# -> 200 {"url":"/live/demo.flv",...}
```

---

## 6. 数据库迁移

项目未引入 Alembic，`app/database.py` 的 `_apply_additive_migrations()` 会在启动时
自动为旧 SQLite 库添加 `stream_configs.webrtc_play_enabled` 列（默认 `1`），无需
手动操作。Postgres / MySQL 也会 attempt 同样的 `ALTER TABLE`，失败则打 WARN，可用
任一迁移工具手动添加：

```sql
ALTER TABLE stream_configs
  ADD COLUMN webrtc_play_enabled BOOLEAN NOT NULL DEFAULT TRUE;
```
