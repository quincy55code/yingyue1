# Supabase 集成 + 搜索功能 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将音乐播放器从硬编码歌曲迁移到 Supabase 数据库，添加搜索框（按歌名/歌手搜索），记录未找到的搜索。

**Architecture:** Express 后端新增 supabase-js 客户端，所有数据查询通过后端代理。前端新增搜索框 UI，300ms 防抖搜索，无结果时静默记录到 `search_logs` 表。B站音频代理逻辑不变。

**Tech Stack:** Node.js Express + @supabase/supabase-js + 原生 HTML/CSS/JS（无框架）

## Global Constraints

- Supabase URL: `https://orphftlwdwuvoscizndx.supabase.co`（硬编码于 .env）
- Supabase anon key 仅服务端使用，不出现在前端代码中
- `songs` 表中 `bilibili url` 字段含空格，SQL 中需引号包裹
- 现有 4 首硬编码歌曲保留为注释备用
- `player.js` / `playlist.js` 不改动 — 接口向下兼容
- 搜索防抖 300ms，搜索词长度限制 1-100 字符
- 项目根目录为 `c:\Users\xiaokang\Desktop\歌曲`

---

### Task 1: 创建 `.env` 文件 + 安装依赖

**Files:**
- Create: `.env`
- Create: `.env.example`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `process.env.SUPABASE_URL`, `process.env.SUPABASE_ANON_KEY` (consumed by Task 2)
- Produces: `@supabase/supabase-js` 可用 (consumed by Task 2)

- [ ] **Step 1: 创建 `.env` 文件**

在项目根目录 `c:\Users\xiaokang\Desktop\歌曲\.env` 写入：

```
SUPABASE_URL=https://orphftlwdwuvoscizndx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ycGhmdGx3ZHd1dm9zY2l6bmR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MjQwODksImV4cCI6MjA5NzUwMDA4OX0.KBwzjGCWygVc-9-pN2mC36RxaziGGH-ivTFbL5j0ht8
```

- [ ] **Step 2: 创建 `.env.example` 文件（不含真实 key）**

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

- [ ] **Step 3: 确保 `.env` 在 `.gitignore` 中**

运行 `cat .gitignore`，检查是否有 `.env` 行。如果没有则追加：

```bash
echo ".env" >> .gitignore
```

- [ ] **Step 4: 安装 `@supabase/supabase-js`**

```bash
cd "c:\Users\xiaokang\Desktop\歌曲" && npm install @supabase/supabase-js
```

预期输出：正常安装，`package.json` 的 `dependencies` 自动增加 `"@supabase/supabase-js"` 条目。

- [ ] **Step 5: Commit**

```bash
git add .env.example .gitignore package.json package-lock.json
git commit -m "chore: add Supabase dependency + env config"
```

---

### Task 2: 改造 `server.js` — Supabase 客户端 + 三个 API 端点

**Files:**
- Modify: `server.js` (全量改动)

**Interfaces:**
- Consumes: `process.env.SUPABASE_URL`, `SUPABASE_ANON_KEY` (from Task 1 `.env`)
- Produces: `GET /api/songs` → `{ id, title, singer, bvid, page, start_time, end_time, page_duration, cover_url, duration }[]`
- Produces: `GET /api/search?q=xxx` → `{ results: [...same shape...], query }`
- Produces: `POST /api/search-log` body `{ query }` → `{ ok: true }`
- Produces: `GET /api/stream/:songId` (行为不变，但从 Supabase 查歌曲元数据)

- [ ] **Step 1: 重写 `server.js`**

完整替换为以下内容：

