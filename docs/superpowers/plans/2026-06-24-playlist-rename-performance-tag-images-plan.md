# Playlist Rename + Performance + Tag Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add inline playlist rename, speed up collection loading with skeleton screens, replace yumus.cn images with local tag backgrounds, and tighten static file serving.

**Architecture:** Backend adds a single PATCH endpoint. Frontend adds optimistic rename in PlaylistStore + inline-edit UI in ui.js. Collection loading gets preloaded in init() and all `⏳加载中…` placeholders become skeleton cards using existing CSS skeleton classes. Tag card backgrounds switch from remote yumus.cn API to local `public/images/tags/` images (downloaded via existing `download_tag_bg.js`). `express.static` narrows to `public/` + explicit frontend paths.

**Tech Stack:** Node.js Express, Supabase PostgREST, vanilla JS, CSS

## Global Constraints

- No new dependencies
- Follow existing optimistic-update pattern in PlaylistStore
- Follow existing CSS variable naming (`--bg-*`, `--accent`, etc.)
- All new UI text in Chinese
- Server runs on port 8765, Node at `/d/softwa/nodejs/node`

---

### Task 1: Backend — PATCH /api/playlists/:id (rename)

**Files:**
- Modify: `server.js` (after `DELETE /api/playlists/:id` block at ~line 1282)

**Interfaces:**
- Consumes: `authMiddleware` (existing, sets `req.user.id`)
- Produces: `PATCH /api/playlists/:id` — accepts `{ name }`, returns `{ id, name, updated_at }`

- [ ] **Step 1: Add PATCH endpoint to server.js**

Insert after the `DELETE /api/playlists/:id` block (after line 1282) and before `GET /api/playlists/:id/songs`:

```js
/** PATCH /api/playlists/:id — 重命名歌单 */
app.patch('/api/playlists/:id', authMiddleware, async (req, res) => {
    const plId = parseInt(req.params.id);
    const name = (req.body.name || '').trim();

    if (!name || name.length > 100) {
        return res.status(400).json({ error: '歌单名称无效（1-100个字符）' });
    }

    try {
        // 验证歌单属于当前用户
        const { data: pl } = await supabaseAdmin
            .from('playlists')
            .select('id, user_id')
            .eq('id', plId)
            .single();

        if (!pl) {
            return res.status(404).json({ error: '歌单不存在' });
        }
        if (pl.user_id !== req.user.id) {
            return res.status(403).json({ error: '无权操作此歌单' });
        }

        // 检查同一用户下是否已有同名歌单
        const { data: dup } = await supabaseAdmin
            .from('playlists')
            .select('id')
            .eq('user_id', req.user.id)
            .eq('name', name)
            .neq('id', plId)
            .limit(1);

        if (dup && dup.length > 0) {
            return res.status(409).json({ error: '已存在同名歌单' });
        }

        const { data, error } = await supabaseAdmin
            .from('playlists')
            .update({ name, updated_at: new Date().toISOString() })
            .eq('id', plId)
            .select('id, name, updated_at')
            .single();

        if (error) {
            console.error('[playlists rename]', error.message);
            return res.status(500).json({ error: '重命名失败' });
        }

        res.json(data);
    } catch (err) {
        console.error('[playlists rename]', err.message);
        res.status(500).json({ error: '重命名失败' });
    }
});
```

- [ ] **Step 2: Verify the endpoint**

