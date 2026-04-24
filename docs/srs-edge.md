# SRS Edge 节点部署指南

本文介绍如何为 **SRS Live Center** 搭建 SRS Edge（边缘节点），实现多机房/多地域分发。

## 架构

```
主播 → RTMP/WebRTC 推流 → [Origin] SRS Live Center
                                    │
                                    ├── on_publish/on_play 回调 → FastAPI（鉴权 + 统计）
                                    │
                                    ▼
                             [Edge 1] SRS Edge  ← 观众A
                             [Edge 2] SRS Edge  ← 观众B
                             [Edge N] SRS Edge  ← 观众C
```

- **Origin**：唯一接收推流的节点，运行 http_hooks 进行鉴权与统计。
- **Edge**：只做分发（Pull + 回源），不接推流。

Edge 节点有两种模式：

| 模式 | 说明 | 对应 SRS 配置 |
| --- | --- | --- |
| **Remote**（推荐） | Edge 主动从 Origin 拉流缓存，观众从 Edge 播放 | `cluster { mode remote; origin <origin-host>; }` |
| **Local** | Edge 等同 Origin，仅在部署切换期间使用 | `cluster { mode local; }` |

本文仅讨论 **Remote** 模式。

---

## 一、准备工作

1. 你已经按 [`README.md`](../README.md) 正常运行了 Origin（包含 FastAPI + SRS + Nginx）。
2. 确认 Origin 节点的 **RTMP 回源端口 `1935`** 对 Edge 可达。
3. 准备一台干净的 Linux 服务器作为 Edge。

> **注意**：Edge 节点不需要运行 FastAPI、不需要数据库。
> 鉴权与统计由 Origin 通过 `http_hooks` 统一处理。
> 但为了让 Edge 也能校验 `token`（私有直播），推荐把观众请求打到 **Origin 的 Nginx**，
> 或在 Edge 启用 `http_hooks` 并指向 Origin 的 `http://<origin>/api/hooks/on_play`。

---

## 二、Edge 配置文件

将下面的 `srs.conf` 保存到 Edge 服务器 `/etc/srs/srs-edge.conf`：

```nginx
listen              1935;
max_connections     2000;
daemon              off;
srs_log_tank        console;

http_api {
    enabled on;
    listen  1985;
    crossdomain on;
}

http_server {
    enabled on;
    listen  8080;
    crossdomain on;
}

rtc_server {
    enabled on;
    # WebRTC UDP 端口，可通过环境变量 WEBRTC_UDP_PORT 配置
    listen  $WEBRTC_UDP_PORT;
    # 将此处替换为 Edge 自己的公网 IP
    candidate $CANDIDATE;
    
    # IP 协议族：ipv4, ipv6, 或 all（同时启用 IPv4 和 IPv6）
    ip_family $WEBRTC_IP_FAMILY;
    
    # 传输协议：udp, tcp, 或 all（同时支持 UDP 和 TCP）
    protocol $WEBRTC_PROTOCOL;
    
    # TCP 端口（仅当 protocol 为 tcp 或 all 时需要）
    # 可通过环境变量 WEBRTC_TCP_PORT 配置
    # tcp $WEBRTC_TCP_PORT;
}

vhost __defaultVhost__ {
    cluster {
        mode    remote;
        # 指向 Origin 的 RTMP 地址（可配置多个用于容灾）
        origin  origin.your-domain.com:1935;
    }

    http_remux {
        enabled on;
        mount   [vhost]/[app]/[stream].flv;
    }

    rtc {
        enabled on;
        rtmp_to_rtc on;
    }

    # 可选：Edge 侧也把 on_play 转给 Origin，实现观众鉴权
    http_hooks {
        enabled  on;
        on_play  http://origin.your-domain.com/api/hooks/on_play;
        on_stop  http://origin.your-domain.com/api/hooks/on_stop;
    }
}
```

### 关键字段说明

- `cluster.mode remote`：启用回源模式。
- `cluster.origin`：Origin 节点的 **RTMP** 监听地址（`ip:1935`）。
- `http_hooks.on_play`：**强烈推荐** 在 Edge 也配置，否则观众直连 Edge 时
  私有直播的 `token` 校验不会被触发。

---

## 三、Docker Compose（Edge 独立部署）

在 Edge 服务器上新建 `docker-compose.yml`：

