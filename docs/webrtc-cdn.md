# WebRTC 在 CDN 环境下的配置指南

> 本文档说明如何在使用 CDN 的情况下正确配置 WebRTC WHIP 推流和 WHEP 播放。

---

## 核心原则

**WebRTC 推流（WHIP）必须直连源站，不能经过 CDN。**  
**WebRTC 播放（WHEP）可以走主站 CDN（如果 CDN 支持 HTTPS 且不干扰 WebRTC 信令）。**

原因：
- WebRTC 使用 UDP 协议传输媒体数据，CDN 通常只支持 HTTP/HTTPS
- WHIP 推流信令需要与 SRS 服务器直接建立连接
- ICE 候选交换需要客户端与 SRS 之间的直接网络可达性
- WHEP 播放信令可以通过 HTTPS 代理，但最终媒体传输仍需 UDP 直连

---

## 推荐架构

```
┌─────────────┐
│   主播端    │
└──────┬──────┘
       │
       │ WHIP 推流 (HTTPS)
       │ 必须直连源站
       │
       ▼
  ┌────────────────┐
  │  推流站        │
  │  live-push     │
  │  (源站直连)    │
  └────────┬───────┘
           │
           │ 内部转发
           │
           ▼
      ┌────────┐
      │  SRS   │
      └────┬───┘
           │
           │ 内部转发
           │
      ┌────┴────────────┐
      │                 │
      ▼                 ▼
  ┌────────┐      ┌──────────┐
  │  主站  │      │  Edge    │
  │  live  │      │  node1   │
  │ (CDN)  │      │ (直连)   │
  └───┬────┘      └────┬─────┘
      │                │
      │ WHEP 播放      │ WHEP 播放
      │ (HTTPS)        │ (HTTPS)
      │                │
 ┌────┴────┐      ┌────┴────┐
 │ 观众端  │      │ 观众端  │
 │ (CDN)   │      │ (直连)  │
 └─────────┘      └─────────┘
```

---

## 配置步骤

### 1. 域名规划

| 域名类型 | 示例 | 用途 | 是否走 CDN | 是否需要 HTTPS |
| --- | --- | --- | --- | --- |
| **主站** | `live.example.com` | 前端页面、WHEP 播放、HTTP-FLV | ✅ 是 | ✅ 必须 |
| **推流站** | `live-push.example.com` | WHIP 推流、RTMP/SRT 推流 | ❌ 否 | ✅ 必须 |
| **Edge 节点** | `node1.live.example.com` | WHEP 播放（备用/就近） | ❌ 否 | ✅ 推荐 |

**重要说明：**
- 所有 WebRTC 相关的域名都必须配置 HTTPS，因为浏览器要求 WebRTC 必须在安全上下文中运行
- 推流站不走 CDN，确保 WHIP 推流直连源站
- Edge 节点建议配置 HTTPS，提供更好的安全性和兼容性

### 2. 环境变量配置

```env
# .env

# 主站域名 - 用于前端页面和 WHEP 播放
PUBLIC_BASE_URL=https://live.example.com

# 推流域名 - 用于 WHIP/RTMP/SRT 推流（必须直连源站，不走 CDN）
PUBLISH_BASE_URL=https://live-push.example.com

# SRS 内部地址 - 后端内部转发使用（容器间通信）
SRS_HTTP_URL=http://srs:8080
SRS_API_URL=http://srs:1985

# RTMP/SRT 端口（推流站暴露）
PUBLISH_RTMP_PORT=1935
PUBLISH_SRT_PORT=10080

# WebRTC 配置
WEBRTC_PLAY_ENABLED=true
WEBRTC_UDP_PORT=8000
WEBRTC_TCP_PORT=0
WEBRTC_IP_FAMILY=ipv4
WEBRTC_PROTOCOL=udp
CANDIDATE=<SRS 服务器公网 IP>
```

