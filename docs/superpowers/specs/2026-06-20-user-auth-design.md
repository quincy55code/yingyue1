# 用户认证系统 — 设计规格

## 背景

当前音乐播放器无用户概念，收藏和歌单存储在 localStorage。需要引入用户认证系统，让用户通过邮箱注册登录后，拥有自己的收藏和歌单，数据持久化到 Supabase。

## 技术栈

- **认证**: Supabase Auth（Email + Password）
- **后端**: Node.js Express，`@supabase/supabase-js` 双客户端（anon + service_role）
- **前端**: 原生 HTML/CSS/JS，新增 `js/auth.js` 模块，改造 `js/playlist.js`
- **数据库**: Supabase PostgreSQL，已有 `users`、`favorites`、`playlists`、`playlist_songs` 表

## 架构

```
浏览器 ──fetch──▶ Express /api/auth/*            (注册/登录/登出/查用户)
                 Express /api/favorites          (收藏 CRUD，需登录)
                 Express /api/playlists/*        (歌单 CRUD，需登录)
                 Express /api/songs              (公开，不变)
                 Express /api/search             (公开，不变)
                 Express /api/stream/:id         (公开，不变)
                        │
                        ├── @supabase/supabase-js (anon key) ──▶ Supabase (公开查询)
                        │
                        └── @supabase/supabase-js (service_role) ──▶ Supabase (用户数据 CRUD)
```

**双 Supabase 客户端：**
- `supabase`（anon key）：用于公开端点（/api/songs、/api/search、/api/search-log、/api/stream）
- `supabaseAdmin`（service_role key）：用于需认证的用户数据 CRUD（favorites、playlists、playlist_songs），绕过 RLS

**Auth 中间件：**
```
提取 Authorization: Bearer <token>
  → supabaseAdmin.auth.getUser(token)
  → 失败返回 401 { error: "请先登录" }
  → 成功挂载 req.user = { id, email }
  → next()
```

## 数据流

### 注册
1. 前端 Modal 收集 `{ email, password, username }`
2. `POST /api/auth/signup`
3. 后端调用 `supabaseAdmin.auth.admin.createUser()` 在 `auth.users` 中创建用户
4. 后端 INSERT 到 `public.users`（id 与 auth.users 一致）
5. 调用 `supabase.auth.signInWithPassword()` 获取 session
6. 返回 `{ user: { id, email, username }, session: { access_token, refresh_token } }`
7. 前端存储 session 到 localStorage

### 登录
1. 前端 Modal 收集 `{ email, password }`
2. `POST /api/auth/login`
3. 后端调用 `supabase.auth.signInWithPassword()`
4. 查询 `public.users` 获取 username
5. 返回 `{ user, session }`
6. 前端存储 session → 拉取用户收藏/歌单 → 刷新 UI

### 收藏操作（登录后）
1. 前端 `PlaylistStore.addFavorite(songId)` → `fetch('/api/favorites/42', { method: 'POST', headers: authHeader })`
2. 后端 auth 中间件验证 → `supabaseAdmin.from('favorites').insert({ user_id, song_id })`
3. 返回 `{ ok: true }`

### 歌单操作（登录后）
1. 前端 `PlaylistStore.createPlaylist(name)` → `fetch('/api/playlists', { method: 'POST', body: { name }, headers: authHeader })`
2. 后端 auth 中间件验证 → `supabaseAdmin.from('playlists').insert({ user_id, name })`
3. 返回歌单对象

## API 端点

### Auth 端点（公开）

**`POST /api/auth/signup`**
- Body: `{ email: string, password: string, username: string }`
- 密码最短 6 位
- 成功: `200 { user: { id, email, username }, session: { access_token, refresh_token, expires_at } }`
- 失败: `400 | 409`

**`POST /api/auth/login`**
- Body: `{ email: string, password: string }`
- 成功: `200 { user: { id, email, username }, session: { ... } }`
- 失败: `401 { error: "邮箱或密码错误" }`

**`POST /api/auth/logout`**
- Header: `Authorization: Bearer <token>`
- 成功: `200 { ok: true }`

**`GET /api/auth/me`**
- Header: `Authorization: Bearer <token>`
- 成功: `200 { user: { id, email, username } }`
- 失败: `401`

### 收藏端点（需登录）

**`GET /api/favorites`**
- 获取当前用户的收藏列表，含歌曲详情
- 返回: `[{ id: 1, title, singer, cover_url, ... }]`

**`POST /api/favorites/:songId`**
- 添加收藏，重复收藏返回 `200 { ok: true, existed: true }`

**`DELETE /api/favorites/:songId`**
- 取消收藏

### 歌单端点（需登录）

**`GET /api/playlists`**
- 获取用户的所有歌单

**`POST /api/playlists`**
- Body: `{ name: string }`
- 创建歌单

**`DELETE /api/playlists/:id`**
- 删除歌单（含级联删除歌单内歌曲关联）

**`GET /api/playlists/:id/songs`**
- 获取歌单内歌曲列表（含歌曲详情）

**`POST /api/playlists/:id/songs`**
- Body: `{ song_id: number }`
- 添加歌曲到歌单

**`DELETE /api/playlists/:id/songs/:songId`**
- 从歌单移除歌曲

## 文件改动