Start the server and test with curl:
```bash
# First get a valid JWT token (login)
# Then test rename
curl -s -X PATCH "http://localhost:8765/api/playlists/1" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <JWT>" \
  -d '{"name":"新歌单名"}'
```
Expected: `{"id":1,"name":"新歌单名","updated_at":"2026-..."}`

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add PATCH /api/playlists/:id for renaming playlists"
```

---

### Task 2: Frontend — PlaylistStore.renamePlaylist()

**Files:**
- Modify: `js/playlist.js` (in the return block and after `deletePlaylist`)

**Interfaces:**
- Produces: `PlaylistStore.renamePlaylist(id, newName)` — optimistic update, returns nothing, throws on error
- Consumed by: Task 3 (ui.js inline edit handler)

- [ ] **Step 1: Add renamePlaylist method to PlaylistStore**

Add after the `deletePlaylist` function (after line 206):

```js
async function renamePlaylist(plId, newName) {
    if (!isLoggedIn()) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed.length > 100) return;

    // 乐观更新：立即更新缓存中的名字
    const old = _playlistsCache.find(p => String(p.id) === String(plId));
    const oldName = old ? old.name : null;
    if (old) {
        old.name = trimmed;
        old._optimistic = true;
    }
    notify();

    try {
        const resp = await fetch('/api/playlists/' + plId, {
            method: 'PATCH',
            headers: authHeaders(),
            body: JSON.stringify({ name: trimmed }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error || '重命名失败');
        }
        const updated = await resp.json();
        // 用服务器返回值更新缓存
        const idx = _playlistsCache.findIndex(p => String(p.id) === String(plId));
        if (idx >= 0) {
            _playlistsCache[idx] = { ..._playlistsCache[idx], ...updated, _optimistic: false };
        }
        notify();
    } catch (e) {
        // 回滚
        if (old) old.name = oldName;
        notify();
        throw e;
    }
}
```

- [ ] **Step 2: Export renamePlaylist in return block**

In the `return { ... }` block at the bottom, add:
```js
renamePlaylist,
```

Place it next to `deletePlaylist,` for logical grouping.

- [ ] **Step 3: Commit**

```bash
git add js/playlist.js
git commit -m "feat: add PlaylistStore.renamePlaylist with optimistic update"
```

---

### Task 3: Frontend — Inline Edit UI for Playlist Names

**Files:**
- Modify: `js/ui.js` — `renderPlaylists()` at ~line 444-465
- Modify: `js/ui.js` — global delegation handler (add `rename-playlist` action)
- Modify: `css/style.css` — add inline edit input styles

**Interfaces:**
- Consumes: `PlaylistStore.renamePlaylist(id, name)` from Task 2
- Produces: Clickable playlist names that turn into inline inputs

- [ ] **Step 1: Update renderPlaylists() to make names clickable with edit hint**

Replace the `renderPlaylists` function (lines 444-465):

```js
function renderPlaylists() {
    const pls = PlaylistStore.getPlaylists();
    if (!pls || !pls.length) {
        $.viewContainer.innerHTML = `
            <div class="empty-state"><span class="empty-icon">📋</span>还没有歌单<br><small>点击下方按钮创建第一个歌单</small></div>
            <button class="btn-new-pl" data-action="new-playlist">+ 新建歌单</button>`;
        return;
    }
    let html = '<div class="song-list">';
    pls.forEach(pl => {
        html += `
        <div class="playlist-item" data-action="open-playlist" data-pl-id="${pl.id}">
            <span style="font-size:20px">📋</span>
            <span class="pl-name" data-action="rename-playlist" data-pl-id="${pl.id}" title="点击改名">${escapeHtml(pl.name)}</span>
            <span class="pl-count">${pl.song_count || 0} 首</span>
            <button class="btn-delete" data-action="delete-playlist" data-pl-id="${pl.id}">🗑</button>
        </div>`;
    });
    html += '</div>';
    html += '<button class="btn-new-pl" data-action="new-playlist">+ 新建歌单</button>';
    $.viewContainer.innerHTML = html;
}
```

- [ ] **Step 2: Add inline edit logic — startRename() and commitRename()**

Add these functions before `renderPlaylists`:

```js
function startRename(plId) {
    // 防止重复打开
    if (document.querySelector('.pl-name-input')) return;

    const nameEl = document.querySelector(`.pl-name[data-pl-id="${plId}"]`);
    if (!nameEl) return;

    const oldName = nameEl.textContent;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pl-name-input';
    input.value = oldName;
    input.maxLength = 100;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const commit = async () => {
        const newName = input.value.trim();
        if (!newName || newName === oldName) {
            // 恢复原样
            input.replaceWith(nameEl);
            return;
        }
        try {
            await PlaylistStore.renamePlaylist(plId, newName);
        } catch (e) {
            alert(e.message);
            // PlaylistStore.onChange 会触发 refreshAll → renderPlaylistsInContent
        }
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = oldName; input.blur(); }
    });
    input.addEventListener('blur', commit);
}
```

- [ ] **Step 3: Wire up rename-playlist action in global delegation**

In the global click handler (near line 1087, alongside other actions), add:

```js
if (action === 'rename-playlist') {
    e.stopPropagation();  // 防止触发 open-playlist
    const plId = parseInt(btn.dataset.plId);
    if (plId) startRename(plId);
    return;
}
```

Also update the `open-playlist` handler to ignore clicks on `.pl-name`:
Find the handler at ~line 1089:
```js
if (action === 'open-playlist') {
    const plId = parseInt(btn.dataset.plId);
    if (plId) openPlaylistModal(plId);
    return;
}
```
No change needed — the `e.stopPropagation()` in `rename-playlist` already prevents `open-playlist` from firing.

- [ ] **Step 4: Add CSS for inline edit input**

Add to `css/style.css`, after the `.playlist-item .pl-name` block (~line 2121):

```css
.pl-name-input {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 2px solid var(--accent);
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 500;
    padding: 2px 0;
    outline: none;
    font-family: inherit;
}
```

- [ ] **Step 5: Commit**

```bash
git add js/ui.js css/style.css
git commit -m "feat: inline edit UI for playlist rename"
```

---

### Task 4: Collections Preload + Skeleton Screens

**Files:**
- Modify: `js/ui.js` — `init()`, `navigateToCollection()`, `navigateToCollectionSongs()`, `navigateToCollectionBySlug()`
- Modify: `css/style.css` — add `.skeleton-card` class

**Interfaces:**
- Produces: Skeleton placeholders during loading; preloaded `_collectionTree`
- Consumes: Existing `renderCollectionGrid()`, `renderCoverGrid()`

- [ ] **Step 1: Add skeleton HTML generators**

Add these helper functions near the other render functions (before `renderCollectionGrid` at ~line 250):

```js
function renderSkeletonCollectionGrid() {
    let html = '<div class="tag-grid">';
    for (let i = 0; i < 12; i++) {
        html += `<div class="skeleton skeleton-card" style="--stagger-index:${i};animation-delay:${i * 0.03}s"></div>`;
    }
    html += '</div>';
    return html;
}

