# 播放 & 直播统计架构

> **设计原则**
>
> * **推流（publish）侧** 的"是否在播 / 编码 / 推流时长"——继续由 **SRS** 通过
>   `on_publish` / `on_unpublish` hook 反馈。这是只有媒体服务器才能权威知晓的
>   信息。
> * **播放（play）侧** 的"当前观众 / 累计观看次数 / 总时长 / 峰值"——由 **后端
>   完全自行维护**，**不再依赖** SRS 的 `on_play` / `on_stop`。前后端通过
>   **WebSocket** 直连建立观众会话生命周期。
>
> 这样可以同时获得：
> * 推流统计的真实性（SRS 直接告诉你有没有人在推）
> * 播放统计的可控性（不会因为 SRS 重启 / 回调字段变化 / 中间链路丢包而漂移）

---

## 1. 责任划分（Who owns what）

| 数据 | 负责方 | 来源 |
| --- | --- | --- |
| **是否正在推流 (`is_live`)** | **SRS** | `srs_client.list_streams()` |
| **视频 / 音频编码 (`video_codec`, `audio_codec`)** | **SRS** | 同上 |
| **当前推流时长 (`current_live_duration_seconds`)** | 后端 (DB) | `now - StreamPublishSession.started_at` |
| **累计推流时长 (`total_live_seconds`)** | 后端 (DB) | `SUM(StreamPublishSession.duration_seconds)` + 当前 |
| **当前观众数 (`current_viewers`)** | **后端 (WS)** | `ViewerSession` 中 `ended_at IS NULL` 的行数 |
| **累计观看次数 (`total_plays`)** | **后端 (WS)** | `ViewerSession` 全量行数 |
| **总观看时长 (`total_watch_seconds`)** | **后端 (WS)** | `SUM(ViewerSession.duration_seconds)` + 在线会话外推 |
| **独立登录观众 (`unique_logged_in_viewers`)** | **后端 (WS)** | `COUNT(DISTINCT user_id)` |
| **峰值并发观众 (`peak_session_viewers`)** | **后端 (WS, 内存)** | 当前直播区间内 WS 并发的最大值 |

> 注：旧的 `StreamPlaySession` 表（由 SRS hook 写入）与 `on_play`/`on_stop`
> hook **保持原样不动**，但**不再用于任何对外的播放统计聚合**。它仍然存在以便
> 兼容历史数据 / 风控查询。

---

## 2. 数据流

```
 ┌────────────┐    on_publish / on_unpublish     ┌─────────────────────────┐
 │  推流端     │ ────────────────────────────▶  │ POST /api/hooks/…       │
 │ (OBS/WHIP) │                                  │  → 写 StreamPublish-    │
 └────────────┘                                  │    Session + 更新       │
                                                  │    StreamConfig         │
                                                  └─────────────────────────┘

 ┌────────────┐                                  ┌─────────────────────────┐
 │  观众端     │      WS /api/viewer/ws/{name}    │ routers/viewer.py       │
 │ (浏览器)    │ ◀────────────────────────────▶ │  · accept → INSERT       │
 │            │   ping(15s) / pong               │    ViewerSession         │
 │            │   ←   {type:"stats", ...} ←─────│  · 每次 ping 更新心跳    │
 │            │   onclose → 关闭 session         │  · broadcast 给同房间   │
 └────────────┘                                  └─────────────────────────┘

 ┌─────────────────────────────────────────────┐
 │ stats_reconciler                            │
 │   _publish_play_loop      每 30s           │ ─→ 与 SRS 对账推流/旧 play
 │   _viewer_sweep_loop      每 10s           │ ─→ 关闭 last_heartbeat
 │                                              │     超过 40s 的 ViewerSession
 └─────────────────────────────────────────────┘

 ┌─────────────────────────────┐
 │ 前端                         │
 │ · GET /api/streams/         │ 每 15s 轮询（房间列表）
 │ · WS  /api/viewer/ws/{name} │ 进入房间时建立；不再轮询 /stats
 │ · 服务器主动推送 stats       │
 └─────────────────────────────┘
```

