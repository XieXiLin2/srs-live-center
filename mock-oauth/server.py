"""
Mock OAuth2 / OpenID Connect Server for SRS Live Center Testing

模拟 Authentik 的 OAuth2/OIDC 端点，提供以下功能：
- 授权端点 (/authorize)      — 显示测试用户选择页面
- Token 端点 (/token)         — 交换 code 为 access_token
- UserInfo 端点 (/userinfo)   — 返回用户信息（含 groups）
- Logout 端点 (/end-session)  — 模拟登出
- 管理页面 (/manage)          — 查看/添加/管理测试用户

预置测试用户:
  - admin / admin  → 管理员 (srs-admin 组)
  - user1 / user1  → 普通用户
  - user2 / user2  → 普通用户
"""

import secrets
import time
import uuid
from typing import Optional
from urllib.parse import urlencode, urlparse, parse_qs

from fastapi import FastAPI, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from jose import jwt

# ============================================================
# Configuration
# ============================================================

HOST = "0.0.0.0"
PORT = 9000
ISSUER = "http://localhost:9000"
JWT_SECRET = "mock-oauth-jwt-secret-for-testing-only"
JWT_ALGORITHM = "HS256"

# ============================================================
# Test Users Database
# ============================================================

MOCK_USERS: dict[str, dict] = {
    "admin": {
        "sub": "uuid-admin-001",
        "preferred_username": "admin",
        "name": "管理员",
        "email": "admin@example.com",
        "picture": "",
        "groups": ["srs-admin", "users"],
        "password": "admin",
    },
    "user1": {
        "sub": "uuid-user1-002",
        "preferred_username": "user1",
        "name": "测试用户一",
        "email": "user1@example.com",
        "picture": "",
        "groups": ["users"],
        "password": "user1",
    },
    "user2": {
        "sub": "uuid-user2-003",
        "preferred_username": "user2",
        "name": "测试用户二",
        "email": "user2@example.com",
        "picture": "",
        "groups": ["users"],
        "password": "user2",
    },
}

# In-memory stores
auth_codes: dict[str, dict] = {}  # code -> {username, redirect_uri, client_id, expires}
access_tokens: dict[str, str] = {}  # token -> username

# ============================================================
# FastAPI App
# ============================================================

app = FastAPI(title="Mock OAuth2 Server", version="1.0.0")


# ============================================================
# HTML Templates
# ============================================================