**配置说明：**
- `PUBLIC_BASE_URL`：主站地址，用于生成 WHEP 播放 URL 和 HTTP-FLV URL
- `PUBLISH_BASE_URL`：推流站地址，用于生成 WHIP/RTMP/SRT 推流 URL
- `SRS_HTTP_URL` 和 `SRS_API_URL`：后端内部转发地址，直接指向 SRS 容器，不走公网
- `WEBRTC_UDP_PORT`：WebRTC UDP 端口，默认 8000，必须与 SRS 配置中的 `rtc_server.listen` 端口一致
- `WEBRTC_TCP_PORT`：WebRTC TCP 端口，仅当 `WEBRTC_PROTOCOL` 为 `tcp` 或 `all` 时使用。设置为 0 时默认使用与 UDP 相同的端口
- `WEBRTC_IP_FAMILY`：IP 协议族，可选 `ipv4`、`ipv6` 或 `all`（同时启用 IPv4 和 IPv6），默认 `ipv4`
- `WEBRTC_PROTOCOL`：传输协议，可选 `udp`（默认）、`tcp` 或 `all`（同时支持 UDP 和 TCP）
- `CANDIDATE`：SRS 服务器的公网 IP，用于 WebRTC ICE 候选交换

### 3. URL 生成逻辑

#### WHIP 推流 URL（主播使用）
```
https://live-push.example.com/rtc/v1/whip/?app=live&stream=demo&secret=xxx
```
- 使用 `PUBLISH_BASE_URL`（推流站）
- 必须 HTTPS
- 直连源站，不走 CDN

#### WHEP 播放 URL（观众使用）
```
https://live.example.com/rtc/v1/whep/?app=live&stream=demo
```
- 使用 `PUBLIC_BASE_URL`（主站）
- 必须 HTTPS
- 可以走 CDN（如果 CDN 不干扰 WebRTC 信令）

#### HTTP-FLV 播放 URL（观众使用）
```
https://live.example.com/live/demo.flv
```
- 使用 `PUBLIC_BASE_URL`（主站）
- 可以走 CDN

#### 后端内部转发
```
http://srs:8080/rtc/v1/whip/
http://srs:1985/rtc/v1/whep/
```
- 使用 `SRS_API_URL`（容器内部地址）
- 不走公网，直接转发到 SRS

### 4. Nginx 配置

#### 主站 Nginx（live.example.com）

```nginx
# /etc/nginx/sites-available/live.conf

upstream backend {
    server 127.0.0.1:8000;
}

upstream srs {
    server 127.0.0.1:8080;
}

server {
    listen 443 ssl http2;
    server_name live.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 管理后台和 API
    location /api/ {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket (聊天 + 观众心跳)
    location /api/chat/ws/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/viewer/ws/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebRTC WHEP 播放信令（观众使用）
    location /rtc/ {
        proxy_pass http://srs;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        # WHEP 需要较长的超时时间
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # HTTP-FLV 播放
    location /live/ {
        proxy_pass http://srs;
        proxy_set_header Host $host;
        proxy_buffering off;
        
        # FLV 流式传输优化
        proxy_cache off;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        chunked_transfer_encoding on;
        tcp_nopush on;
        tcp_nodelay on;
    }

    # 前端静态资源
    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
    }
}
```

#### 推流站 Nginx（live-push.example.com）

```nginx
# /etc/nginx/sites-available/live-push.conf

upstream backend {
    server 127.0.0.1:8000;
}

upstream srs {
    server 127.0.0.1:8080;
}

server {
    listen 443 ssl http2;
    server_name live-push.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # WebRTC WHIP 推流信令（主播使用）
    location /rtc/v1/whip/ {
        proxy_pass http://srs;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        # WHIP 需要较长的超时时间
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # 其他请求拒绝（推流站只处理推流）
    location / {
        return 403;
    }
}

# RTMP 推流（如果需要）
server {
    listen 1935;
    server_name live-push.example.com;
    
    # RTMP 配置由 SRS 处理，Nginx 只做端口转发
}
```

#### Edge 节点 Nginx（node1.live.example.com）

