# 开发指南

> 面向贡献者的开发规范和工作流程说明。

## 项目结构

```
oryx-live-center/
├── backend/                # Python 后端
│   ├── pyproject.toml      # 项目配置 & 依赖
│   ├── .env.example        # 环境变量模板
│   └── app/                # 应用代码
│       ├── __init__.py
│       ├── main.py         # FastAPI 入口
│       ├── config.py       # 配置管理
│       ├── database.py     # 数据库引擎 & Session
│       ├── models.py       # SQLAlchemy ORM 模型
│       ├── schemas.py      # Pydantic Schema
│       ├── auth.py         # 认证工具
│       └── routers/        # API 路由模块
│           ├── auth.py     # 认证路由
│           ├── chat.py     # 弹幕/聊天路由
│           ├── streams.py  # 直播流路由
│           └── admin.py    # 管理后台路由
├── frontend/               # React 前端
│   ├── package.json
│   ├── vite.config.ts      # Vite 配置 & 开发代理
│   ├── tsconfig.json
│   └── src/
│       ├── api.ts          # API 客户端
│       ├── types.ts        # TypeScript 类型
│       ├── App.tsx         # 路由
│       ├── store/auth.tsx  # 认证状态
│       ├── components/     # 通用组件
│       └── pages/          # 页面
├── Dockerfile              # 多阶段构建
├── docker-compose.yml      # 服务编排
└── README.md
```

## 后端开发

### 技术规范

- **Python 版本**: 3.12+
- **代码风格**: [Ruff](https://docs.astral.sh/ruff/) (行宽 120)
- **包管理**: [uv](https://docs.astral.sh/uv/)
- **类型提示**: 所有函数/方法必须有类型注解
- **异步**: 全部使用 `async/await`

### 常用命令

```bash
cd backend

# 安装依赖（含开发工具）
uv sync --extra dev

# 启动开发服务器（自动重载）
uv run uvicorn app.main:app --reload --port 8000

# 代码格式化
uv run ruff format .

# 代码检查
uv run ruff check .

# 自动修复
uv run ruff check --fix .

# 运行测试
uv run pytest

# 运行异步测试
uv run pytest -x --asyncio-mode=auto
```

### 添加新的 API 路由

1. 在 `app/routers/` 下创建或修改路由文件
2. 在 `app/schemas.py` 中定义请求/响应 Schema
3. 如需数据库操作，在 `app/models.py` 中定义模型
4. 在 `app/main.py` 中注册路由（如果是新文件）

**示例 — 添加新路由:**

```python
# app/routers/example.py
from fastapi import APIRouter, Depends
from app.auth import require_user
from app.models import User

router = APIRouter(prefix="/api/example", tags=["example"])

@router.get("/")
async def list_items(user: User = Depends(require_user)):
    return {"items": []}
```

```python
# app/main.py
from app.routers import example
app.include_router(example.router)
```

### 认证依赖注入

后端提供三级认证依赖：

| 依赖               | 说明                              |
| ------------------ | --------------------------------- |
| `get_current_user` | 可选认证，返回 `User | None`     |
| `require_user`     | 必须登录，未登录返回 401         |
| `require_admin`    | 必须管理员，非管理员返回 403     |

### 数据库迁移

项目使用 SQLAlchemy 的自动建表（`create_all`），启动时自动创建缺失的表。

> 如需正式迁移，项目已包含 `alembic` 依赖。可自行初始化：
> ```bash
> uv run alembic init migrations
> ```

---

## 前端开发

### 技术规范

- **框架**: React 19 + TypeScript 5.9
- **UI 库**: Ant Design 6
- **路由**: React Router v7
- **HTTP 客户端**: Axios
- **构建工具**: Vite 8
- **代码检查**: ESLint 9

### 常用命令

```bash
cd frontend

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 构建生产版本
pnpm build

# 预览生产构建
pnpm preview

# 代码检查
pnpm lint
```

### 目录约定

| 目录            | 说明                                |
| --------------- | ----------------------------------- |
| `src/api.ts`    | 统一 API 客户端，所有后端请求在此定义 |
| `src/types.ts`  | TypeScript 接口定义                 |
| `src/store/`    | 全局状态管理（Context API）         |
| `src/components/`| 可复用组件                         |
| `src/pages/`    | 页面级组件                          |
| `src/pages/admin/` | 管理后台页面                     |

### 添加新页面

1. 在 `src/pages/` 下创建页面组件
2. 在 `src/App.tsx` 中添加路由
3. 如需 API 调用，在 `src/api.ts` 中添加方法
4. 如需新类型，在 `src/types.ts` 中定义接口

### API 调用模式

```typescript
// src/api.ts
export const myApi = {
  getItems: () => api.get<ItemList>('/my-endpoint').then(r => r.data),
  createItem: (data: CreateItemRequest) =>
    api.post<Item>('/my-endpoint', data).then(r => r.data),
};
```

### 管理后台页面

管理后台使用统一的 `OryxConfigPage` 组件来展示 Oryx 配置：

```tsx
import OryxConfigPage from './OryxConfigPage';
import { adminApi } from '../../api';

export const MyConfig: React.FC = () => (
  <OryxConfigPage
    title="我的配置"
    icon={<SettingOutlined />}
    fetchFn={adminApi.getMyConfig}
    saveFn={adminApi.updateMyConfig}  // 不传则为只读
  />
);
```

### 状态管理

项目使用 React Context API 管理认证状态：

```tsx
import { useAuth } from '../store/auth';

const MyComponent: React.FC = () => {
  const { user, token, login, logout } = useAuth();
  // user 为 null 表示未登录
};
```

---

## 编码规范

### 通用

- 文件名使用 `camelCase`（前端）或 `snake_case`（后端）
- 组件文件名使用 `PascalCase`
- 所有代码添加适当注释
- 保持函数简洁，单一职责

### Commit 消息

推荐使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
feat: 添加直播回放功能
fix: 修复弹幕发送后不滚动的问题
docs: 更新 API 文档
refactor: 重构播放器组件
chore: 更新依赖
```

---

## 测试

### 后端测试

```bash
cd backend
uv run pytest
uv run pytest -v --asyncio-mode=auto
```

### 前端测试

（待添加 Vitest 配置）

```bash
cd frontend
pnpm test
```