```js
/**
 * 音乐播放器 — Node.js 后端
 * 代理 B站 DASH 音频流 + Supabase 数据查询
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

// ========== 手动加载 .env（不依赖 dotenv 包） ==========
(function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) {
        console.warn('[env] .env 文件不存在，使用系统环境变量');
        return;
    }
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) return;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (key && value) process.env[key] = value;
    });
})();

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[init] 缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY，请检查 .env 文件');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = express();
app.use(express.json());   // 解析 POST JSON body
const PORT = 8765;

// CORS — 允许前端跨域访问
app.use((_req, res, next) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
    });
    if (_req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// 提供静态文件（index.html, css, js）
app.use(express.static(__dirname));

// ========== 工具函数：格式化歌曲数据 ==========
function formatSong(s) {
    if (!s) return null;
    const hasSegment = s.start_seconds != null && s.end_seconds != null;
    return {
        id: s.id,
        title: s.title || '未知歌曲',
        singer: s.singer || '',
        bvid: s.bvid,
        page: s.page,
        start_time: hasSegment ? s.start_seconds : null,
        end_time: hasSegment ? s.end_seconds : null,
        page_duration: s.duration_seconds || null,
        cover_url: s.cover_url || null,
        duration: hasSegment
            ? (s.end_seconds - s.start_seconds)
            : (s.duration_seconds || null),
    };
}

// ========== 原硬编码歌曲（备份） ==========
// const SONGS = [
//     { id: 1, title: "离别开出花", bvid: "BV1pY5q6jECZ", page: 1, ... },
// ];

// B站 API 请求头
const BILI_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com/",
};

// ========== API 端点 ==========

/** GET /api/songs — 从 Supabase 查询前 10 首歌曲 */
app.get('/api/songs', async (_req, res) => {
    try {
        const { data, error } = await supabase
            .from('songs')
            .select('id,title,singer,bvid,page,start_seconds,end_seconds,duration_seconds,cover_url,"bilibili url"')
            .order('id', { ascending: true })
            .limit(10);

        if (error) {
            console.error('[songs] Supabase error:', error.message);
            return res.status(500).json({ error: '获取歌曲列表失败' });
        }

        res.json((data || []).map(formatSong).filter(Boolean));
    } catch (err) {
        console.error('[songs]', err.message);
        res.status(500).json({ error: '获取歌曲列表失败' });
    }
});

/** GET /api/search?q=关键词 — 模糊搜索歌名 + 歌手 */
app.get('/api/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q || q.length > 100) {
        return res.json({ results: [], query: q });
    }

    try {
        const { data, error } = await supabase
            .from('songs')
            .select('id,title,singer,bvid,page,start_seconds,end_seconds,duration_seconds,cover_url,"bilibili url"')
            .or(`title.ilike.%${q}%,singer.ilike.%${q}%`)
            .order('id', { ascending: true })
            .limit(20);

        if (error) {
            console.error('[search] Supabase error:', error.message);
            return res.status(500).json({ error: '搜索失败' });
        }

        res.json({
            results: (data || []).map(formatSong).filter(Boolean),
            query: q,
        });
    } catch (err) {
        console.error('[search]', err.message);
        res.status(500).json({ error: '搜索失败' });
    }
});

/** POST /api/search-log — 记录未找到的搜索词 */
app.post('/api/search-log', async (req, res) => {
    const query = (req.body.query || '').trim();
    if (!query) {
        return res.status(400).json({ error: 'query is required' });
    }

    try {
        const { error } = await supabase
            .from('search_logs')
            .insert({ query, searched_at: new Date().toISOString() });

        if (error) {
            console.error('[search-log] Supabase error:', error.message);
            return res.status(500).json({ error: '记录失败' });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[search-log]', err.message);
        res.status(500).json({ error: '记录失败' });
    }
});

/** GET /api/stream/:songId — 代理 B站 DASH 音频流 */
app.get('/api/stream/:songId', async (req, res) => {
    const songId = parseInt(req.params.songId);

    // 从 Supabase 查询歌曲元数据
    let song;
    try {
        const { data, error } = await supabase
            .from('songs')
            .select('*')
            .eq('id', songId)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Song not found' });
        }
        song = data;
    } catch (err) {
        return res.status(500).json({ error: '查询歌曲失败' });
    }

    try {
        // 1. 获取视频信息 → 拿 cid
        const viewUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${song.bvid}`;
        const viewResp = await fetch(viewUrl, { headers: BILI_HEADERS });
        const viewData = await viewResp.json();

        if (viewData.code !== 0) {
            return res.status(502).json({ error: `B站视频信息获取失败: ${viewData.message}` });
        }

        const pages = viewData.data.pages || [];
        const pageIdx = (song.page || 1) - 1;
        if (pageIdx >= pages.length) {
            return res.status(400).json({ error: '分P不存在' });
        }
        const cid = pages[pageIdx].cid;

        // 2. 获取播放地址（DASH 格式）
        const playUrl = `https://api.bilibili.com/x/player/playurl?bvid=${song.bvid}&cid=${cid}&fnval=16&fnver=0&fourk=1`;
        const playResp = await fetch(playUrl, { headers: BILI_HEADERS });
        const playData = await playResp.json();

        if (playData.code !== 0) {
            return res.status(502).json({ error: `B站播放地址获取失败: ${playData.message}` });
        }

        const dash = playData.data.dash;
        if (!dash || !dash.audio || dash.audio.length === 0) {
            return res.status(502).json({ error: '该视频没有可用的 DASH 音频流' });
        }

        // 优先最高码率
        const audios = [...dash.audio].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
        let audioUrl = audios[0].base_url || audios[0].baseUrl;

        // 补全协议前缀
        if (audioUrl.startsWith('//')) {
            audioUrl = 'https:' + audioUrl;
        }

        // 3. 流式转发 — 转发浏览器的 Range 请求头
        const browserRange = req.headers.range;
        const upstreamHeaders = { ...BILI_HEADERS };
        if (browserRange) {
            upstreamHeaders["Range"] = browserRange;
        }

        const upstreamResp = await fetch(audioUrl, {
            headers: upstreamHeaders,
        });

        if (!upstreamResp.ok && upstreamResp.status !== 206) {
            return res.status(502).json({ error: `B站 CDN 请求失败: ${upstreamResp.status}` });
        }

        const isPartial = upstreamResp.status === 206;
        const upstreamContentLength = upstreamResp.headers.get('content-length');

        const baseHeaders = {
            'Content-Type': 'audio/mp4',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
        };

        if (isPartial) {
            res.status(206);
            const contentRange = upstreamResp.headers.get('content-range');
            if (contentRange) baseHeaders['Content-Range'] = contentRange;
            if (upstreamContentLength) baseHeaders['Content-Length'] = upstreamContentLength;
            res.set(baseHeaders);
        } else if (upstreamContentLength) {
            baseHeaders['Content-Length'] = upstreamContentLength;
            res.set(baseHeaders);
        } else {
            console.log(`[stream] songId=${songId}: 上游无 Content-Length，缓冲完整文件...`);
            const buffer = Buffer.from(await upstreamResp.arrayBuffer());
            baseHeaders['Content-Length'] = buffer.length;
            res.set(baseHeaders);
            res.end(buffer);
            return;
        }

        const reader = upstreamResp.body.getReader();

        req.on('close', () => {
            reader.cancel().catch(() => {});
        });

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
            }
        } catch (e) {
            // 客户端断开连接 — 正常情况
        }

        res.end();
    } catch (err) {
        console.error(`[stream error] songId=${songId}:`, err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: `请求B站失败: ${err.message}` });
        }
    }
});

