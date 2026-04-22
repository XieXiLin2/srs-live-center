# 开发指南

> 面向贡献者的开发规范和工作流说明。

## 项目结构

```
srs-live-center/
├── backend/                # Python 后端（FastAPI）
│   ├── pyproject.toml      # 项目配置 & 依赖（uv 管理）
│   ├── .env.example        # 环境变量模板
│   └── app/
│       ├── __init__.py
│       ├── main.py              # FastAPI 入口、SRS 反代、SPA 兜底
│       ├── config.py            # pydantic-settings 配置
│       ├── database.py          # SQLAlchemy async engine & session
│       ├── models.py            # ORM 模型
│       ├── schemas.py           # Pydantic 请求/响应
│       ├── auth.py              # JWT + OAuth2 + 依赖注入
│       ├── srs_client.py        # SRS HTTP API 封装
│       ├── stats_reconciler.py  # 对账协程
│       └── routers/             # API 路由模块
│           ├── auth.py
│           ├── streams.py
│           ├── chat.py
│           ├── viewer.py
│           ├── hooks.py
│           ├── admin.py
│           ├── branding.py
│           └── edge.py
├── frontend/               # React 前端（Vite + AntD 6）
│   ├── package.json
│   ├── vite.config.ts      # Vite 配置 & 开发代理
│   └── src/
│       ├── api.ts
│       ├── types.ts
│       ├── App.tsx
│       ├── store/          # Context 状态（auth / branding）
│       ├── components/     # 可复用组件
│       └── pages/          # 页面 & admin/*
├── deploy/
│   ├── srs/srs.conf        # SRS 6 源站配置
│   ├── nginx/nginx.conf    # 内置 Nginx 反代配置
│   └── srs-edge-setup.sh   # Edge 一键脚本
├── mock-oauth/             # 本地开发用的最小 OIDC 模拟服务器
├── docs/                   # 本目录
├── Dockerfile              # 多阶段构建（前端 → 后端 → 最终镜像）
├── docker-compose.yml      # 主编排（Origin）
└── docker-compose.test.yml # 含 mock-oauth 的本地集成测试编排
```

---

## 后端开发

### 技术规范