```nginx
# /etc/nginx/sites-available/node1.conf

upstream srs {
    server 127.0.0.1:8080;
}

server {
    listen 443 ssl http2;
    server_name node1.live.example.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # WebRTC WHEP 播放信令（观众使用，就近访问）
    location /rtc/ {
        proxy_pass http://srs;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # HTTP-FLV 播放（备用）
    location /live/ {
        proxy_pass http://srs;
        proxy_set_header Host $host;
        proxy_buffering off;
        
        proxy_cache off;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        chunked_transfer_encoding on;
        tcp_nopush on;
        tcp_nodelay on;
    }

    # 其他请求拒绝
    location / {
        return 403;
    }
}
```

### 5. SRS 配置

```nginx
# deploy/srs/srs.conf

listen              1935;
max_connections     1000;
daemon              off;
srs_log_tank        console;

http_server {
    enabled         on;
    listen          8080;
    dir             ./objs/nginx/html;
}

http_api {
    enabled         on;
    listen          1985;
}

rtc_server {
    enabled         on;
    # WebRTC UDP 端口，必须与环境变量 WEBRTC_UDP_PORT 一致
    listen          8000;
    # 必须配置为 SRS 服务器的公网 IP
    candidate       $CANDIDATE;
    
    # IP 协议族配置，必须与环境变量 WEBRTC_IP_FAMILY 一致
    # 可选值: ipv4, ipv6, all (同时启用 IPv4 和 IPv6)
    ip_family       ipv4;
    
    # 传输协议配置，必须与环境变量 WEBRTC_PROTOCOL 一致
    # 可选值: udp, tcp, all (udp,tcp)
    protocol        udp;
    
    # 仅当 protocol 为 tcp 或 all 时需要配置
    # TCP 端口，必须与环境变量 WEBRTC_TCP_PORT 一致
    # 如果 WEBRTC_TCP_PORT 为 0，则使用与 UDP 相同的端口
    # tcp             8000;
}

vhost __defaultVhost__ {
    http_remux {
        enabled     on;
        mount       [vhost]/[app]/[stream].flv;
    }

    rtc {
        enabled     on;
        rtmp_to_rtc on;
        rtc_to_rtmp on;
    }

    http_hooks {
        enabled         on;
        on_publish      http://backend:8000/api/hooks/on_publish;
        on_unpublish    http://backend:8000/api/hooks/on_unpublish;
    }
}
```

### 6. 自动重定向

后端已配置自动重定向功能：当用户访问推流站（`live-push.example.com`）的非 WHIP 推流请求时，会自动 302 重定向到主站（`live.example.com`）。

**重定向规则：**
- 访问 `/rtc/v1/whip/` 路径：正常处理（WHIP 推流）
- 访问其他路径：自动重定向到主站对应路径

**示例：**
```
https://live-push.example.com/           → 302 → https://live.example.com/
https://live-push.example.com/admin      → 302 → https://live.example.com/admin
https://live-push.example.com/rtc/v1/whip/?app=live&stream=demo  → 正常处理（不重定向）
```

这样可以避免用户误访问推流站时看到错误页面。

### 7. 防火墙配置

确保以下端口开放：

| 端口 | 协议 | 用途 | 是否需要公网访问 |
| --- | --- | --- | --- |
| 443 | TCP | HTTPS（主站、推流站、Edge） | ✅ 是 |
| 1935 | TCP | RTMP 推流 | ✅ 是（推流站） |
| 10080 | TCP | SRT 推流 | ✅ 是（推流站） |
| 8000 | UDP | WebRTC 媒体传输 | ✅ 是（所有节点） |
| 8080 | TCP | SRS HTTP 服务 | ❌ 否（内部） |
| 1985 | TCP | SRS API | ❌ 否（内部） |

**重要：**
- UDP 8000 端口必须对公网开放，用于 WebRTC 媒体传输
- TCP 8080 和 1985 端口只需内部访问，不要暴露到公网

---

## 工作流程

### WHIP 推流流程