app.listen(PORT, () => {
    console.log(`🎵 音乐播放器后端已启动 → http://localhost:${PORT}`);
    console.log(`   歌曲列表: http://localhost:${PORT}/api/songs`);
    console.log(`   搜索接口: http://localhost:${PORT}/api/search?q=离别`);
    console.log(`   前端页面: http://localhost:${PORT}`);
});
```

- [ ] **Step 2: 验证服务启动**

```bash
cd "c:\Users\xiaokang\Desktop\歌曲" && /d/softwa/nodejs/node server.js
```

预期：控制台输出 `🎵 音乐播放器后端已启动 → http://localhost:8765`

启动成功后 Ctrl+C 停止。

- [ ] **Step 3: 验证 `/api/songs` 端点**

启动服务器后，用 curl 或浏览器访问 `http://localhost:8765/api/songs`，确认返回 JSON 数组（Supabase `songs` 表中的前 10 首）。

- [ ] **Step 4: 验证 `/api/search` 端点**

访问 `http://localhost:8765/api/search?q=离别`，确认返回匹配的搜索结果。

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: connect to Supabase, add /api/search + /api/search-log endpoints"
```

---

### Task 3: 前端搜索框 UI — HTML + CSS

**Files:**
- Modify: `index.html` (添加搜索框 DOM)
- Modify: `css/style.css` (搜索框 + 空状态样式)

**Interfaces:**
- Consumes: `GET /api/search?q=xxx` (from Task 2)
- Produces: `<input id="searchInput">` 供 Task 4 JS 使用
- Produces: CSS 类 `.search-wrap`, `.search-input`, `.search-empty` 供 Task 4 使用

- [ ] **Step 1: 在 `index.html` 中添加搜索框**

在 `<div class="section-header">🎶 歌曲列表</div>` 之后、`<div class="song-list" id="songList">` 之前，插入搜索框 HTML：

编辑 `index.html:26-27` 区域，将：

```html
            <div class="section-header">🎶 歌曲列表</div>
            <div class="song-list" id="songList">
```

改为：

```html
            <div class="section-header">🎶 歌曲列表</div>
            <div class="search-wrap">
                <input type="text" class="search-input" id="searchInput" placeholder="🔍 搜索歌曲、歌手…" autocomplete="off">
                <button class="search-clear" id="searchClear" style="display:none">✕</button>
            </div>
            <div class="song-list" id="songList">