LOGIN_PAGE_HTML = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mock OAuth2 - 登录</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }}
        .container {{
            background: white;
            border-radius: 16px;
            padding: 40px;
            width: 400px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }}
        .header {{
            text-align: center;
            margin-bottom: 32px;
        }}
        .header h1 {{
            font-size: 24px;
            color: #333;
            margin-bottom: 8px;
        }}
        .header p {{
            color: #888;
            font-size: 14px;
        }}
        .badge {{
            display: inline-block;
            background: #ff4d4f;
            color: white;
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 4px;
            margin-left: 8px;
            vertical-align: middle;
        }}
        .user-list {{
            display: flex;
            flex-direction: column;
            gap: 12px;
        }}
        .user-btn {{
            display: flex;
            align-items: center;
            padding: 16px;
            border: 2px solid #e8e8e8;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            color: inherit;
        }}
        .user-btn:hover {{
            border-color: #667eea;
            background: #f0f2ff;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
        }}
        .user-avatar {{
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: #667eea;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            font-weight: bold;
            margin-right: 16px;
            flex-shrink: 0;
        }}
        .user-avatar.admin {{ background: #ff4d4f; }}
        .user-info {{ flex: 1; }}
        .user-info .name {{ font-size: 16px; font-weight: 600; color: #333; }}
        .user-info .detail {{ font-size: 13px; color: #888; margin-top: 2px; }}
        .user-info .groups {{ font-size: 12px; color: #667eea; margin-top: 4px; }}
        .footer {{
            margin-top: 24px;
            text-align: center;
            color: #bbb;
            font-size: 12px;
        }}
        .client-info {{
            background: #f5f5f5;
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 20px;
            font-size: 13px;
            color: #666;
        }}
        .client-info strong {{ color: #333; }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 Mock OAuth2 <span class="badge">TEST</span></h1>
            <p>选择一个测试用户登录</p>
        </div>
        <div class="client-info">
            <strong>Client:</strong> {client_id}<br>
            <strong>Redirect:</strong> {redirect_uri}
        </div>
        <div class="user-list">
            {user_buttons}
        </div>
        <div class="footer">
            Mock OAuth2 Server · 仅用于开发测试
        </div>
    </div>
</body>
</html>
"""

MANAGE_PAGE_HTML = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mock OAuth2 - 用户管理</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #f5f5f5;
            padding: 40px;
        }}
        .container {{ max-width: 800px; margin: 0 auto; }}
        h1 {{ margin-bottom: 24px; color: #333; }}
        .card {{
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }}
        table {{ width: 100%; border-collapse: collapse; }}
        th, td {{ padding: 12px; text-align: left; border-bottom: 1px solid #f0f0f0; }}
        th {{ font-weight: 600; color: #666; font-size: 13px; text-transform: uppercase; }}
        .tag {{
            display: inline-block;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            margin: 2px;
        }}
        .tag-admin {{ background: #fff1f0; color: #ff4d4f; }}
        .tag-user {{ background: #f0f5ff; color: #1677ff; }}
        h2 {{ margin-bottom: 16px; font-size: 18px; color: #333; }}
        form {{ display: flex; flex-direction: column; gap: 12px; }}
        label {{ font-weight: 500; color: #555; font-size: 14px; }}
        input, select {{
            padding: 8px 12px;
            border: 1px solid #d9d9d9;
            border-radius: 6px;
            font-size: 14px;
        }}
        button {{
            padding: 10px 20px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
        }}
        button:hover {{ background: #5a6fd6; }}
        .endpoint {{ font-family: monospace; background: #f5f5f5; padding: 4px 8px; border-radius: 4px; font-size: 13px; }}
        .endpoints {{ margin-top: 12px; }}
        .endpoints li {{ margin: 6px 0; color: #555; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 Mock OAuth2 Server — 用户管理</h1>

        <div class="card">
            <h2>端点列表</h2>
            <ul class="endpoints">
                <li><strong>Authorize:</strong> <span class="endpoint">http://localhost:9000/authorize</span></li>
                <li><strong>Token:</strong> <span class="endpoint">http://localhost:9000/token</span></li>
                <li><strong>UserInfo:</strong> <span class="endpoint">http://localhost:9000/userinfo</span></li>
                <li><strong>Logout:</strong> <span class="endpoint">http://localhost:9000/end-session</span></li>
                <li><strong>OIDC Discovery:</strong> <span class="endpoint">http://localhost:9000/.well-known/openid-configuration</span></li>
            </ul>
        </div>

        <div class="card">
            <h2>测试用户</h2>
            <table>
                <thead>
                    <tr>
                        <th>用户名</th>
                        <th>显示名</th>
                        <th>邮箱</th>
                        <th>密码</th>
                        <th>组</th>
                        <th>Sub</th>
                    </tr>
                </thead>
                <tbody>
                    {user_rows}
                </tbody>
            </table>
        </div>

        <div class="card">
            <h2>添加测试用户</h2>
            <form method="POST" action="/manage/add">
                <label>用户名</label>
                <input name="username" required placeholder="testuser">
                <label>显示名</label>
                <input name="display_name" required placeholder="测试用户">
                <label>邮箱</label>
                <input name="email" type="email" required placeholder="test@example.com">
                <label>密码</label>
                <input name="password" required placeholder="password">
                <label>是否管理员</label>
                <select name="is_admin">
                    <option value="no">否 — 普通用户</option>
                    <option value="yes">是 — srs-admin 组</option>
                </select>
                <button type="submit">添加用户</button>
            </form>
        </div>
    </div>
</body>
</html>
"""

LOGOUT_PAGE_HTML = """
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <title>已登出</title>
    <style>
        body {{
            font-family: -apple-system, sans-serif;
            display: flex; align-items: center; justify-content: center;
            height: 100vh; background: #f5f5f5;
        }}
        .box {{
            background: white; padding: 40px; border-radius: 12px;
            text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }}
        a {{ color: #667eea; text-decoration: none; }}
    </style>
</head>
<body>
    <div class="box">
        <h2>✅ 已登出</h2>
        <p style="margin-top: 12px; color: #888;">你已从 Mock OAuth2 登出</p>
        <p style="margin-top: 16px;"><a href="{redirect}">返回应用</a></p>
    </div>
</body>
</html>
"""


# ============================================================
# OIDC Discovery
# ============================================================

@app.get("/.well-known/openid-configuration")
async def openid_configuration():
    """OpenID Connect Discovery endpoint."""
    return {
        "issuer": ISSUER,
        "authorization_endpoint": f"{ISSUER}/authorize",
        "token_endpoint": f"{ISSUER}/token",
        "userinfo_endpoint": f"{ISSUER}/userinfo",
        "end_session_endpoint": f"{ISSUER}/end-session",
        "jwks_uri": f"{ISSUER}/.well-known/jwks.json",
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["HS256"],
        "scopes_supported": ["openid", "profile", "email"],
        "token_endpoint_auth_methods_supported": ["client_secret_post"],
    }


# ============================================================
# Authorize Endpoint — Shows Login Page
# ============================================================

@app.get("/authorize", response_class=HTMLResponse)
async def authorize(
    response_type: str = Query("code"),
    client_id: str = Query(""),
    redirect_uri: str = Query(""),
    scope: str = Query("openid profile email"),
    state: str = Query(""),
):
    """显示测试用户选择页面，点击即登录。"""
    user_buttons = ""
    for username, user in MOCK_USERS.items():
        is_admin = "srs-admin" in user.get("groups", [])
        avatar_class = "admin" if is_admin else ""
        avatar_letter = user["name"][0] if user["name"] else username[0].upper()
        groups_str = ", ".join(user.get("groups", []))
        admin_badge = ' <span style="color:#ff4d4f;font-weight:600;">[管理员]</span>' if is_admin else ""

        # Build login URL
        params = urlencode({
            "username": username,
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "state": state,
        })
        login_url = f"/authorize/login?{params}"

        user_buttons += f"""
        <a href="{login_url}" class="user-btn">
            <div class="user-avatar {avatar_class}">{avatar_letter}</div>
            <div class="user-info">
                <div class="name">{user['name']}{admin_badge}</div>
                <div class="detail">{username} · {user['email']}</div>
                <div class="groups">组: {groups_str}</div>
            </div>
        </a>
        """

    html = LOGIN_PAGE_HTML.format(
        client_id=client_id or "(未提供)",
        redirect_uri=redirect_uri or "(未提供)",
        user_buttons=user_buttons,
    )
    return HTMLResponse(content=html)


@app.get("/authorize/login")
async def authorize_login(
    username: str = Query(...),
    client_id: str = Query(""),
    redirect_uri: str = Query(""),
    state: str = Query(""),
):
    """处理用户选择，生成 code 并重定向回应用。"""
    if username not in MOCK_USERS:
        raise HTTPException(status_code=400, detail=f"Unknown user: {username}")

    # Generate authorization code
    code = secrets.token_urlsafe(32)
    auth_codes[code] = {
        "username": username,
        "redirect_uri": redirect_uri,
        "client_id": client_id,
        "expires": time.time() + 300,  # 5 minutes
    }

    # Redirect back to app
    params = {"code": code}
    if state:
        params["state"] = state

    separator = "&" if "?" in redirect_uri else "?"
    redirect_url = f"{redirect_uri}{separator}{urlencode(params)}"
    return RedirectResponse(url=redirect_url)


# ============================================================
# Token Endpoint
# ============================================================

@app.post("/token")
async def token_endpoint(
    grant_type: str = Form("authorization_code"),
    code: str = Form(""),
    redirect_uri: str = Form(""),
    client_id: str = Form(""),
    client_secret: str = Form(""),
):
    """交换 authorization code 为 access_token。"""
    if grant_type != "authorization_code":
        raise HTTPException(status_code=400, detail="Unsupported grant_type")

    if code not in auth_codes:
        raise HTTPException(status_code=400, detail="Invalid or expired authorization code")

    code_data = auth_codes.pop(code)

    # Check expiration
    if time.time() > code_data["expires"]:
        raise HTTPException(status_code=400, detail="Authorization code expired")

    username = code_data["username"]
    user = MOCK_USERS.get(username)
    if not user:
        raise HTTPException(status_code=400, detail="User not found")

    # Generate access token
    access_token = secrets.token_urlsafe(32)
    access_tokens[access_token] = username

    # Generate ID token (JWT)
    id_token_payload = {
        "iss": ISSUER,
        "sub": user["sub"],
        "aud": client_id,
        "exp": int(time.time()) + 86400,
        "iat": int(time.time()),
        "preferred_username": user["preferred_username"],
        "name": user["name"],
        "email": user["email"],
        "groups": user.get("groups", []),
    }
    id_token = jwt.encode(id_token_payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": 86400,
        "id_token": id_token,
        "scope": "openid profile email",
    }


# ============================================================
# UserInfo Endpoint
# ============================================================

@app.get("/userinfo")
async def userinfo_endpoint(request: Request):
    """返回当前用户信息。"""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = auth_header[7:]
    username = access_tokens.get(token)
    if not username:
        raise HTTPException(status_code=401, detail="Invalid access token")

    user = MOCK_USERS.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "sub": user["sub"],
        "preferred_username": user["preferred_username"],
        "name": user["name"],
        "email": user["email"],
        "email_verified": True,
        "picture": user.get("picture", ""),
        "groups": user.get("groups", []),
    }


# ============================================================
# Logout Endpoint
# ============================================================

@app.get("/end-session", response_class=HTMLResponse)
async def end_session(
    post_logout_redirect_uri: str = Query("http://localhost:5173"),
    id_token_hint: str = Query(""),
):
    """模拟登出页面。"""
    html = LOGOUT_PAGE_HTML.format(redirect=post_logout_redirect_uri)
    return HTMLResponse(content=html)


# ============================================================
# Management Page
# ============================================================

@app.get("/manage", response_class=HTMLResponse)
async def manage_page():
    """测试用户管理页面。"""
    user_rows = ""
    for username, user in MOCK_USERS.items():
        groups_tags = ""
        for g in user.get("groups", []):
            tag_class = "tag-admin" if g == "srs-admin" else "tag-user"
            groups_tags += f'<span class="tag {tag_class}">{g}</span>'

        user_rows += f"""
        <tr>
            <td><strong>{username}</strong></td>
            <td>{user['name']}</td>
            <td>{user['email']}</td>
            <td><code>{user['password']}</code></td>
            <td>{groups_tags}</td>
            <td><code style="font-size:11px">{user['sub'][:16]}...</code></td>
        </tr>
        """

    html = MANAGE_PAGE_HTML.format(user_rows=user_rows)
    return HTMLResponse(content=html)


@app.post("/manage/add")
async def manage_add_user(
    username: str = Form(...),
    display_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    is_admin: str = Form("no"),
):
    """添加新测试用户。"""
    if username in MOCK_USERS:
        raise HTTPException(status_code=400, detail=f"User {username} already exists")

    groups = ["users"]
    if is_admin == "yes":
        groups.insert(0, "srs-admin")

    MOCK_USERS[username] = {
        "sub": f"uuid-{username}-{uuid.uuid4().hex[:6]}",
        "preferred_username": username,
        "name": display_name,
        "email": email,
        "picture": "",
        "groups": groups,
        "password": password,
    }

    return RedirectResponse(url="/manage", status_code=303)


# ============================================================
# Health Check
# ============================================================

@app.get("/health")
async def health():
    return {"status": "ok", "service": "mock-oauth2", "users": len(MOCK_USERS)}


# ============================================================
# Entry Point
# ============================================================

if __name__ == "__main__":
    import uvicorn

    print("=" * 60)
    print("  🔐 Mock OAuth2 Server for SRS Live Center")
    print("=" * 60)
    print(f"  Server:     http://localhost:{PORT}")
    print(f"  Management: http://localhost:{PORT}/manage")
    print(f"  Discovery:  http://localhost:{PORT}/.well-known/openid-configuration")
    print()
    print("  预置测试用户:")
    for uname, udata in MOCK_USERS.items():
        role = "管理员" if "srs-admin" in udata.get("groups", []) else "普通用户"
        print(f"    {uname:10s} / {udata['password']:10s}  ({role})")
    print("=" * 60)

    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