1. 主播在管理后台获取 WHIP 推流 URL：`https://live-push.example.com/rtc/v1/whip/?app=live&stream=demo&secret=xxx`
2. OBS 32+ 使用 WHIP URL 连接到推流站（live-push.example.com）
3. 推流站 Nginx 将 WHIP 信令转发到 SRS（内部地址 `http://srs:1985`）
4. SRS 返回 SDP answer，包含 ICE 候选（公网 IP + UDP 8000）
5. OBS 与 SRS 建立 UDP 连接，开始推流

### WHEP 播放流程

1. 观众访问主站（live.example.com），前端获取 WHEP 播放 URL：`https://live.example.com/rtc/v1/whep/?app=live&stream=demo`
2. 浏览器使用 WHEP URL 连接到主站（可能经过 CDN）
3. 主站 Nginx 将 WHEP 信令转发到 SRS（内部地址 `http://srs:8080`）
4. SRS 返回 SDP answer，包含 ICE 候选（公网 IP + UDP 8000）
5. 浏览器与 SRS 建立 UDP 连接，开始播放

### 内部转发流程

```
前端请求 → Nginx (443) → Backend (8000) → SRS (1985/8080)
                                              ↓
                                         WebRTC 信令处理
                                              ↓
                                    返回 ICE 候选（公网 IP:8000）
                                              ↓
客户端 ←─────────────────────────────────────┘
   ↓
UDP 直连 SRS (公网 IP:8000)
```

---

## 常见问题

### Q1: WHIP 推流失败，提示 "ICE connection failed"？

**原因**：客户端无法与 SRS 服务器建立 UDP 连接。

**排查步骤**：
1. 确认 `CANDIDATE` 环境变量设置为 SRS 服务器的**公网 IP**（不是域名）
2. 确认防火墙开放了 UDP 端口 `8000`
3. 确认 WHIP URL 使用的是推流站域名（`live-push.example.com`），而非主站域名
4. 使用 `tcpdump` 或 Wireshark 抓包，检查 UDP 8000 端口是否有流量：
   ```bash
   tcpdump -i any -n udp port 8000
   ```

### Q2: WHEP 播放失败，提示 "Failed to fetch"？

**原因**：浏览器无法访问 WHEP 信令端点。

**排查步骤**：
1. 确认主站域名（`live.example.com`）配置了 HTTPS
2. 确认 Nginx 正确转发 `/rtc/` 路径到 SRS
3. 检查浏览器控制台是否有 CORS 错误
4. 测试 WHEP 端点是否可访问：
   ```bash
   curl -X POST https://live.example.com/rtc/v1/whep/?app=live&stream=demo \
     -H "Content-Type: application/sdp" \
     -d "v=0..."
   ```

### Q3: 为什么 WHIP 不能走 CDN？

**答**：CDN 是基于 HTTP/HTTPS 的内容分发网络，只能代理 TCP 流量。WebRTC 使用 UDP 协议传输媒体数据，CDN 无法转发 UDP 包。即使 WHIP 信令（HTTP POST）能通过 CDN，后续的 ICE 候选交换和媒体传输仍然需要客户端与 SRS 直连。

### Q4: WHEP 播放可以走 CDN 吗？

**答**：理论上可以，但有限制：
1. CDN 必须支持 HTTPS 且不干扰 WebRTC 信令
2. CDN 不能修改或缓存 SDP 内容
3. 最终的媒体传输仍然是客户端与 SRS 的 UDP 直连，CDN 只代理信令

**推荐做法**：
- 如果 CDN 支持且不干扰 WebRTC，可以让 WHEP 走主站 CDN
- 如果遇到问题，可以配置 Edge 节点（`node1.live.example.com`）作为备用，让观众直连 Edge

### Q5: 如何优化 WebRTC 播放延迟？

**建议**：
1. **使用就近的 Edge 节点**：配置多个 Edge 节点，让观众连接到最近的节点
2. **优化 ICE 候选**：确保 `CANDIDATE` 配置正确，避免 ICE 协商失败
3. **调整 SRS 配置**：
   ```nginx
   rtc {
       enabled     on;
       # 减少缓冲延迟
       queue_length 10;
   }
   ```

### Q6: 如��监控 WebRTC 连接状态？