function renderSkeletonCoverGrid(count) {
    let html = '<div class="cover-grid">';
    for (let i = 0; i < Math.min(count || 6, 20); i++) {
        html += `<div class="skeleton skeleton-cover-card" style="--stagger-index:${i};animation-delay:${i * 0.03}s"></div>`;
    }
    html += '</div>';
    return html;
}
```

- [ ] **Step 2: Replace `⏳加载中…` with skeleton in navigateToCollection()**

Replace line 341 (the loading placeholder):
```js
// Before:
$.viewContainer.innerHTML = '<div class="empty-state"><span class="empty-icon">⏳</span>加载中…</div>';
// After:
$.viewContainer.innerHTML = renderSkeletonCollectionGrid();
```

- [ ] **Step 3: Replace `⏳加载中…` with skeleton in navigateToCollectionSongs()**

Replace line 371:
```js
// Before:
$.viewContainer.innerHTML = '<div class="empty-state"><span class="empty-icon">⏳</span>加载中…</div>';
// After:
$.viewContainer.innerHTML = renderSkeletonCoverGrid(6);
```

- [ ] **Step 4: Preload collections in init()**

In the `init()` function, after `mergeToCache(songs)` (~line 1941), add a non-blocking preload:

```js
// 后台预加载歌曲汇总数据（不阻塞首屏渲染）
fetch('/api/collections')
    .then(r => r.json())
    .then(d => { _collectionTree = d.collections || []; })
    .catch(() => {});