- **Python 版本**：3.12+
- **代码风格**：[Ruff](https://docs.astral.sh/ruff/)（行宽 120）
- **包管理**：[uv](https://docs.astral.sh/uv/)
- **类型提示**：所有函数/方法必须有类型注解
- **异步**：IO 全部 `async/await`

### 常用命令

```bash
cd backend

# 安装依赖（含开发工具）
uv sync --extra dev

# 启动开发服务器（自动重载）
uv run uvicorn app.main:app --reload --port 8000

# 代码格式化 & 检查
uv run ruff format .
uv run ruff check .
uv run ruff check --fix .

# 运行测试
uv run pytest
uv run pytest -x --asyncio-mode=auto
```

### 添加新的 API 路由

1. 在 `app/routers/` 下创建或扩展路由文件
2. 在 `app/schemas.py` 中定义请求/响应 Schema
3. 如需数据库操作，在 `app/models.py` 中定义模型（启动时自动 `create_all`）
4. 新文件需要在 `app/main.py` 的 `include_router` 列表里注册

**示例 — 新增路由：**

```python
# app/routers/example.py
from fastapi import APIRouter, Depends

from app.auth import require_admin
from app.models import User

router = APIRouter(prefix="/api/example", tags=["example"])


@router.get("/")
async def list_items(_admin: User = Depends(require_admin)) -> dict:
    return {"items": []}
```

```python
# app/main.py
from app.routers import example
app.include_router(example.router)
```

### 认证依赖

| 依赖                 | 说明                                 |
| -------------------- | ------------------------------------ |
| `get_current_user`   | 可选认证，返回 `User | None`         |
| `require_user`       | 必须登录，未登录返回 401             |
| `require_admin`      | 必须为管理员（命中 `OAUTH2_ADMIN_GROUP`），否则 403 |

### 与 SRS 通信

- 所有 SRS HTTP API 调用集中在 `app/srs_client.py`，用 `httpx.AsyncClient`；
  增加新调用请优先放在这里而不是散落在路由里。
- SRS 的 `http_hooks` 回调统一在 `app/routers/hooks.py`；新 hook 请补充
  `deploy/srs/srs.conf` 里的 `http_hooks { ... }` 配置。

### 数据库迁移

开发期使用 SQLAlchemy 的自动建表（`Base.metadata.create_all`）。项目已经把
`alembic` 作为开发依赖，可自行初始化：

```bash
uv run alembic init migrations
```

---

## 前端开发

### 技术规范

- **框架**：React 19 + TypeScript 5.9
- **UI 库**：Ant Design 6
- **路由**：React Router v7
- **HTTP**：Axios
- **构建**：Vite 8
- **Lint**：ESLint 9

### 常用命令

```bash
cd frontend

pnpm install
pnpm dev       # 启动开发服务器（默认 5173 端口）
pnpm build     # 生产构建到 dist/
pnpm preview   # 本地预览生产构建
pnpm lint      # 代码检查
```

### 目录约定

| 目录                | 说明                                       |
| ------------------- | ------------------------------------------ |
| `src/api.ts`        | 统一 API 客户端，所有后端请求都走这里      |
| `src/types.ts`      | TypeScript 接口定义                        |
| `src/store/`        | 全局状态（Context API：`auth`、`branding`）|
| `src/components/`   | 可复用组件（播放器、聊天、布局等）         |
| `src/pages/`        | 页面级组件                                 |
| `src/pages/admin/`  | 管理后台页面（侧边栏导航统一在 `AdminLayout`）|

### 添加新页面

1. 在 `src/pages/`（或 `pages/admin/`）创建页面组件
2. 在 `src/App.tsx` 中挂载路由
3. 如需后端调用，在 `src/api.ts` 增加方法
4. 如需新类型，在 `src/types.ts` 定义

### API 客户端约定

```typescript
// src/api.ts
export const streamsApi = {
  list: () => api.get<StreamListResponse>('/streams/').then(r => r.data),
  play: (body: StreamPlayRequest) =>
    api.post<StreamPlayResponse>('/streams/play', body).then(r => r.data),
};
```

### 状态管理

```tsx
import { useAuth } from '../store/auth';

const MyComponent: React.FC = () => {
  const { user, token, login, logout } = useAuth();
  // user === null 时视为未登录
};
```

---

## 端到端联调

### 本地最小链路

1. 启动 SRS 6（`docker run ... ossrs/srs:6 ...`，见
   [`getting-started.md`](./getting-started.md)）
2. 启动 `mock-oauth`（`cd mock-oauth && python server.py`）配合后端 `.env` 使用
3. 启动后端：`uv run uvicorn app.main:app --reload`
4. 启动前端：`pnpm dev`
5. 用 FFmpeg 推一路 `rtmp://localhost:1935/live/test?secret=<room-secret>`
6. 浏览器打开 `http://localhost:5173`

### 集成 Compose

`docker-compose.test.yml` 已经把上面的几块粘到了一起（含 mock-oauth）：

```bash
docker compose -f docker-compose.test.yml up -d --build
```

---

## 编码规范

### 通用

- 后端文件名 `snake_case`，前端文件名遵循组件/文件类型约定（组件 `PascalCase`
  一般放 `src/components/`）
- 注释只写「为什么」，不用重复「是什么」
- 函数保持单一职责，过长的路由函数拆成 helper

### Commit Message

推荐遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 为直播间新增 WHIP 推流 URL 展示
fix: 修复 on_unpublish 没关闭 StreamPublishSession 的问题
docs: 同步 api-reference 里的 /api/admin/srs/* 路径
refactor: srs_client 抽离重试逻辑
chore: 升级 ruff 到 0.6
```

---

## 测试

### 后端

```bash
cd backend
uv run pytest
uv run pytest -v --asyncio-mode=auto
```

### 前端

目前尚未引入正式测试框架；如计划添加 Vitest，请先在 PR 中讨论目录与配置。

```bash
cd frontend
pnpm test   # 暂未配置
```