| 文件 | 操作 | 说明 |
|------|------|------|
| `server.js` | **改造** | 新增双 Supabase 客户端、auth 中间件、13 个新端点 |
| `.env` | **改造** | 新增 `SUPABASE_SERVICE_ROLE_KEY` |
| `js/auth.js` | **新增** | 认证状态管理模块（IIFE，返回 Auth 单例） |
| `js/playlist.js` | **改造** | 从 localStorage 驱动改为 API 驱动，保持接口不变 |
| `js/ui.js` | **改造** | 新增登录/注册 UI、未登录拦截、登录按钮 |
| `index.html` | **改造** | 引入 auth.js、登录按钮容器 |
| `css/style.css` | **改造** | 新增登录按钮、用户菜单、Auth Modal 样式 |

## 前端改动细节

### `js/auth.js` — 认证管理模块

```javascript
const Auth = (() => {
    const SESSION_KEY = 'music_player_session';

    let _session = null;   // { access_token, refresh_token, expires_at }
    let _user = null;      // { id, email, username }

    function isLoggedIn()
    function getUser()
    function getToken()
    async function init()           // 恢复会话，验证是否过期
    async function login(email, password)
    async function signup(email, password, username)
    async function logout()
    function onChange(fn)           // 登录状态变化时通知 UI
})();
```

### `js/playlist.js` — API 驱动改造

- 新增内部函数 `authHeaders()` 返回 `{ Authorization: 'Bearer <token>' }`
- `getFavorites()`: 未登录返回 `[]`，已登录调用 `GET /api/favorites`
- `addFavorite(songId)`: 未登录不操作，已登录 `POST /api/favorites/:id`
- `removeFavorite(songId)`: 同上用 DELETE
- `toggleFavorite(songId)`: 同上逻辑
- `isFavorite(songId)`: 从 getFavorites 结果中判断
- `getPlaylists()`: 未登录返回 `[]`，已登录调用 `GET /api/playlists`
- `createPlaylist(name)`: `POST /api/playlists`
- `deletePlaylist(name)`: `DELETE /api/playlists/:id`
- `addToPlaylist(plName, songId)`: `POST /api/playlists/:id/songs`
- `removeFromPlaylist(plName, songId)`: `DELETE /api/playlists/:id/songs/:songId`
- 保留 `onChange` 回调机制
- 移除所有 localStorage 读写（favorites、playlists 部分）
- 保留 `searchHistory` 的 localStorage 读写（搜索历史仍用本地存储，无需登录）

### `js/ui.js` — 登录 UI + 拦截

**登录/注册 Modal：**
- 登录表单：邮箱输入框 + 密码输入框 + 「登录」按钮 + 「没有账号？去注册」链接
- 注册表单：邮箱输入框 + 密码输入框 + 用户名输入框 + 「注册」按钮 + 「已有账号？去登录」链接
- 两表单共用一个 Modal，通过切换显示

**Header 登录入口：**
- 未登录时：header 右侧显示「🔑 登录」按钮
- 已登录时：显示用户名 + 下拉菜单（含「退出登录」）

**未登录拦截：**
- 点击收藏按钮（🤍）→ 弹出登录提示 Modal
- 点击添加到歌单（+）→ 弹出登录提示 Modal
- 右侧面板仍可浏览，但显示引导文案

**登录/登出刷新：**
- 登录成功 → 关闭 Modal → `PlaylistStore` 拉取服务器数据 → `refreshAll()`
- 登出 → 清空收藏/歌单显示 → `refreshAll()`

### 样式扩展

- `.btn-login` — 登录按钮，与现有 btn 风格一致
- `.auth-modal` — 登录/注册 Modal 表单样式
- `.user-menu` — 已登录用户下拉菜单
- `.auth-form` — 表单内输入框样式（可复用 `.modal-input`）

## 未改动的部分

- `js/player.js` — 完全不改，与认证无关
- 现有 4 个公开端点 — 保持原样
- B站流代理逻辑 — 不变
- 搜索功能 + 搜索历史 — 不变（搜索历史仍用 localStorage）
- 设计系统 CSS 变量 — 不变

## 登录/未登录行为对照

| 操作 | 未登录 | 已登录 |
|------|--------|--------|
| 浏览歌曲 | ✅ | ✅ |
| 搜索 | ✅ | ✅ |
| 播放 | ✅ | ✅ |
| 搜素历史 | ✅ (localStorage) | ✅ (localStorage) |
| 收藏列表 | 👁 浏览（空引导） | ✅ 服务端 CRUD |
| 点击收藏 | 🚫 弹出登录提示 | ✅ |
| 歌单列表 | 👁 浏览（空引导） | ✅ 服务端 CRUD |
| 点击添加歌单 | 🚫 弹出登录提示 | ✅ |
| 新建歌单 | 🚫 弹出登录提示 | ✅ |

## 注意事项

- `SUPABASE_SERVICE_ROLE_KEY` 需加入 `.gitignore`（.env 已在其中）
- Supabase Auth 需要在 Supabase Dashboard 启用 Email/Password 登录方式
- `public.users` 表与 `auth.users` 通过触发器或后端代码同步（本设计采用后端代码：注册时同时写入）
- 登录/注册用户需在 Supabase Dashboard → Authentication → Settings 中确保已启用邮箱注册

---

## 自检

- [x] 无 TBD/占位符
- [x] 架构与功能描述一致
- [x] 范围可控 — 后端 13 个新端点 + 前端 1 个新模块 + 2 个改造
- [x] 无歧义 — API 请求/响应格式明确
- [x] 与现有代码兼容 — player.js 不变，公开端点不变，搜索功能不变