```

- [ ] **Step 5: Remove redundant fetch in navigateToCollectionBySlug when cache exists**

The function at ~line 391 already checks `if (!_collectionTree)` before fetching — this is correct. No change needed. With Task 4 Step 4 preloading, the cache will almost always be warm by the time the user clicks a sidebar shortcut.

- [ ] **Step 6: Add skeleton CSS classes**

Add to `css/style.css`, after the existing `.skeleton-text.short` block (~line 2301):

```css
/* Skeleton card — mimics .tag-card dimensions */
.skeleton-card {
    width: 100%;
    min-height: 110px;
    border-radius: var(--radius-md);
    animation: shimmer 1.5s ease-in-out infinite, cardEnter var(--duration-base) var(--ease-out) both;
}

/* Skeleton cover card — mimics .cover-card dimensions */
.skeleton-cover-card {
    width: 100%;
    aspect-ratio: 1;
    border-radius: var(--radius-md);
    animation: shimmer 1.5s ease-in-out infinite, cardEnter var(--duration-base) var(--ease-out) both;
}
```

- [ ] **Step 7: Commit**

```bash
git add js/ui.js css/style.css
git commit -m "feat: skeleton screens for collections + preload _collectionTree"
```

---

### Task 5: Local Tag Background Images

**Files:**
- Modify: `js/ui.js` — `getCollectionBgStyle()` and `renderCollectionItemsGrid()`
- Execute: `scripts/download_tag_bg.js` (existing script, needs `public/images/tags/` directory)

**Interfaces:**
- Consumes: Images in `public/images/tags/` (generated by download_tag_bg.js)
- Produces: `background-image: url('/public/images/tags/<slug>.jpg')` on collection cards

- [ ] **Step 1: Ensure public/images/tags/ directory exists**

```bash
mkdir -p public/images/tags
```

- [ ] **Step 2: Run download_tag_bg.js to populate images**

```bash
/d/softwa/nodejs/node scripts/download_tag_bg.js
```

Expected: Downloads ~15 images from Unsplash to `public/images/tags/` with filenames matching the script's tag→keyword mapping.

Verify with:
```bash
ls -la public/images/tags/
```

- [ ] **Step 3: Replace yumus.cn URLs with local paths in getCollectionBgStyle()**

Replace the function at ~line 241-249:

```js
function getCollectionBgStyle(name, seed) {
    const slugMap = {
        '热歌榜单': 'hot-songs', 'KTV必点': 'ktv-must-sing', '华语流行': 'chinese-pop',
        '欧美音乐': 'western-music', '粤语经典': 'yue-yu-jing-dian', '古风国风': 'gu-feng',
        '民谣': 'min-yao', '纯音乐': 'pure-music', '经典怀旧': 'jing-dian-huai-jiu',
        '网络神曲': 'internet-hits', '歌手专区': 'singer-zone', '主题歌单': 'theme-playlist',
    };
    const slug = slugMap[name] || 'default';
    return `background-image: url('/public/images/tags/${slug}.jpg')`;
}
```

- [ ] **Step 4: Replace yumus.cn URLs with local paths in renderCollectionItemsGrid()**

Replace line 279-280 (the bgStyle assignment):

```js
// Before:
const bgStyle = hasBvid
    ? `background-image:url('https://www.yumus.cn/api/?target=img&brand=360&type=${i % 15}&_=${i * 37 + 7}');background-size:cover;background-position:center`
    : '';
// After:
const bgStyle = hasBvid
    ? `background-image:url('/public/images/tags/${(collectionSlug || 'default')}.jpg');background-size:cover;background-position:center`
    : '';