```yaml
version: "3.8"
services:
  srs-edge:
    image: ossrs/srs:6
    container_name: srs-edge
    restart: unless-stopped
    command: ["./objs/srs", "-c", "conf/srs.conf"]
    ports:
      - "1935:1935"
      - "1985:1985"
      - "8080:8080"
      - "${WEBRTC_UDP_PORT:-8000}:${WEBRTC_UDP_PORT:-8000}/udp"
      - "${WEBRTC_TCP_PORT:-8000}:${WEBRTC_TCP_PORT:-8000}/tcp"
    volumes:
      - ./srs-edge.conf:/usr/local/srs/conf/srs.conf:ro
    environment:
      - CANDIDATE=${CANDIDATE:-}
      - WEBRTC_UDP_PORT=${WEBRTC_UDP_PORT:-8000}
      - WEBRTC_TCP_PORT=${WEBRTC_TCP_PORT:-8000}
      - WEBRTC_IP_FAMILY=${WEBRTC_IP_FAMILY:-ipv4}
      - WEBRTC_PROTOCOL=${WEBRTC_PROTOCOL:-udp}
```

然后：

```bash
export CANDIDATE=<本 Edge 公网 IP>
docker compose up -d
```

---

## 四、一键部署脚本

仓库提供 [`deploy/srs-edge-setup.sh`](../deploy/srs-edge-setup.sh) 自动：

1. 安装 Docker（如未安装）
2. 生成 `srs-edge.conf` 与 `docker-compose.yml`
3. 拉取镜像并启动

用法：

```bash
curl -fsSL https://raw.githubusercontent.com/XieXiLin2/srs-live-center/main/deploy/srs-edge-setup.sh -o srs-edge-setup.sh
chmod +x srs-edge-setup.sh

sudo ORIGIN_HOST=origin.example.com \
     ORIGIN_HTTP_BASE=https://origin.example.com \
     CANDIDATE=203.0.113.10 \
     WEBRTC_UDP_PORT=8000 \
     WEBRTC_TCP_PORT=8000 \
     WEBRTC_IP_FAMILY=ipv4 \
     WEBRTC_PROTOCOL=udp \
     ./srs-edge-setup.sh
```

参数通过环境变量传入：

| 变量 | 含义 | 默认值 |
| --- | --- | --- |
| `ORIGIN_HOST` | Origin 的 RTMP 地址，`host[:port]`，必填 | — |
| `ORIGIN_HTTP_BASE` | Origin 的 HTTP 前缀，用于 `on_play` 回调 | `http://$ORIGIN_HOST` |
| `CANDIDATE` | 本 Edge 的公网 IP（WebRTC 使用） | 自动探测 |
| `WEBRTC_UDP_PORT` | WebRTC UDP 端口 | `8000` |
| `WEBRTC_TCP_PORT` | WebRTC TCP 端口（仅当 protocol 为 tcp 或 all 时需要） | `8000` |
| `WEBRTC_IP_FAMILY` | IP 协议族：ipv4, ipv6, 或 all | `ipv4` |
| `WEBRTC_PROTOCOL` | 传输协议：udp, tcp, 或 all | `udp` |
| `EDGE_DIR` | 部署目录 | `/opt/srs-edge` |

---

## 五、前端如何让观众走 Edge

前端只需把 `PUBLIC_BASE_URL` 指向 Edge 域名（或 CDN），播放地址会自动指向 Edge：

- HTTP-FLV: `https://<edge-host>/live/<stream>.flv`
- WebRTC:   `https://<edge-host>/rtc/v1/whep/?app=live&stream=<stream>`

如需按地域分流，可在 Nginx / CDN 层做地理路由。

---

## 六、常见问题

**Q1：私有直播的 token 会在 Edge 生效吗？**

需要在 Edge 启用 `http_hooks.on_play` 并把回调指向 Origin 的 FastAPI，
否则 Edge 不会校验 `token`。

**Q2：Edge 需要配置 `http_hooks.on_publish` 吗？**

不需要，Edge 只拉流不接推流。

**Q3：观众切换到 Edge 之后，Origin 的统计不再准确？**

因为回调来源变成了 Edge。如果 Edge 把 `on_play` / `on_stop` 继续
转给 Origin 的 FastAPI，统计依然汇集在 Origin，只是 `ip` 字段是
Edge 看到的 `client_ip`（通常是真实观众的 IP）。