**方法**：
1. **SRS API**：查询当前 WebRTC 连接
   ```bash
   curl http://localhost:1985/api/v1/clients/
   ```

2. **浏览器控制台**：查看 WebRTC 统计信息
   ```javascript
   // 在浏览器控制台执行
   pc.getStats().then(stats => {
     stats.forEach(report => console.log(report));
   });
   ```

3. **后端日志**：查看 SRS 和 Backend 日志
   ```bash
   docker logs srs-live-center-srs
   docker logs srs-live-center-app
   ```

### Q7: Edge 节点需要配置 HTTPS 吗？

**答**：强烈推荐配置 HTTPS，原因：
1. 浏览器要求 WebRTC 必须在安全上下文（HTTPS）中运行
2. 混合内容（HTTPS 页面加载 HTTP 资源）会被浏览器阻止
3. HTTPS 提供更好的安全性和兼容性

**配置方法**：
- 使用 Let's Encrypt 免费证书
- 或者使用通配符证书（`*.live.example.com`）

### Q8: 如何测试 WebRTC 推拉流？

**WHIP 推流测试**：
```bash
# 使用 ffmpeg 测试 WHIP 推流
ffmpeg -re -i test.mp4 \
  -c:v libx264 -preset veryfast -tune zerolatency -g 30 -bf 0 \
  -c:a libopus -b:a 64k -ar 48000 -ac 2 \
  -f whip "https://live-push.example.com/rtc/v1/whip/?app=live&stream=test&secret=YOUR_SECRET"
```

**WHEP 播放测试**：
- 在浏览器中访问 `https://live.example.com`
- 选择 WebRTC 格式播放
- 打开浏览器控制台，查看是否有错误

### Q9: 后端内部转发为什么不走公网？

**答**：后端和 SRS 在同一台服务器（或同一个 Docker 网络）上，使用内部地址转发有以下优势：
1. **性能更好**：不经过公网，延迟更低
2. **安全性更高**：不暴露 SRS 的内部端口到公网
3. **节省带宽**：不占用公网带宽

**配置示例**：
```env
# 后端内部转发地址（容器间通信）
SRS_HTTP_URL=http://srs:8080
SRS_API_URL=http://srs:1985

# 不要配置为公网地址
# SRS_API_URL=http://live-push.example.com:1985  # ❌ 错误
```

### Q10: 如何排查 "Origin 播放时走了 live-push 公网" 的问题？

**排查方法**：
1. 检查后端日志，查看转发的目标地址：
   ```bash
   docker logs srs-live-center-app | grep "srs_url"
   ```

2. 确认环境变量配置正确：
   ```bash
   docker exec srs-live-center-app env | grep SRS
   ```

3. 确认 `SRS_API_URL` 使用的是内部地址（`http://srs:1985`），而不是公网地址

---

## 配置检查清单

部署前请确认以下配置：

- [ ] `PUBLIC_BASE_URL` 设置为主站域名（`https://live.example.com`）
- [ ] `PUBLISH_BASE_URL` 设置为推流站域名（`https://live-push.example.com`）
- [ ] `SRS_API_URL` 设置为 SRS 内部地址（`http://srs:1985`）
- [ ] `CANDIDATE` 设置为 SRS 服务器公网 IP
- [ ] 主站、推流站、Edge 节点都配置了 HTTPS
- [ ] 防火墙开放了 UDP 8000 端口
- [ ] Nginx 正确转发 `/rtc/` 路径到 SRS
- [ ] SRS 配置了正确的 `candidate`
- [ ] 测试 WHIP 推流和 WHEP 播放都正常

---

## 参考资料

- [SRS WebRTC 配置文档](https://ossrs.io/lts/zh-cn/docs/v6/doc/webrtc)
- [WHIP 协议规范](https://datatracker.ietf.org/doc/html/draft-ietf-wish-whip)
- [WHEP 协议规范](https://datatracker.ietf.org/doc/html/draft-ietf-wish-whep)
- [Nginx 反向代理配置](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [WebRTC ICE 候选](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate)