---

## 3. 为什么播放侧选 WebSocket（而不再用 hook + 轮询）

| 维度 | 旧方案（SRS hook + 10s 轮询） | 新方案（后端 WS 心跳） |
| --- | --- | --- |
| 数据来源 | `on_play`/`on_stop` 必须可达且不丢 | 后端自己看见的连接，**不依赖 SRS** |
| 一致性恢复时间 | 轮询 + 30s 对账周期 | 心跳超时 40s（且事件即时广播） |
| 实时反馈 | 客户端 10s 一次 GET | 服务端事件触发立即推送 |
| 跨网关/反代干扰 | hook 路径必须暴露给 SRS | 仅一个 WS，跟着前端走，更稳 |
| 客户端"掉电"误差 | hook 不发就一直挂着 | 心跳 40s 自动清扫 |
| 实现成本 | 中（reconciler 兜底） | 中（只多一个 router + 一个 sweeper） |

聊天、播放统计两条 WS 通道相互独立，互不影响。

---

## 4. 核心代码位置

| 文件 | 作用 |
| --- | --- |
| `backend/app/models.py` :: `ViewerSession` | 后端独占的观看会话表 |
| `backend/app/routers/viewer.py` | **新增**：WS 端点 + `ViewerConnectionManager` + 心跳 + stats 计算 + 广播 |
| `backend/app/stats_reconciler.py` :: `_viewer_sweep_loop` | 每 10s 扫描 `last_heartbeat_at < now-40s` 的会话，关闭并广播新 stats |
| `backend/app/stats_reconciler.py` :: `_publish_play_loop` | 30s 一轮，沿用旧逻辑维护 SRS 推流真相和旧 `StreamPlaySession` 兼容关闭 |
| `backend/app/routers/streams.py` :: `list_streams` | `clients` 字段改为聚合 `ViewerSession`（开放连接数） |
| `backend/app/routers/streams.py` :: `get_stream_stats` | 播放侧字段全部改为基于 `ViewerSession`；推流侧仍来自 `StreamPublishSession` + SRS `is_live` |
| `backend/app/routers/hooks.py` | **保持不动**：仍接收 SRS 的全部 4 个回调 |
| `frontend/src/pages/Home.tsx` | 进入房间建立 `/api/viewer/ws/{name}`，15s 一次 ping；移除原 `/stats` 轮询 |

---

## 5. WebSocket 协议

### 5.1 鉴权

WS URL：`/api/viewer/ws/{stream_name}?token=<可选>`

| 房间类型 | `token` | 行为 |
| --- | --- | --- |
| 公开 | 无 | 允许匿名 |
| 公开 | JWT | 解析出 `user_id` 一并入库 |
| 私有 | JWT | 必须有效（与该用户身份对应） |
| 私有 | watch_token | 必须等于 `StreamConfig.watch_token` |
| 私有 | 都没有 | `close(code=4401)` |

### 5.2 服务端 → 客户端

```jsonc
// 连接成功后立即下发
{ "type": "hello", "session_key": "...", "heartbeat_interval_seconds": 15 }

// 心跳响应
{ "type": "pong" }

// stats 快照（每当房间有人进出 / 心跳超时 / 推流变化时主动推送）
{
  "type": "stats",
  "stream_name": "demo",
  "display_name": "Demo Room",
  "is_live": true,
  "current_viewers": 12,
  "total_plays": 3481,
  "total_watch_seconds": 1289400,
  "unique_logged_in_viewers": 420,
  "peak_session_viewers": 37,
  "current_live_duration_seconds": 1234,
  "total_live_seconds": 56789,
  "last_publish_at": "2026-04-21T05:10:22+00:00",
  "last_unpublish_at": "2026-04-20T19:55:10+00:00",
  "current_session_started_at": "2026-04-21T05:10:22+00:00"
}
```

### 5.3 客户端 → 服务端

```jsonc
// 每 15 秒一次（前端定时器）
{ "type": "ping" }
```

任何文本消息都会被当作心跳，更新 `last_heartbeat_at`。

