# Oryx Live Center

基于 Oryx/SRS 的直播中心平台，提供直播观看、弹幕聊天、OAuth2 登录和完整管理后台。

> [!WARNING]
> **全部内容由 Claude Opus 4.6 自动编写测试，不作为任何可靠依据。**

## 功能特性

### 用户端

- 🔐 **OAuth2 登录/注册** — 对接 Authentik，支持 OpenID Connect
- 📺 **直播播放** — 自动获取在线直播流，支持 FLV/HLS/WebRTC 格式选择
- 🔒 **加密直播** — 支持直播流加密，需鉴权或输入密钥
- 💬 **实时弹幕** — WebSocket 实时聊天，需登录后发送

### 管理端

- 👥 **用户管理** — 查看用户列表、封禁/解封用户
- 📡 **直播管理** — 配置直播流加密、鉴权
- 🖥️ **Oryx 控制** — 完整的 Oryx/SRS 管理（客户端、DVR、HLS、转推、转码、回调等）
- 🌐 **CDN 支持** — 配置 CDN 拉流地址

## 技术栈

| 组件     | 技术                                        |
| -------- | ------------------------------------------- |
| 前端     | React 19 + TypeScript + Vite 8 + Ant Design 6 |
| 播放器   | ArtPlayer + mpegts.js + hls.js              |
| 后端     | Python 3.12 + FastAPI + SQLAlchemy 2.0      |
| 数据库   | SQLite (可换 PostgreSQL)                    |
| 实时通信 | WebSocket                                   |
| 认证     | OAuth2 / OpenID Connect (Authentik)         |
| 容器     | Docker + Docker Compose                     |

## 快速开始

```bash
# 克隆项目
git clone https://github.com/your-username/oryx-live-center.git
cd oryx-live-center

# 配置环境变量
cp backend/.env.example .env
# 编辑 .env 填入你的 OAuth2 和 Oryx 配置

# Docker 一键启动
docker compose up -d
```

访问 `http://localhost:3000`。

> 详细的本地开发和生产部署步骤请参阅 [快速开始文档](docs/getting-started.md)。

## 📖 文档

| 文档 | 说明 |
| --- | --- |
| [快速开始](docs/getting-started.md) | 本地开发环境搭建与 Docker 部署 |
| [配置说明](docs/configuration.md) | 环境变量完整列表与 Authentik 配置指南 |
| [架构设计](docs/architecture.md) | 系统架构图、技术选型与模块说明 |
| [API 文档](docs/api-reference.md) | REST API 与 WebSocket 接口参考 |
| [开发指南](docs/development.md) | 编码规范、项目结构与贡献指南 |
| [部署指南](docs/deployment.md) | 生产部署、Nginx 配置、CDN、备份与安全 |

## 项目结构

```
oryx-live-center/
├── backend/                 # Python 后端 (FastAPI)
│   ├── app/
│   │   ├── routers/         # API 路由 (auth/chat/streams/admin)
│   │   ├── main.py          # 入口 + 媒体流反向代理
│   │   ├── config.py        # pydantic-settings 配置
│   │   ├── models.py        # SQLAlchemy ORM 模型
│   │   └── schemas.py       # Pydantic Schema
│   └── pyproject.toml
├── frontend/                # React 前端
│   ├── src/
│   │   ├── components/      # 播放器、弹幕、布局组件
│   │   ├── pages/           # 首页 + 管理后台页面
│   │   ├── api.ts           # API 客户端
│   │   └── store/           # 认证状态管理
│   └── vite.config.ts
├── docs/                    # 详细文档
├── Dockerfile               # 多阶段构建
├── docker-compose.yml       # 服务编排
└── .env                     # 环境变量（从 .env.example 复制）
```

## License

MIT