```

- [ ] **Step 2: 在 `css/style.css` 末尾添加搜索相关样式**

在 `css/style.css` 文件末尾追加：

```css
/* ---------- Search Box ---------- */
.search-wrap {
    position: relative;
    margin: 0 8px 12px;
}

.search-input {
    width: 100%;
    padding: 10px 40px 10px 14px;
    border: 2px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 14px;
    font-family: var(--font-stack);
    color: var(--text-primary);
    background: var(--bg-card);
    outline: none;
    transition: border-color var(--transition), box-shadow var(--transition);
}

.search-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(232, 145, 123, 0.15);
}

.search-input::placeholder {
    color: var(--text-muted);
}

.search-clear {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 16px;
    color: var(--text-muted);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color var(--transition), background var(--transition);
}

.search-clear:hover {
    color: var(--accent);
    background: var(--bg-primary);
}

/* ---------- Search Empty State ---------- */
.search-empty .empty-icon {
    font-size: 48px;
    display: block;
    margin-bottom: 12px;
    opacity: 0.6;
}

.search-empty strong {
    color: var(--accent);
}
```

- [ ] **Step 3: Commit**

```bash
git add index.html css/style.css
git commit -m "feat: add search box UI + styles"
```

---

### Task 4: 前端搜索交互逻辑 — `js/ui.js`

**Files:**
- Modify: `js/ui.js` (搜索功能 + 歌曲卡片歌手显示)

**Interfaces:**
- Consumes: `#searchInput`, `#searchClear` DOM elements (from Task 3)
- Consumes: `GET /api/search?q=xxx`, `POST /api/search-log` (from Task 2)
- Consumes: `GET /api/songs` (existing, now Supabase-backed from Task 2)
- Produces: 搜索防抖、结果渲染、空状态、日志记录、清空恢复

- [ ] **Step 1: 在 `renderSongList` 中添加歌手显示**

找到 `js/ui.js` 中 `renderSongList` 函数的这段（约 62-73 行）：

```js
            const card = h(`
                <div class="song-card${isPlaying ? ' playing' : ''}" data-song-id="${sid}">
                    <div class="card-index">${idx + 1}</div>
                    <div class="card-info">
                        <div class="card-title">${escapeHtml(song.title)}</div>
                        <div class="card-meta">${song.duration ? formatTime(song.duration) : '完整版'}</div>
                    </div>