### 5.4 心跳与超时

| 项 | 值 |
| --- | --- |
| 前端 ping 间隔 | **15 秒** |
| 后端心跳超时 | **40 秒**（约 = 2× 间隔 + 容忍） |
| Sweeper 扫描频率 | **10 秒** |
| 自动重连 | 前端 `onclose` 后 3 秒后重新连接 |

---

## 6. 一致性保证

| 故障场景 | 行为 |
| --- | --- |
| 浏览器突然崩溃 | TCP 终结 → 后端 `WebSocketDisconnect` → 立即关闭 session 并广播 |
| 用户拔网线 | TCP 半开 → 心跳超过 40s 未达 → sweeper 关闭 + 广播 |
| 后端进程重启 | 重启后所有 `ended_at IS NULL` 的行将在第一轮 sweeper 中由"心跳过期"被批量关闭 |
| SRS 重启 | 不影响播放统计（与 SRS 完全解耦）；推流侧靠 `_publish_play_loop` 与 SRS 对账恢复 |
| 反向代理超时主动切断 WS | 前端 `onclose` 触发 3 秒后重连，新建 ViewerSession 行 |

---

## 7. 前端接口示例

### 列表（仍是 REST）

```json
GET /api/streams/
{
  "streams": [
    {
      "name": "demo",
      "display_name": "Demo Room",
      "clients": 12,         // ← 来自 ViewerSession 开放计数
      "is_live": true,       // ← 来自 SRS
      "video_codec": "H264", // ← 来自 SRS
      "formats": ["flv", "webrtc"]
    }
  ]
}
```

### 单流聚合（REST 仍可用，但前端在房间内已改为 WS 推送）

```json
GET /api/streams/demo/stats
{
  "stream_name": "demo",
  "display_name": "Demo Room",
  "is_live": true,
  "current_viewers": 12,
  "total_plays": 3481,
  "total_watch_seconds": 1289400,
  "unique_logged_in_viewers": 420,
  "peak_session_viewers": 37,
  "current_live_duration_seconds": 1234,
  "total_live_seconds": 56789,
  "last_publish_at": "2026-04-21T05:10:22+00:00",
  "last_unpublish_at": "2026-04-20T19:55:10+00:00",
  "current_session_started_at": "2026-04-21T05:10:22+00:00"
}
```

REST 与 WS 推送的字段完全一致（前者是同步快照，后者是事件驱动推送）。

---

## 8. 历史保留与导出

* `viewer_sessions` 表**永不自动清理**。只有会话结束时写入 `ended_at`、
  `duration_seconds`；其它字段（IP / UA / user_id / stream_name / 起止时间）
  全部保留供后期离线分析。
* 管理员接口：

  | 接口 | 说明 |
  | --- | --- |
  | `GET /api/admin/stats/viewer-sessions` | 分页查询，支持 `stream_name / user_id / started_after / started_before / only_ended` 过滤 |
  | `GET /api/admin/stats/viewer-sessions/summary` | 聚合：总会话数、总时长、独立登录用户数、按流分桶 |
  | `GET /api/admin/stats/viewer-sessions.csv` | 流式 CSV 导出（相同的过滤参数；UTF-8 BOM，Excel 可直接打开） |

* 管理端页面：`/admin/sessions` → 新增"观众会话（WS）"标签页；
  支持按流名 / 用户 ID / 时间范围 / 仅已结束筛选，并附"导出 CSV"按钮
  （前端用带 Bearer 的 `fetch`+`Blob`，支持大导出）。

---

## 9. 可扩展方向

所有指标都基于 `viewer_sessions` 一张表：

* 每日 / 每周 DAU：`COUNT(DISTINCT user_id) GROUP BY date(started_at)`
* 观看漏斗：按 `duration_seconds` 分桶
* 地理分布：`client_ip` → GeoIP（已收集）
* 用户总观看时长排行：`SUM(duration_seconds) GROUP BY user_id`

这些指标完全不需要再向 SRS 查询，也不会因 SRS 自身行为变化而抖动。
