# 配置说明

> 所有配置通过环境变量（或 `.env` 文件）管理，基于 [pydantic-settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/) 实现。

## 环境变量完整列表

### 应用设置

| 变量              | 默认值               | 说明                                          |
| ----------------- | -------------------- | --------------------------------------------- |
| `APP_NAME`        | `Oryx Live Center`   | 应用名称，显示在页面标题等处                  |
| `APP_SECRET_KEY`  | `change-me-in-production` | 应用密钥，用于会话签名等，**生产环境必须修改** |
| `DEBUG`           | `false`              | 调试模式，启用后会显示 Swagger 文档            |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS 允许的来源，多个用逗号分隔              |

### 数据库

| 变量           | 默认值                             | 说明                                         |
| -------------- | ---------------------------------- | -------------------------------------------- |
| `DATABASE_URL` | `sqlite+aiosqlite:///./data/app.db`| 数据库连接字符串（支持 SQLite / PostgreSQL）  |

**切换到 PostgreSQL 示例：**

```
DATABASE_URL=postgresql+asyncpg://user:password@localhost:5432/oryx_live_center
```

> 切换 PostgreSQL 后需要安装 `asyncpg` 依赖。

### Redis

| 变量        | 默认值                   | 说明                |
| ----------- | ------------------------ | ------------------- |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis 连接地址    |

### OAuth2 / Authentik

| 变量                    | 默认值                                | 说明                                                |
| ----------------------- | ------------------------------------- | --------------------------------------------------- |
| `OAUTH2_CLIENT_ID`     | (空)                                  | OAuth2 Client ID，**必填**                          |
| `OAUTH2_CLIENT_SECRET` | (空)                                  | OAuth2 Client Secret，**必填**                      |
| `OAUTH2_AUTHORIZE_URL` | (空)                                  | 授权端点 URL，**必填**                              |
| `OAUTH2_TOKEN_URL`     | (空)                                  | Token 端点 URL，**必填**                            |
| `OAUTH2_USERINFO_URL`  | (空)                                  | UserInfo 端点 URL，**必填**                         |
| `OAUTH2_LOGOUT_URL`    | (空)                                  | 登出端点 URL（可选）                                |
| `OAUTH2_REDIRECT_URI`  | `http://localhost:5173/auth/callback` | OAuth2 回调地址，需与 Authentik 中配置一致          |
| `OAUTH2_SCOPE`         | `openid profile email`                | 请求的 OAuth2 Scope                                |
| `OAUTH2_ADMIN_GROUP`   | `oryx-admin`                          | 管理员组名，Authentik 中需创建同名组                |

### Oryx / SRS

| 变量              | 默认值                  | 说明                                    |
| ----------------- | ----------------------- | --------------------------------------- |
| `ORYX_API_URL`    | `http://localhost:2022` | Oryx API 地址（管理 API + SRS API）     |
| `ORYX_API_SECRET` | (空)                    | Oryx API Bearer Token（推流密钥）       |
| `ORYX_HTTP_URL`   | `http://localhost:2022` | Oryx HTTP 流地址（FLV/HLS/WebRTC 来源）|

> Oryx v5 使用端口 `2022` 同时提供管理 API 和 HTTP 媒体流服务。

### CDN

| 变量              | 默认值 | 说明                                        |
| ----------------- | ------ | ------------------------------------------- |
| `CDN_BASE_URL`    | (空)   | CDN 基础 URL，配置后播放地址使用 CDN 域名   |
| `CDN_PULL_SECRET` | (空)   | CDN 拉流密钥（可选）                        |

### JWT

| 变量                 | 默认值                    | 说明                            |
| -------------------- | ------------------------- | ------------------------------- |
| `JWT_SECRET`         | `change-me-jwt-secret`    | JWT 签名密钥，**生产环境必须修改** |
| `JWT_ALGORITHM`      | `HS256`                   | JWT 签名算法                    |
| `JWT_EXPIRE_MINUTES` | `1440`                    | JWT 有效期（分钟），默认 24 小时 |

---

## Authentik 配置指南

### 1. 创建 OAuth2 Provider

1. 登录 Authentik 管理后台
2. 进入 **Applications → Providers → Create**
3. 选择 **OAuth2/OpenID Connect**
4. 配置：
   - **Client ID**: 自动生成，复制到 `OAUTH2_CLIENT_ID`
   - **Client Secret**: 自动生成，复制到 `OAUTH2_CLIENT_SECRET`
   - **Redirect URIs**: `http://your-domain/auth/callback`
   - **Signing Key**: 选择任意可用的密钥

### 2. 创建 Application

1. 进入 **Applications → Applications → Create**
2. 选择上一步创建的 Provider
3. 配置 Launch URL（可选）

### 3. 创建管理员组

1. 进入 **Directory → Groups → Create**
2. 创建名为 `oryx-admin` 的组（或自定义名称，需与 `OAUTH2_ADMIN_GROUP` 一致）
3. 将管理员用户添加到该组

### 4. 获取端点 URL

在 Provider 详情页中可找到以下端点：

```
OAUTH2_AUTHORIZE_URL=https://auth.example.com/application/o/authorize/
OAUTH2_TOKEN_URL=https://auth.example.com/application/o/token/
OAUTH2_USERINFO_URL=https://auth.example.com/application/o/userinfo/
OAUTH2_LOGOUT_URL=https://auth.example.com/application/o/end-session/
```

> **注意**: 确保 Scope 至少包含 `openid profile email`，如果需要组信息，还需添加组 Scope。

---

## 环境切换

### 开发环境

```env
DEBUG=true
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
OAUTH2_REDIRECT_URI=http://localhost:5173/auth/callback
```

### 生产环境

```env
DEBUG=false
ALLOWED_ORIGINS=https://live.example.com
OAUTH2_REDIRECT_URI=https://live.example.com/auth/callback
APP_SECRET_KEY=<随机生成的长字符串>
JWT_SECRET=<随机生成的长字符串>
```

生成安全密钥：

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

---

## Docker Compose 环境变量

Docker Compose 除了 `.env` 文件中的变量外，还使用以下额外变量：

| 变量                | 默认值 | 说明                                   |
| ------------------- | ------ | -------------------------------------- |
| `CANDIDATE`         | (空)   | Oryx WebRTC CANDIDATE IP              |
| `ORYX_MGMT_PASSWORD`| (空)   | Oryx 管理密码                          |

> Docker Compose 中 `ORYX_API_URL` 和 `ORYX_HTTP_URL` 已硬编码为 `http://oryx:2022`（容器间通信）。