```

改为（新增 `card-singer` 行）：

```js
            const singerHtml = song.singer ? `<div class="card-singer">${escapeHtml(song.singer)}</div>` : '';
            const card = h(`
                <div class="song-card${isPlaying ? ' playing' : ''}" data-song-id="${sid}">
                    <div class="card-index">${idx + 1}</div>
                    <div class="card-info">
                        <div class="card-title">${escapeHtml(song.title)}</div>
                        ${singerHtml}
                        <div class="card-meta">${song.duration ? formatTime(song.duration) : '完整版'}</div>
                    </div>
```

- [ ] **Step 2: 在 `cacheDom` 中添加搜索相关 DOM 引用**

找到 `js/ui.js` 中 `cacheDom` 函数（约 11-33 行），在 `els = {` 对象内追加：

```js
                searchInput: document.getElementById('searchInput'),
                searchClear: document.getElementById('searchClear'),
```

- [ ] **Step 3: 在 `init` 函数末尾添加搜索初始化调用**

找到 `js/ui.js` 中 `init` 函数（约 476-519 行），在 `switchPanel('fav');` 之后、`}` 闭合之前，添加：

```js
        setupSearch();
```

- [ ] **Step 4: 在 UI IIFE 内部添加搜索相关函数**

在 `setupGlobalListeners` 函数之前（约 287 行之前），插入以下代码：

```js
    // ========== 搜索功能 ==========
    let _searchTimer = null;
    let _isSearching = false;        // 当前是否在搜索模式
    let _defaultSongs = [];          // 默认歌曲缓存（搜索清空后恢复）

    function setupSearch() {
        const input = els.searchInput;
        const clearBtn = els.searchClear;
        if (!input) return;

        // 输入 → 防抖搜索
        input.addEventListener('input', () => {
            const q = input.value.trim();
            clearBtn.style.display = q ? 'flex' : 'none';

            clearTimeout(_searchTimer);
            if (!q) {
                // 清空搜索框 → 恢复默认列表
                _isSearching = false;
                renderSongList(_defaultSongs);
                return;
            }

            _searchTimer = setTimeout(() => doSearch(q), 300);
        });

        // 回车立即搜索
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(_searchTimer);
                const q = input.value.trim();
                if (q) doSearch(q);
            }
        });

        // 清除按钮
        clearBtn.addEventListener('click', () => {
            input.value = '';
            clearBtn.style.display = 'none';
            _isSearching = false;
            renderSongList(_defaultSongs);
            input.focus();
        });
    }

    async function doSearch(q) {
        if (!q || q.length > 100) return;

        try {
            const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            if (!resp.ok) return;
            const data = await resp.json();

            _isSearching = true;

            if (data.results && data.results.length > 0) {
                // 有结果 → 渲染搜索结果
                renderSongList(data.results);
            } else {
                // 无结果 → 显示空状态 + 记录搜索
                _isSearching = false;
                renderSearchEmpty(q);
                logSearchMiss(q);
            }
        } catch (err) {
            console.error('[search]', err);
        }
    }

    function renderSearchEmpty(q) {
        if (!els.songList) return;
        els.songList.innerHTML = `
            <div class="empty-state search-empty">
                <span class="empty-icon">🔍</span>
                未找到「<strong>${escapeHtml(q)}</strong>」<br>
                <small style="color:var(--text-muted)">已记录你的搜索，后续会添加相关歌曲</small>
            </div>`;
    }

    async function logSearchMiss(q) {
        try {
            await fetch('/api/search-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: q }),
            });
        } catch {
            // 静默失败，不影响用户体验
        }
    }
```

- [ ] **Step 5: 在 `init` 函数中缓存默认歌曲数据**

找到 `js/ui.js` 中 `init` 函数的这段（约 476 行）：

```js
    function init(songs) {
        cacheDom();
        window._songCache = songs;
```

改为：

```js
    function init(songs) {
        cacheDom();
        window._songCache = songs;
        _defaultSongs = songs;
```

- [ ] **Step 6: 提交前自检 — 确认 `renderSongList` 接受搜索结果**

在 `init` 函数中 `renderSongList(songs)` 调用不变；搜索结果通过 `doSearch` → `renderSongList(data.results)` 传入。

- [ ] **Step 7: Commit**

```bash
git add js/ui.js
git commit -m "feat: add search interaction with debounce + miss logging"
```

---

### Task 5: `search_logs` 表创建（手动操作）

**此任务需用户在 Supabase 后台完成，不涉及代码改动。**

- [ ] **Step 1: 打开 Supabase SQL Editor**

登录 [supabase.com](https://supabase.com) → 找到项目 → SQL Editor。

- [ ] **Step 2: 执行建表 SQL**

```sql
CREATE TABLE IF NOT EXISTS search_logs (
  id BIGSERIAL PRIMARY KEY,
  query TEXT NOT NULL,
  searched_at TIMESTAMPTZ DEFAULT NOW()
);
```

- [ ] **Step 3: （可选）验证表创建成功**

在 Supabase Table Editor 中确认 `search_logs` 表出现，包含 `id`, `query`, `searched_at` 三列。

- [ ] **Step 4: 无 git 操作（表在远端 Supabase）**

---

### Task 6: 端到端验证

- [ ] **Step 1: 杀掉旧进程，启动新版服务器**

```bash
# 查找并杀掉占用 8765 端口的进程
netstat -ano | grep 8765
# 记下 PID，然后：
taskkill //F //PID <pid>
```

```bash
cd "c:\Users\xiaokang\Desktop\歌曲" && /d/softwa/nodejs/node server.js
```

- [ ] **Step 2: 验证首页加载**

浏览器打开 `http://localhost:8765`，确认：
- 左侧歌曲列表显示 Supabase `songs` 表的前 10 首
- 右侧收藏/歌单面板正常
- 底部播放栏正常

- [ ] **Step 3: 验证搜索有结果**

在搜索框输入一个 Supabase 表中存在的歌名/歌手名，确认：
- 300ms 后显示匹配结果
- 点击结果可播放
- 清除按钮（✕）可点击恢复默认列表

- [ ] **Step 4: 验证搜索无结果 + 日志记录**

搜索一个表里不存在的词（如 "不存在的歌xyz"），确认：
- 显示 "未找到「不存在的歌xyz」— 已记录你的搜索"
- 检查 Supabase Table Editor → `search_logs` 表，确认有一条新记录

- [ ] **Step 5: 验证现有功能不受影响**

- 点击歌曲 → 播放正常
- ⏮ ⏭ 上/下一首正常
- 🔁 模式切换正常
- 🤍 收藏 / ❤️ 取消收藏正常
- + 添加到歌单正常
- 右侧面板正常

- [ ] **Step 6: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: any issues found during verification"
```