```

**Important:** The function `renderCollectionItemsGrid(items, collectionName)` needs the parent collection's slug. We need to pass it through. Update the function signature and callers.

First, update `renderCollectionItemsGrid` to accept a third parameter `collectionSlug`:
```js
function renderCollectionItemsGrid(items, collectionName, collectionSlug) {
```

Then update the caller in `navigateToCollectionItems` (~line 362):
```js
$.viewContainer.innerHTML = renderCollectionItemsGrid(coll.items, coll.name, coll.slug);
```

And the caller in `navigateToCollectionBySlug` — the `coll` object already has `slug`:
```js
// In navigateToCollectionItems, coll.slug is available since coll comes from _collectionTree
```

That's the only call site. The function is called from `navigateToCollectionItems` only.

- [ ] **Step 5: Add background-image fallback via onerror**

Since CSS `background-image` can't use `onerror`, add a fallback color in the inline style. Update `renderCollectionGrid`'s card div (line 260):

```js
// The --tag-color CSS variable already provides a fallback background color
// via the .tag-card--image class. No JS change needed — if the image
// fails to load, the card shows the gradient fallback color defined by --tag-color.
```

This is already handled by existing CSS. No change needed.

- [ ] **Step 6: Commit**

```bash
git add js/ui.js public/images/tags/
git commit -m "feat: switch tag card backgrounds from yumus.cn to local images"
```

---

### Task 6: Tighten express.static Scope

**Files:**
- Modify: `server.js` — line 82

**Interfaces:**
- Produces: Static files served from `public/`, `js/`, `css/` only; `index.html` and `lyrics.html` directly
- Consumes: None (standalone change)

- [ ] **Step 1: Replace broad express.static with targeted mounts**

Replace line 82:
```js
// Before:
app.use(express.static(__dirname));
// After:
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/lyrics.html', (_req, res) => res.sendFile(path.join(__dirname, 'lyrics.html')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
```

- [ ] **Step 2: Restart server and verify**

```bash
# Kill old server, restart
/d/softwa/nodejs/node server.js
```

Open `http://localhost:8765` and verify:
- Page loads (index.html, js/, css/ all accessible)
- Images load (public/images/tags/)
- Lyrics popup works (lyrics.html)
- 404 on `http://localhost:8765/.env` (previously exposed)
- 404 on `http://localhost:8765/server.js` (previously exposed)

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "fix: narrow express.static to public/, js/, css/ only"
```

---

### Task 7: Optional — withTags Optimization for /api/songs

**Files:**
- Modify: `server.js` — `/api/songs` handler

**Interfaces:**
- Produces: `?withTags=false` skips `attachTags()` call
- Consumed by: `navigateToCollectionSongs()` in ui.js (collection song lists don't display tags)

- [ ] **Step 1: Add withTags parameter to /api/songs**

In `server.js`, modify the `/api/songs` handler. After `formatSong` mapping (line 234), change:

```js
// Before:
const songs = (data || []).map(formatSong).filter(Boolean);
const songsWithTags = await attachTags(songs);
res.json(songsWithTags);

// After:
const songs = (data || []).map(formatSong).filter(Boolean);
const withTags = req.query.withTags !== 'false';  // default true
const result = withTags ? await attachTags(songs) : songs;
res.json(result);
```

- [ ] **Step 2: Pass withTags=false from collection song lists**

In `navigateToCollectionSongs` (~line 374), update the fetch URL:

```js
// Before:
const resp = await fetch(`/api/songs?bvid=${encodeURIComponent(bvid)}&limit=300`);
// After:
const resp = await fetch(`/api/songs?bvid=${encodeURIComponent(bvid)}&limit=300&withTags=false`);
```

- [ ] **Step 3: Commit**

```bash
git add server.js js/ui.js
git commit -m "perf: skip attachTags when withTags=false, used by collection song lists"
```

---

### Task 8: Add Cache-Control to /api/collections

**Files:**
- Modify: `server.js` — `/api/collections` handler

**Interfaces:**
- Produces: Response header `Cache-Control: private, max-age=300`

- [ ] **Step 1: Add cache header**

In the `/api/collections` handler, before `res.json({ collections })` (~line 446):

```js
res.set('Cache-Control', 'private, max-age=300');
res.json({ collections });
```

- [ ] **Step 2: Commit**

```bash
git add server.js
git commit -m "perf: add 5-min Cache-Control to /api/collections"
```
