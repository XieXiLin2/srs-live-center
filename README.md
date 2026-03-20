# Oryx Live Center

基于 Oryx/SRS 的直播中心平台，提供直播观看、弹幕聊天、OAuth2 登录和完整管理后台。

> [!WARNING]
> **全部内容由 Claude Opus 4.6 自动编写测试，不作为任何可靠依据。**

> [!NOTE]
>
> 生成提示词
>
> ```text
> 写一个对接 oryx 的前后端，实现以下功能：
>
> - OAuth2 登录 / 注册（此处对接 Authentik）
> - 弹幕（聊天） -> 需要登录
> - 播放直播流，配置为自动获取在线的直播流，并可供选择流> 名称和流格式，如果直播加密则要求鉴权或输入密钥
>
> 管理员：
> - 配置一个 OAuth2 组用于管理员列表
> - 控制 oryx 可以控制的全部东西（记得按需分类）
>
> 因为后续要套 CDN，CDN 拉流和获取资源需要做
>
> 请在这个文件夹开始你的全部操作，前端为 Vite，请配一个好> 看的组件库，后端建议使用 Python 3.12
>
> 配置好 CI 文件，方便编译生成产物
>
> 配置 Docker 需要的配置，方便作为容器运行
> ```

## 功能特性

### 用户端

- 🔐 **OAuth2 登录/注册** - 对接 Authentik，支持 OpenID Connect
- 📺 **直播播放** - 自动获取在线直播流，支持 FLV/HLS/WebRTC 格式选择
- 🔒 **加密直播** - 支持直播流加密，需鉴权或输入密钥
- 💬 **实时弹幕** - WebSocket 实时聊天，需登录后发送

### 管理端

- 👥 **用户管理** - 查看用户列表、封禁/解封用户
- 📡 **直播管理** - 配置直播流加密、鉴权
- 🖥️ **Oryx 控制** - 完整的 Oryx/SRS 管理
  - 客户端管理（查看/踢出）
  - 录制 (DVR) 配置
  - HLS 配置
  - 转推/转发配置
  - 转码配置
  - HTTP 回调配置
- 🌐 **CDN 支持** - 配置 CDN 拉流地址

## 技术栈

| 组件     | 技术                                        |
| -------- | ------------------------------------------- |
| 前端     | React 19 + TypeScript + Vite + Ant Design 6 |
| 播放器   | ArtPlayer + mpegts.js + hls.js              |
| 后端     | Python 3.12 + FastAPI + SQLAlchemy          |
| 数据库   | SQLite (可换 PostgreSQL)                    |
| 实时通信 | WebSocket                                   |
| 认证     | OAuth2 / OpenID Connect (Authentik)         |
| 容器     | Docker + Docker Compose                     |
| CI/CD    | GitHub Actions                              |

## 快速开始

### 前提条件

- Node.js 22+ / pnpm
- Python 3.12+
- Authentik OAuth2 应用配置
- Oryx/SRS 服务运行中

### 开发环境

**1. 后端**

```bash
cd backend
cp .env.example .env
# 编辑 .env 填入你的配置

pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

**2. 前端**

```bash
cd frontend
pnpm install
pnpm dev
```

前端开发服务器运行在 `http://localhost:5173`，API 请求自动代理到后端 `http://localhost:8000`。

### Docker 部署

```bash
# 创建 .env 文件
cp backend/.env.example .env
# 编辑 .env 填入你的配置

# 构建并启动
docker compose up -d
```

服务运行在 `http://localhost:8000`。

## 配置说明

### Authentik OAuth2 配置

1. 在 Authentik 中创建一个 OAuth2/OpenID Connect Provider
2. 配置 Redirect URI: `http://your-domain/auth/callback`
3. 确保 Scope 包含: `openid profile email`
4. 创建一个 Group 用于管理员（默认名: `oryx-admin`）
5. 将管理员用户加入该组

### 环境变量

参见 [backend/.env.example](backend/.env.example) 获取完整配置列表。

关键配置：

| 变量                   | 说明                           |
| ---------------------- | ------------------------------ |
| `OAUTH2_CLIENT_ID`     | Authentik OAuth2 Client ID     |
| `OAUTH2_CLIENT_SECRET` | Authentik OAuth2 Client Secret |
| `OAUTH2_AUTHORIZE_URL` | 授权端点                       |
| `OAUTH2_TOKEN_URL`     | Token 端点                     |
| `OAUTH2_USERINFO_URL`  | UserInfo 端点                  |
| `OAUTH2_ADMIN_GROUP`   | 管理员组名                     |
| `ORYX_API_URL`         | Oryx/SRS API 地址              |
| `ORYX_HTTP_URL`        | Oryx HTTP 流地址               |
| `CDN_BASE_URL`         | CDN 基础 URL（可选）           |

## 项目结构

```
oryx-live-center/
├── backend/
│   ├── app/
│   │   ├── routers/        # API 路由
│   │   │   ├── auth.py     # OAuth2 认证
│   │   │   ├── chat.py     # 弹幕/聊天 WebSocket
│   │   │   ├── streams.py  # 直播流管理
│   │   │   └── admin.py    # 管理后台 API
│   │   ├── auth.py         # 认证工具
│   │   ├── config.py       # 配置
│   │   ├── database.py     # 数据库
│   │   ├── main.py         # 入口
│   │   ├── models.py       # 数据模型
│   │   └── schemas.py      # Pydantic Schema
│   ├── .env.example
│   └── pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── components/     # 通用组件
│   │   ├── pages/          # 页面
│   │   │   └── admin/      # 管理后台页面
│   │   ├── store/          # 状态管理
│   │   ├── api.ts          # API 层
│   │   ├── types.ts        # 类型定义
│   │   └── App.tsx         # 路由配置
│   ├── package.json
│   └── vite.config.ts
├── .github/workflows/ci.yml
├── Dockerfile
├── docker-compose.yml
└── README.md
```

## License

MIT
