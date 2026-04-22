# 配置说明

> 所有运行时配置都通过环境变量（或 `.env` 文件）注入，后端使用
> [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/)
> 加载，权威来源是 [`backend/app/config.py`](../backend/app/config.py)。

项目根目录下 [`.env.example`](../.env.example) 是 Docker Compose 场景用的完整
模板；[`backend/.env.example`](../backend/.env.example) 则是纯本地开发用的
简化版。两者内容基本一致。

---

## 环境变量完整列表

### 应用设置

| 变量              | 默认值                      | 说明                                                   |
| ----------------- | --------------------------- | ------------------------------------------------------ |
| `APP_NAME`        | `SRS Live Center`           | 应用名称，回显在 `/api/health`、浏览器标题等位置       |
| `APP_SECRET_KEY`  | `change-me-in-production`   | 会话/签名密钥，**生产环境必须修改**                    |
| `DEBUG`           | `false`                     | 调试模式；`true` 时开启 `/api/docs` Swagger UI          |
| `ALLOWED_ORIGINS` | `http://localhost:5173`     | CORS 允许的源，多个用逗号分隔                          |
| `PUBLIC_BASE_URL` | (空)                        | 观众看到的外部 Nginx 基址，例：`https://live.example.com`；留空则使用相对地址（单容器开发模式） |

### 推流 URL 展示

这几个变量只影响 **后台推流页面上展示给主播的 RTMP / SRT / WHIP 地址**，
不会改变 SRS 路由行为。

| 变量                 | 默认值 | 说明                                                            |
| -------------------- | ------ | --------------------------------------------------------------- |
| `PUBLISH_BASE_URL`   | (空)   | 单独的推流域名（如 `push.example.com`），留空则回落到 `PUBLIC_BASE_URL` |
| `PUBLISH_RTMP_PORT`  | `1935` | RTMP 推流端口                                                   |
| `PUBLISH_SRT_PORT`   | `10080`| SRT 推流端口                                                    |

### 品牌化（Branding）

| 变量              | 默认值                                        | 说明                              |
| ----------------- | --------------------------------------------- | --------------------------------- |
| `SITE_NAME`       | `SRS Live Center`                             | 站点显示名（可在管理后台覆盖）    |
| `SITE_LOGO_URL`   | (空)                                          | 站点 Logo URL                     |
| `SITE_COPYRIGHT`  | `© {year} SRS Live Center. All rights reserved.` | 页脚版权文案，支持 `{year}` 占位 |

> 这三项在 **管理后台 → 设置 → 品牌** 里也可以改，且会持久化到
> `app_settings` 表，启动后以数据库里的值优先。

### 数据库

| 变量           | 默认值                              | 说明                                         |
| -------------- | ----------------------------------- | -------------------------------------------- |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/app.db` | SQLAlchemy async 连接串，可换 PostgreSQL     |

**切换到 PostgreSQL 示例：**

```env
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/srs_live_center
```

> 切 PostgreSQL 需要额外安装 `asyncpg` 依赖（`uv add asyncpg`）。

### Redis

| 变量        | 默认值                     | 说明                               |
| ----------- | -------------------------- | ---------------------------------- |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis 连接（当前主要为预留）       |

### OAuth2 / OIDC

| 变量                    | 默认值                                | 说明                                                  |
| ----------------------- | ------------------------------------- | ----------------------------------------------------- |
| `OAUTH2_CLIENT_ID`      | (空)                                  | OAuth2 Client ID，**必填**                            |
| `OAUTH2_CLIENT_SECRET`  | (空)                                  | OAuth2 Client Secret，**必填**                        |
| `OAUTH2_AUTHORIZE_URL`  | (空)                                  | 授权端点，**必填**                                    |
| `OAUTH2_TOKEN_URL`      | (空)                                  | Token 端点，**必填**                                  |
| `OAUTH2_USERINFO_URL`   | (空)                                  | UserInfo 端点，**必填**                               |
| `OAUTH2_LOGOUT_URL`     | (空)                                  | 登出（end-session）端点，可选                         |
| `OAUTH2_REDIRECT_URI`   | `http://localhost:5173/auth/callback` | OAuth2 回调地址，**必须与 IdP 配置完全一致**          |
| `OAUTH2_SCOPE`          | `openid profile email`                | 请求的 Scope                                          |
| `OAUTH2_ADMIN_GROUP`    | `srs-admin`                           | 管理员组名，IdP 中需存在同名组，且通过 userinfo 返回 |

### SRS 6（直接集成，无 Oryx）

| 变量              | 默认值              | 说明                                             |
| ----------------- | ------------------- | ------------------------------------------------ |
| `SRS_HTTP_URL`    | `http://srs:8080`   | SRS 的 HTTP-FLV / HLS 入口（容器间通信地址）     |
| `SRS_API_URL`     | `http://srs:1985`   | SRS HTTP API（用来查询流、客户端、踢人）         |
| `SRS_APP`         | `live`              | 推拉流 URL 中 app 段的默认值（`/live/<stream>`） |
| `SRS_HOOK_SECRET` | (空)                | 可选的 http_hooks 共享密钥。若设置，SRS 需要在回调 URL 附加 `?hook_secret=<value>`，后端会据此校验来源真实性 |

