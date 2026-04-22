# Mock OAuth2 Server

用于 SRS Live Center 本地开发和测试的 OAuth2/OIDC 模拟服务器，无需依赖 Authentik 等外部认证服务。

## 功能

- ✅ 完整的 OAuth2 Authorization Code 流程
- ✅ OpenID Connect Discovery 端点
- ✅ 预置 3 个测试用户（含管理员）
- ✅ 可视化登录页面（点击用户即登录）
- ✅ 用户管理页面（添加/查看测试用户）
- ✅ 返回 `groups` 字段，支持管理员组检测
- ✅ Docker 支持

## 预置测试用户

| 用户名   | 密码    | 角色     | 组                     |
| -------- | ------- | -------- | ---------------------- |
| `admin`  | `admin` | 管理员   | `srs-admin`, `users`   |
| `user1`  | `user1` | 普通用户 | `users`                |
| `user2`  | `user2` | 普通用户 | `users`                |

> 默认管理员组名是 `srs-admin`，需要与后端 `.env` 的 `OAUTH2_ADMIN_GROUP`
> 保持一致（默认也是 `srs-admin`）。

## 快速启动

### 方式一：直接运行

```bash
cd mock-oauth
pip install -r requirements.txt
python server.py
```

### 方式二：Docker

```bash
cd mock-oauth
docker build -t mock-oauth .
docker run -d -p 9000:9000 --name mock-oauth mock-oauth
```

### 方式三：Docker Compose（推荐）

```bash
# 在项目根目录
docker compose -f docker-compose.test.yml up -d --build
```

## 端点

| 端点                              | 说明                    |
| --------------------------------- | ----------------------- |
| `http://localhost:9000/authorize`  | 授权端点（登录页面）    |
| `http://localhost:9000/token`     | Token 交换端点          |
| `http://localhost:9000/userinfo`  | 用户信息端点            |
| `http://localhost:9000/end-session` | 登出端点              |
| `http://localhost:9000/manage`    | 用户管理页面            |
| `http://localhost:9000/health`    | 健康检查                |
| `http://localhost:9000/.well-known/openid-configuration` | OIDC Discovery |

## 对应的 .env 配置

```env
OAUTH2_CLIENT_ID=test-client
OAUTH2_CLIENT_SECRET=test-secret
OAUTH2_AUTHORIZE_URL=http://localhost:9000/authorize
OAUTH2_TOKEN_URL=http://localhost:9000/token
OAUTH2_USERINFO_URL=http://localhost:9000/userinfo
OAUTH2_LOGOUT_URL=http://localhost:9000/end-session
OAUTH2_REDIRECT_URI=http://localhost:5173/auth/callback
```

> Docker Compose 环境中，Token 和 UserInfo 端点使用容器名 `http://mock-oauth:9000`（容器间通信），
> 而 Authorize 和 Logout 端点使用 `http://localhost:9000`（浏览器直接访问）。

## 登录流程

1. 用户点击应用中的「登录」按钮
2. 浏览器跳转到 `http://localhost:9000/authorize?...`
3. 显示测试用户选择页面
4. 点击任意用户即完成登录
5. 自动重定向回应用，携带 authorization code
6. 应用后端用 code 换取 token → 获取 userinfo → 创建用户 → 签发 JWT
