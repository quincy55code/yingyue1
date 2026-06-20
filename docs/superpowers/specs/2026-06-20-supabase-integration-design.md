# Supabase 集成 + 搜索功能 — 设计规格

## 背景

当前音乐播放器使用 4 首硬编码歌曲（server.js 中的 SONGS 数组），歌单/收藏存在 localStorage。本次改造引入 Supabase 数据库，实现歌曲从数据库加载、全文搜索、搜索日志记录。

## 技术栈

- **后端**: Node.js Express + `@supabase/supabase-js`（新增依赖）
- **前端**: 原生 HTML/CSS/JS（无框架），现有三模块 IIFE 架构不变
- **数据库**: Supabase PostgreSQL，已有 `songs` 表
- **配置**: `.env` 文件存放 Supabase 凭证

## 架构

```
浏览器 ──fetch──▶ Express /api/songs           (查询 songs 表，默认返回前 10 首)
                 Express /api/search?q=xxx      (模糊搜索 title + singer)
                 Express POST /api/search-log   (记录未找到的搜索词)
                 Express /api/stream/:id        (B站 DASH 音频代理，不变)
                        │
                        └── @supabase/supabase-js ──▶ Supabase (orphftlwdwuvoscizndx.supabase.co)
```

Supabase 凭证仅在服务端（`.env` + `server.js`），前端不感知。

## 数据流

### 1. 页面加载 — 显示前 10 首歌
1. 前端 `fetch('/api/songs')`
2. Express → Supabase `SELECT * FROM songs ORDER BY id LIMIT 10`
3. 返回 JSON（含 singer、cover_url 等新字段）
4. UI 渲染歌曲卡片

### 2. 搜索
1. 用户在搜索框输入关键词
2. 前端防抖（300ms）后 `fetch('/api/search?q=关键词')`
3. Express → Supabase `WHERE title ILIKE '%q%' OR singer ILIKE '%q%'`
4. 有结果 → 渲染搜索结果列表，可播放/收藏/添加歌单
5. 无结果 → 显示"未找到"提示；前端调 `POST /api/search-log` 记录

### 3. 搜索日志记录
1. 仅当搜索无结果时触发
2. `POST /api/search-log` body: `{ query, searched_at }`
3. Express → Supabase `INSERT INTO search_logs`
4. 静默完成，不打断用户体验

### 4. 播放流（不变）
- `/api/stream/:id` 仍然从 B站 获取 DASH 音频 URL 并流式转发
- `server.js` 中的音频代理逻辑全部保留

## 文件改动

| 文件 | 操作 | 说明 |
|------|------|------|
| `.env` | **新增** | `SUPABASE_URL=`, `SUPABASE_ANON_KEY=` |
| `server.js` | **改造** | 引入 supabase-js；`/api/songs` 从 Supabase 查；新增 `/api/search`、`POST /api/search-log` |
| `index.html` | **改造** | 搜索框 HTML + "未找到"提示区域 |
| `js/ui.js` | **改造** | 搜索交互、结果/空状态渲染、调用 search-log API |
| `css/style.css` | **改造** | 搜索框样式、搜索结果高亮、空状态样式 |
| `package.json` | **改造** | 新增 `@supabase/supabase-js` 依赖 |

## API 端点

### 现有端点（行为变化）

**`GET /api/songs`**
- 旧：返回硬编码 SONGS 数组
- 新：从 Supabase `songs` 表 `SELECT * ORDER BY id LIMIT 10`

**`GET /api/stream/:songId`**
- 不变，仍然代理 B站 DASH 音频流
- `songId` 对应 Supabase `songs` 表的 `id`

### 新增端点

**`GET /api/search?q=<关键词>`**
- `q` 长度 1-100 字符
- Supabase 查询：`.or('title.ilike.%q%,singer.ilike.%q%')`
- 返回匹配的歌曲数组，每首含：`id, title, singer, bvid, page, start_seconds, end_seconds, duration_seconds, cover_url`

**`POST /api/search-log`**
- Body: `{ "query": "用户搜的词" }`
- 插入到 `search_logs` 表：`query`, `searched_at`（服务器时间）
- 返回 `{ "ok": true }`

## Supabase 表结构

### `songs` 表（已存在，字段确认）

| 列名 | 类型 | 说明 |
|------|------|------|
| id | int8 (PK) | 自增主键 |
| title | text | 歌名 |
| singer | text | 歌手 |
| bilibili url | text | B站原始 URL |
| bvid | text | B站 BV 号 |
| page | int2 | 分P 序号 |
| start_seconds | float8 | 片段起始秒数（可为 null） |
| end_seconds | float8 | 片段结束秒数（可为 null） |
| duration_seconds | float8 | 总时长（秒） |
| cover_url | text | 封面图 URL |

### `search_logs` 表（待建）

| 列名 | 类型 | 说明 |
|------|------|------|
| id | int8 (PK, auto) | 自增主键 |
| query | text | 用户搜索词 |
| searched_at | timestamptz | 搜索时间，默认 `now()` |

建表 SQL：
```sql
CREATE TABLE search_logs (
  id BIGSERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  searched_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 前端改动细节

### 搜索框
- 位置：歌曲列表区域顶部，section-header 下方
- 样式：圆角输入框，毛玻璃或白底，与现有设计一致
- 行为：输入后 300ms 防抖发搜索请求
- 清除按钮：输入框右侧 × 按钮清空并恢复默认列表

### 搜索状态
- **有结果**：替换左侧列表为搜索结果，右侧面板不变
- **无结果**：显示空状态"未找到「xxx」，已记录你的搜索"，不替换列表（保留默认歌曲）
- **搜索框清空**：恢复显示默认前 10 首歌

### 歌手显示
- 歌曲卡片新增 `card-singer` 副标题行，显示歌手名

## 注意事项

- `songs` 表中 `bilibili url` 字段含空格，SQL 查询需用双引号包裹：`"bilibili url"`
- Supabase URL / anon key 通过 `.env` 注入，`.env` 加入 `.gitignore`
- 前端 `js/player.js` 无需改动 — 它通过 `Player.setSongs()` 接收数据，不关心来源

## 兼容性

- 现有 4 首硬编码歌曲：不再需要，但保留在 `SONGS` 常量中作为注释/备用
- localStorage 收藏/歌单：保持不变，仍然通过歌曲 ID 关联
- B站流代理：`/api/stream/:id` 逻辑完全不变
- 播放器 core：`player.js` 不需要改动（它只消费 `songs` 数组，不关心来源）

## 设计风格
- 搜索框融入现有青春清新风格：暖蜜桃底色、圆角、柔珊瑚聚焦边框
- 搜索无结果时显示友好提示，不破坏页面氛围

---

## 自检
- [x] 无 TBD/占位符
- [x] 架构与功能描述一致
- [x] 范围可控 — 后端 3 个端点改动 + 前端搜索 UI
- [x] 无歧义 — API 请求/响应格式明确
- [x] 与现有代码兼容 — 保留 localStorage、播放器模块不变