> SRS 6 的管理 API 端口默认是 **1985**，HTTP-FLV 端口默认是 **8080**，与旧版
> Oryx v5 统一使用 `2022` 的做法已经完全不同。

### WebRTC

| 变量                   | 默认值 | 说明                                                                 |
| ---------------------- | ------ | -------------------------------------------------------------------- |
| `WEBRTC_PLAY_ENABLED`  | `true` | WebRTC **播放**（WHEP）的全局开关；`false` 时所有房间都禁用 WHEP，但不影响 WHIP 推流 |
| `CANDIDATE`            | (空)   | 只作用于 `docker-compose.yml`，作为 SRS 容器的 `CANDIDATE` 环境变量；必须是宿主机公网 IP |

全局开关 + 每直播间粒度开关的交互细节见 [`webrtc.md`](./webrtc.md)。

### JWT

| 变量                 | 默认值                        | 说明                                 |
| -------------------- | ----------------------------- | ------------------------------------ |
| `JWT_SECRET`         | `change-me-jwt-secret`        | JWT 签名密钥，**生产环境必须修改**   |
| `JWT_ALGORITHM`      | `HS256`                       | JWT 签名算法                         |
| `JWT_EXPIRE_MINUTES` | `1440`（即 24 小时）          | 登录 JWT 的有效期（分钟）            |

---

## Authentik 配置示例

以 Authentik 为例——任何支持 OIDC + groups claim 的 IdP 均可类比。

### 1. 创建 OAuth2 Provider

1. 登录 Authentik 管理后台
2. **Applications → Providers → Create**
3. 选择 **OAuth2/OpenID Connect**
4. 配置：
   - **Client ID**：自动生成，复制到 `OAUTH2_CLIENT_ID`
   - **Client Secret**：自动生成，复制到 `OAUTH2_CLIENT_SECRET`
   - **Redirect URIs**：`https://live.yourdomain.com/auth/callback`
   - **Signing Key**：任意可用密钥

### 2. 创建 Application

1. **Applications → Applications → Create**
2. 关联到上一步的 Provider

### 3. 创建管理员组

1. **Directory → Groups → Create**
2. 名称填 `srs-admin`（要和 `OAUTH2_ADMIN_GROUP` 一致）
3. 把管理员用户加入该组

### 4. 端点 URL

在 Provider 详情页找到：

```env
OAUTH2_AUTHORIZE_URL=https://auth.example.com/application/o/authorize/
OAUTH2_TOKEN_URL=https://auth.example.com/application/o/token/
OAUTH2_USERINFO_URL=https://auth.example.com/application/o/userinfo/
OAUTH2_LOGOUT_URL=https://auth.example.com/application/o/end-session/
```

> Scope 至少要 `openid profile email`；如需管理员识别，需要 IdP 在
> userinfo 里返回 `groups` 字段（Authentik 默认带）。

---

## 本地快速测试：mock-oauth

如果你暂时没有现成的 IdP，可以直接用仓库里的 `mock-oauth/` 模拟一个最小的
OIDC 服务，对应的 `.env` 片段：

```env
OAUTH2_CLIENT_ID=test-client
OAUTH2_CLIENT_SECRET=test-secret
OAUTH2_AUTHORIZE_URL=http://localhost:9000/authorize
OAUTH2_TOKEN_URL=http://localhost:9000/token
OAUTH2_USERINFO_URL=http://localhost:9000/userinfo
OAUTH2_LOGOUT_URL=http://localhost:9000/end-session
OAUTH2_REDIRECT_URI=http://localhost:5173/auth/callback
OAUTH2_ADMIN_GROUP=srs-admin
```

详见 [`mock-oauth/README.md`](../mock-oauth/README.md)。

---

## 环境切换示例

### 开发环境

```env
DEBUG=true
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
PUBLIC_BASE_URL=
OAUTH2_REDIRECT_URI=http://localhost:5173/auth/callback
SRS_HTTP_URL=http://localhost:8080
SRS_API_URL=http://localhost:1985
```

### 生产环境

```env
DEBUG=false
ALLOWED_ORIGINS=https://live.example.com
PUBLIC_BASE_URL=https://live.example.com
OAUTH2_REDIRECT_URI=https://live.example.com/auth/callback
APP_SECRET_KEY=<随机生成的长字符串>
JWT_SECRET=<随机生成的长字符串>
SRS_HOOK_SECRET=<随机字符串>
CANDIDATE=<SRS 宿主机公网 IP>
```

生成安全密钥：

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

---

## Docker Compose 里的固定值

`docker-compose.yml` 中已经固定好了容器网络用的 SRS 地址，**无需**在 `.env`
里重复写：

```yaml
environment:
  - DATABASE_URL=sqlite+aiosqlite:///./data/app.db
  - DEBUG=false
  - SRS_HTTP_URL=http://srs:8080
  - SRS_API_URL=http://srs:1985
  - SRS_APP=live
```

`REDIS_URL` 从 `.env` 读取，默认 `redis://redis:6379/0`。其他 OAuth2 /
`CANDIDATE` / `SRS_HOOK_SECRET` 等仍然走 `.env`。
