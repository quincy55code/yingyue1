# 歌曲汇总 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "歌曲汇总" sidebar navigation section with 12 curated song collections, each containing sub-items mapped to Bilibili BV videos.

**Architecture:** Two new DB tables (`collections` + `collection_items`) → one new API endpoint (`GET /api/collections`) + one extended endpoint (`GET /api/songs?bvid=`) → frontend sidebar button + 3 new view states + navigation functions. Follows the same patterns as the existing tags system.

**Tech Stack:** PostgreSQL (Supabase), Node.js Express, vanilla HTML/CSS/JS

## Global Constraints

- Node.js is at `/d/softwa/nodejs/node` (not in PATH as `node`)
- DDL must be executed in Supabase SQL Editor (PostgREST can't do DDL)
- Server runs on port 8765
- Kill server with `taskkill //F //PID <pid>`
- Follow existing IIFE module pattern for `ui.js`
- `formatSong()` maps `start_seconds`→`start_time`, `end_seconds`→`end_time`, `duration_seconds`→`page_duration`

---

### Task 1: Create `collections` and `collection_items` tables (DDL)

**Files:**
- Create: `sql/collections.sql`

**Interfaces:**
- Produces: `collections` table (id, name, slug, sort_order, created_at) and `collection_items` table (id, collection_id FK, title, bvid nullable, sort_order, created_at)

- [ ] **Step 1: Write the DDL file**

```sql
-- sql/collections.sql
-- 歌曲汇总：一级分类 + 子标签表
-- 在 Supabase SQL Editor 中执行：https://supabase.com/dashboard/project/orphftlwdwuvoscizndx/sql/new

CREATE TABLE collections (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    slug        TEXT NOT NULL UNIQUE,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE collection_items (
    id             SERIAL PRIMARY KEY,
    collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    bvid           TEXT DEFAULT NULL,
    sort_order     INTEGER DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collection_items_collection_id ON collection_items(collection_id);
CREATE INDEX idx_collection_items_bvid ON collection_items(bvid) WHERE bvid IS NOT NULL;

COMMENT ON TABLE collections IS '歌曲汇总一级分类';
COMMENT ON TABLE collection_items IS '歌曲汇总子标签（BV视频入口）';
COMMENT ON COLUMN collection_items.bvid IS 'B站BV号，主题歌单类为NULL表示占位无歌曲';
```

- [ ] **Step 2: Execute DDL in Supabase SQL Editor**

Open `https://supabase.com/dashboard/project/orphftlwdwuvoscizndx/sql/new`, paste the SQL, and run.

- [ ] **Step 3: Verify tables exist**

```bash
SERVICE_KEY="<from .env>"
curl -s "https://orphftlwdwuvoscizndx.supabase.co/rest/v1/collections?limit=1" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY"
# Expected: [] (empty array, table exists)
```

- [ ] **Step 4: Commit**

```bash
git add sql/collections.sql
git commit -m "feat: add collections and collection_items tables DDL"
```

---

### Task 2: Seed collections and collection_items data

**Files:**
- Create: `sql/seed_collections.sql`

**Interfaces:**
- Produces: 12 rows in `collections` table + ~33 rows in `collection_items` table
- Consumes: `collections` and `collection_items` tables from Task 1

- [ ] **Step 1: Write the seed SQL file**

```sql
-- sql/seed_collections.sql
-- 歌曲汇总种子数据
-- 在 Supabase SQL Editor 中执行此文件

-- 一级分类（12个）
INSERT INTO collections (name, slug, sort_order) VALUES
  ('热歌榜单', 'hot-songs', 1),
  ('KTV必点', 'ktv-must-sing', 2),
  ('华语流行', 'hua-yu-liu-xing', 3),
  ('欧美音乐', 'ou-mei-yin-yue', 4),
  ('粤语经典', 'yue-yu-jing-dian', 5),
  ('古风国风', 'gu-feng-guo-feng', 6),
  ('民谣', 'min-yao', 7),
  ('纯音乐', 'chun-yin-yue', 8),
  ('经典怀旧', 'jing-dian-huai-jiu', 9),
  ('网络神曲', 'wang-luo-shen-qu', 10),
  ('歌手专区', 'ge-shou-zhuan-qu', 11),
  ('主题歌单', 'theme-lists', 12);

-- 子标签（按 collection slug 关联，避免硬编码 ID）
INSERT INTO collection_items (collection_id, title, bvid, sort_order) VALUES
  -- 热歌榜单（9个）
  ((SELECT id FROM collections WHERE slug = 'hot-songs'), '网易云10W+热歌200首', 'BV1vm411Z7ZN', 1),
  ((SELECT id FROM collections WHERE slug = 'hot-songs'), '2024热评榜首100首', 'BV1vg4y1U7Xf', 2),
  ((SELECT id FROM collections WHERE slug = 'hot-songs'), '2025最新流行热歌', 'BV13icVeSENi', 3),
  ((SELECT id FROM collections WHERE slug = 'hot-songs'), '全网热歌TOP100', 'BV1EPt7eGEH3', 4),
  ((SELECT id FROM collections WHERE slug = 'hot-songs'), 'B站热歌榜94期', 'BV16aEz68EBS', 5),
  ((SELECT id FROM collections WHERE slug = 'hot-songs'), '2026年5月最火50首', 'BV1GxVU6oEWW', 6),
  ((SELECT id FROM collections WHERE slug = 'hot-songs'), '网易云VIP热歌榜', 'BV1bzqbY8Ees', 7),
  ((SELECT id FROM collections WHERE slug = 'hot-songs'), '2026上半年最火100首', 'BV17vLz62EHG', 8),
  ((SELECT id FROM collections WHERE slug = 'hot-songs'), 'B站欧美神曲100期', 'BV1ueL96CEXN', 9),
  -- KTV必点（3个）
  ((SELECT id FROM collections WHERE slug = 'ktv-must-sing'), '00后KTV必点', 'BV1SrbkzxEVi', 1),
  ((SELECT id FROM collections WHERE slug = 'ktv-must-sing'), '8090后KTV必点200首', 'BV1Ei421i7mm', 2),
  ((SELECT id FROM collections WHERE slug = 'ktv-must-sing'), '百首华语代表作', 'BV1qpsPznEWJ', 3),
  -- 华语流行（6个）
  ((SELECT id FROM collections WHERE slug = 'hua-yu-liu-xing'), '治愈华语女声歌单', 'BV1pr6aYiE97', 1),
  ((SELECT id FROM collections WHERE slug = 'hua-yu-liu-xing'), '111首华语经典', 'BV1fDqiYNEuf', 2),
  ((SELECT id FROM collections WHERE slug = 'hua-yu-liu-xing'), '百首华语代表作', 'BV1qpsPznEWJ', 3),
  ((SELECT id FROM collections WHERE slug = 'hua-yu-liu-xing'), '150首华语热歌', 'BV1NURNBtETP', 4),
  ((SELECT id FROM collections WHERE slug = 'hua-yu-liu-xing'), '华语神仙打架', 'BV1Mv411p78Q', 5),
  ((SELECT id FROM collections WHERE slug = 'hua-yu-liu-xing'), '破亿播放华语歌', 'BV1Mv411p78Q', 6),
  -- 欧美音乐（8个）
  ((SELECT id FROM collections WHERE slug = 'ou-mei-yin-yue'), '50首经典英文歌', 'BV1sM4y1z7G8', 1),
  ((SELECT id FROM collections WHERE slug = 'ou-mei-yin-yue'), '40首欧美顶流', 'BV15hV36ZENH', 2),
  ((SELECT id FROM collections WHERE slug = 'ou-mei-yin-yue'), '40首上头欧美歌', 'BV1RFAkzPEij', 3),
  ((SELECT id FROM collections WHERE slug = 'ou-mei-yin-yue'), '超好听英文歌', 'BV1PSNPe9EJg', 4),
  ((SELECT id FROM collections WHERE slug = 'ou-mei-yin-yue'), '100首经典英文歌', 'BV1j4EM6aELa', 5),
  ((SELECT id FROM collections WHERE slug = 'ou-mei-yin-yue'), 'B站欧美神曲100期', 'BV1ueL96CEXN', 6),
  ((SELECT id FROM collections WHERE slug = 'ou-mei-yin-yue'), '西城男孩精选20首', 'BV1BALF6NENq', 7),
  ((SELECT id FROM collections WHERE slug = 'ou-mei-yin-yue'), '霉霉精选40首', 'BV1ChR7B4ECE', 8),
  -- 粤语经典（2个）
  ((SELECT id FROM collections WHERE slug = 'yue-yu-jing-dian'), '百首粤语经典', 'BV1tyKceWETg', 1),
  ((SELECT id FROM collections WHERE slug = 'yue-yu-jing-dian'), '粤语经典重温', 'BV1xZ6gYLEWZ', 2),
  -- 古风国风（2个）
  ((SELECT id FROM collections WHERE slug = 'gu-feng-guo-feng'), '炸裂古风戏腔', 'BV1Ko6dYCEQv', 1),
  ((SELECT id FROM collections WHERE slug = 'gu-feng-guo-feng'), '100首超好听古风', 'BV1cUjW61EFN', 2),
  -- 民谣（1个）
  ((SELECT id FROM collections WHERE slug = 'min-yao'), '治愈民谣酒馆', 'BV1rDqKYXEfg', 1),
  -- 纯音乐（2个）
  ((SELECT id FROM collections WHERE slug = 'chun-yin-yue'), '100首绝美纯音乐', 'BV1xh68YvEij', 1),
  ((SELECT id FROM collections WHERE slug = 'chun-yin-yue'), '100首超好听纯音乐', 'BV1FEQuBXEn1', 2),
  -- 经典怀旧（5个）
  ((SELECT id FROM collections WHERE slug = 'jing-dian-huai-jiu'), '8090一人一首成名曲', 'BV1Tm411973h', 1),
  ((SELECT id FROM collections WHERE slug = 'jing-dian-huai-jiu'), '滚石经典歌曲合集', 'BV1QC4y1P7YG', 2),
  ((SELECT id FROM collections WHERE slug = 'jing-dian-huai-jiu'), '00年代华语金曲TOP100', 'BV16FkMYPEeb', 3),
  ((SELECT id FROM collections WHERE slug = 'jing-dian-huai-jiu'), '150首怀旧金曲', 'BV1gT5Y6mEXM', 4),
  ((SELECT id FROM collections WHERE slug = 'jing-dian-huai-jiu'), '100首经典老歌', 'BV1RnEL6UEkY', 5),
  -- 网络神曲（5个）
  ((SELECT id FROM collections WHERE slug = 'wang-luo-shen-qu'), '100首经典网络神曲', 'BV1ToBCYME8m', 1),
  ((SELECT id FROM collections WHERE slug = 'wang-luo-shen-qu'), '100首经典网络神曲', 'BV1AqmaYREDm', 2),
  ((SELECT id FROM collections WHERE slug = 'wang-luo-shen-qu'), '90后MP3金曲', 'BV168411o7Bh', 3),
  ((SELECT id FROM collections WHERE slug = 'wang-luo-shen-qu'), '网吧通宵130首神曲', 'BV1Y2w4zXEJ9', 4),
  ((SELECT id FROM collections WHERE slug = 'wang-luo-shen-qu'), '90后150首网络神曲', 'BV1GSEj6UEaN', 5),
  -- 歌手专区（5个）
  ((SELECT id FROM collections WHERE slug = 'ge-shou-zhuan-qu'), '周深神仙嗓音', 'BV1Wg4heQEQU', 1),
  ((SELECT id FROM collections WHERE slug = 'ge-shou-zhuan-qu'), '周杰伦100首合集', 'BV1e9Lo64EJx', 2),
  ((SELECT id FROM collections WHERE slug = 'ge-shou-zhuan-qu'), '许嵩歌曲合集', 'BV1KXjF6REto', 3),
  ((SELECT id FROM collections WHERE slug = 'ge-shou-zhuan-qu'), '西城男孩精选20首', 'BV1BALF6NENq', 4),
  ((SELECT id FROM collections WHERE slug = 'ge-shou-zhuan-qu'), '霉霉精选40首', 'BV1ChR7B4ECE', 5),
  -- 主题歌单（5个，bvid=NULL 占位无歌曲）
  ((SELECT id FROM collections WHERE slug = 'theme-lists'), '治愈', NULL, 1),
  ((SELECT id FROM collections WHERE slug = 'theme-lists'), '睡前', NULL, 2),
  ((SELECT id FROM collections WHERE slug = 'theme-lists'), '学习', NULL, 3),
  ((SELECT id FROM collections WHERE slug = 'theme-lists'), '开车', NULL, 4),
  ((SELECT id FROM collections WHERE slug = 'theme-lists'), '伤感', NULL, 5);
```

- [ ] **Step 2: Execute seed SQL in Supabase SQL Editor**

Open `https://supabase.com/dashboard/project/orphftlwdwuvoscizndx/sql/new`, paste the SQL, and run.

- [ ] **Step 3: Verify seed data**

```bash
SERVICE_KEY="<from .env>"
# Check collections
curl -s "https://orphftlwdwuvoscizndx.supabase.co/rest/v1/collections?select=*&order=sort_order" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY"
# Expected: 12 rows

# Check items for one collection
curl -s "https://orphftlwdwuvoscizndx.supabase.co/rest/v1/collection_items?select=*&collection_id=eq.1&order=sort_order" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY"
# Expected: 9 rows for 热歌榜单
```

- [ ] **Step 4: Commit**

```bash
git add sql/seed_collections.sql
git commit -m "feat: seed collections and collection_items data"
```

---

### Task 3: Add `GET /api/collections` endpoint to server.js

**Files:**
- Modify: `server.js` — insert new endpoint before `GET /api/stream/:songId` (around line 349)

**Interfaces:**
- Consumes: `collections`, `collection_items`, `songs` tables
- Produces: `GET /api/collections` → `{ collections: [{ id, name, slug, song_count, items: [{ id, title, bvid, song_count }] }] }`

- [ ] **Step 1: Add the endpoint in server.js**

Insert the following code block **after** the `/api/tags` endpoint (after line 348) and **before** `GET /api/stream/:songId` (line 350):

```js
/** GET /api/collections — 歌曲汇总树（一级分类 + 子标签 + 歌曲计数） */
app.get('/api/collections', async (_req, res) => {
    try {
        // 1. 查询所有一级分类
        const { data: cols, error: colErr } = await supabase
            .from('collections')
            .select('id, name, slug, sort_order')
            .order('sort_order', { ascending: true });

        if (colErr) {
            console.error('[collections]', colErr.message);
            return res.status(500).json({ error: '获取分类失败' });
        }

        if (!cols || cols.length === 0) {
            return res.json({ collections: [] });
        }

        // 2. 查询所有子标签
        const { data: items } = await supabase
            .from('collection_items')
            .select('id, collection_id, title, bvid, sort_order')
            .order('sort_order', { ascending: true });

        const allItems = items || [];

        // 3. 批量计算每个 bvid 的歌曲数（一次 GROUP BY 查询）
        const bvids = [...new Set(allItems.map(it => it.bvid).filter(Boolean))];
        let bvidCountMap = {};
        if (bvids.length > 0) {
            const { data: countRows } = await supabase
                .from('songs')
                .select('bvid')
                .in('bvid', bvids);

            for (const row of (countRows || [])) {
                bvidCountMap[row.bvid] = (bvidCountMap[row.bvid] || 0) + 1;
            }
        }

        // 4. 按 collection_id 分组 items，构建树
        const itemMap = {};
        for (const it of allItems) {
            if (!itemMap[it.collection_id]) itemMap[it.collection_id] = [];
            itemMap[it.collection_id].push(it);
        }

        const collections = cols.map(c => {
            const colItems = (itemMap[c.id] || []).map(it => ({
                id: it.id,
                title: it.title,
                bvid: it.bvid || null,
                song_count: it.bvid ? (bvidCountMap[it.bvid] || 0) : 0,
            }));
            const totalSongCount = colItems.reduce((sum, it) => sum + it.song_count, 0);
            return {
                id: c.id,
                name: c.name,
                slug: c.slug,
                song_count: totalSongCount,
                items: colItems,
            };
        });

        res.json({ collections });
    } catch (err) {
        console.error('[collections]', err.message);
        res.status(500).json({ error: '获取分类失败' });
    }
});
```

- [ ] **Step 2: Start server and test the endpoint**

```bash
# Kill existing server process first
netstat -ano | grep 8765
# taskkill //F //PID <pid>

# Start server
/d/softwa/nodejs/node server.js &

# Wait a moment, then test
curl -s http://localhost:8765/api/collections | head -c 500
# Expected: JSON with "collections" array, 12 entries
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add GET /api/collections endpoint"
```

---

### Task 4: Extend `GET /api/songs` with `?bvid=` support

**Files:**
- Modify: `server.js` — modify the existing `/api/songs` handler (lines 160-218)

**Interfaces:**
- Produces: `GET /api/songs?bvid=BVxxx` returns songs filtered by bvid, ordered by page, with `limit` support
- Constraint: `?tag=` and `?bvid=` are mutually exclusive (only one filter is applied)

- [ ] **Step 1: Modify the `/api/songs` handler in server.js**

Replace the existing `/api/songs` route (lines 159-218) with this updated version:

```js
/** GET /api/songs — 查询歌曲（支持按标签、BV号筛选 + 可选返回数量） */
app.get('/api/songs', async (req, res) => {
    try {
        const tagName = (req.query.tag || '').trim();
        const bvid = (req.query.bvid || '').trim();
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);

        let songIds = null;

        // 如果指定了标签，先查出对应的 song_id 列表
        if (tagName) {
            const { data: tagRow } = await supabase
                .from('tags')
                .select('id')
                .eq('name', tagName)
                .single();

            if (!tagRow) {
                return res.json([]);
            }

            const { data: stRows } = await supabase
                .from('song_tags')
                .select('song_id')
                .eq('tag_id', tagRow.id);

            songIds = (stRows || []).map(r => r.song_id);
            if (songIds.length === 0) {
                return res.json([]);
            }
        }

        // 构建查询
        let query = supabase
            .from('songs')
            .select('id,title,singer,bvid,page,start_seconds,end_seconds,duration_seconds,cover_url,bilibili_url')
            .limit(limit);

        // 按 bvid 筛选 → 按 page 排序
        if (bvid) {
            query = query.eq('bvid', bvid).order('page', { ascending: true });
        } else {
            query = query.order('id', { ascending: true });
        }

        // 如果有标签筛选，添加 in 过滤
        if (songIds) {
            query = query.in('id', songIds.slice(0, 300));
        }

        const { data, error } = await query;

        if (error) {
            console.error('[songs] Supabase error:', error.message);
            return res.status(500).json({ error: '获取歌曲列表失败' });
        }

        const songs = (data || []).map(formatSong).filter(Boolean);
        const songsWithTags = await attachTags(songs);

        res.json(songsWithTags);
    } catch (err) {
        console.error('[songs]', err.message);
        res.status(500).json({ error: '获取歌曲列表失败' });
    }
});
```

Key changes from the original:
1. Added `bvid` query parameter extraction
2. When `bvid` is provided, use `.eq('bvid', bvid).order('page', ...)` instead of `.order('id', ...)`
3. `?tag=` and `?bvid=` are implicitly mutually exclusive — if both provided, tag takes priority for filtering but bvid still determines sort order (unlikely to happen in practice)

- [ ] **Step 2: Test the endpoint**

```bash
# Test with known bvid from seed data
curl -s "http://localhost:8765/api/songs?bvid=BV1pr6aYiE97&limit=5"
# Expected: up to 5 songs with bvid=BV1pr6aYiE97, ordered by page

# Test that tag filtering still works
curl -s "http://localhost:8765/api/songs?tag=粤语&limit=3"
# Expected: up to 3 songs with "粤语" tag

# Test default (no filter)
curl -s "http://localhost:8765/api/songs?limit=3"
# Expected: first 3 songs by id
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add ?bvid= filter support to GET /api/songs"
```

---

### Task 5: Add sidebar button in index.html

**Files:**
- Modify: `index.html` — add one `<button>` in `.sidebar-nav`

- [ ] **Step 1: Add the sidebar button**

In `index.html`, add a new button inside `.sidebar-nav` between "分类浏览" (line 41-44) and "我的收藏" (line 45-48):

```html
                <button class="sidebar-item" data-nav="collection" data-action="nav-collection">
                    <span class="sidebar-item-icon">📊</span>
                    <span class="sidebar-item-label">歌曲汇总</span>
                </button>
```

The result should look like (lines 36-53):

```html
            <div class="sidebar-nav" id="sidebarNav">
                <button class="sidebar-item active" data-nav="home" data-action="nav-home">
                    <span class="sidebar-item-icon">🏠</span>
                    <span class="sidebar-item-label">首页</span>
                </button>
                <button class="sidebar-item" data-nav="tags" data-action="nav-tags">
                    <span class="sidebar-item-icon">🏷️</span>
                    <span class="sidebar-item-label">分类浏览</span>
                </button>
                <button class="sidebar-item" data-nav="collection" data-action="nav-collection">
                    <span class="sidebar-item-icon">📊</span>
                    <span class="sidebar-item-label">歌曲汇总</span>
                </button>
                <button class="sidebar-item" data-nav="favorites" data-action="nav-favorites">
                    <span class="sidebar-item-icon">⭐</span>
                    <span class="sidebar-item-label">我的收藏</span>
                    <span class="sidebar-badge" id="sidebarFavCount" style="display:none">0</span>
                </button>
                <button class="sidebar-item" data-nav="playlists" data-action="nav-playlists">
                    <span class="sidebar-item-icon">📋</span>
                    <span class="sidebar-item-label">我的歌单</span>
                </button>
            </div>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add 歌曲汇总 sidebar button"
```

---

### Task 6: Add collection navigation and rendering in ui.js

**Files:**
- Modify: `js/ui.js` — add state variables, navigation functions, rendering function, goBack extension, and event delegation handlers

**Interfaces:**
- Consumes: `GET /api/collections`, `GET /api/songs?bvid=` from Tasks 3-4
- Produces: `_currentCollectionData` (shared state), `navigateToCollection()`, `navigateToCollectionItems()`, `navigateToCollectionSongs()`, extended `goBack()`

- [ ] **Step 1: Add state variables**

At the top of the UI IIFE (after `let _searchTimer = null;` on line 14), add:

```js
    let _currentCollectionData = null;  // 当前查看的 collection 对象（用于 goBack）
    let _collectionTree = null;         // /api/collections 返回的完整树缓存
```

- [ ] **Step 2: Add the icon map and rendering function**

Add this new function after `renderStarCards()` (after line 308, before `// ========== 视图导航 ==========` comment on line 310):

```js
    // ========== 歌曲汇总：分类卡片渲染 ==========
    const COLLECTION_ICONS = {
        '热歌榜单': '🔥', 'KTV必点': '🎤', '华语流行': '🎵', '欧美音乐': '🌍',
        '粤语经典': '🇭🇰', '古风国风': '🏮', '民谣': '🪕', '纯音乐': '🎹',
        '经典怀旧': '📻', '网络神曲': '🌐', '歌手专区': '🎙️', '主题歌单': '📋',
    };

    function getCollectionBgStyle(name, seed) {
        const typeMap = {
            '热歌榜单': 0, 'KTV必点': 8, '华语流行': 3, '欧美音乐': 10,
            '粤语经典': 5, '古风国风': 4, '民谣': 7, '纯音乐': 14,
            '经典怀旧': 2, '网络神曲': 12, '歌手专区': 6, '主题歌单': 1,
        };
        const type = typeMap[name] !== undefined ? typeMap[name] : 0;
        return `background-image: url('https://www.yumus.cn/api/?target=img&brand=360&type=${type}&_=${seed}')`;
    }

    function renderCollectionGrid(collections) {
        if (!collections || !collections.length) {
            return '<div class="empty-state"><span class="empty-icon">📊</span>暂无分类</div>';
        }
        let html = '<div class="tag-grid">';
        collections.forEach((c, i) => {
            const icon = COLLECTION_ICONS[c.name] || '🎵';
            const bgStyle = getCollectionBgStyle(c.name, i * 47 + 13);
            html += `
            <div class="tag-card tag-card--image" style="--tag-color:${getCoverFallbackColor(i)};--stagger-index:${Math.min(i, 19)};${bgStyle};background-color:var(--bg-surface);background-size:cover;background-position:center" data-action="navigate-collection-item" data-collection-id="${c.id}">
                <div class="tag-card-name">${icon} ${escapeHtml(c.name)}</div>
            </div>`;
        });
        html += '</div>';
        return html;
    }

    function renderCollectionItemsGrid(items, collectionName) {
        if (!items || !items.length) {
            return `<div class="empty-state"><span class="empty-icon">📋</span>${escapeHtml(collectionName)}暂无子分类</div>`;
        }
        let html = '<div class="tag-grid">';
        items.forEach((it, i) => {
            const songCount = (it.song_count || 0) > 0 ? ` · ${it.song_count}首` : '';
            const hasSongs = it.bvid && it.song_count > 0;
            const action = hasSongs ? 'navigate-collection-songs' : '';
            const bgSeed = i * 53 + 19;
            const bgStyle = hasSongs
                ? `background-image: url('https://www.yumus.cn/api/?target=img&brand=360&type=7&_=${bgSeed}')`
                : '';
            html += `
            <div class="tag-card tag-card--image ${!hasSongs ? 'tag-card--empty' : ''}" style="--tag-color:${getCoverFallbackColor(i)};--stagger-index:${Math.min(i, 19)};${bgStyle};background-color:var(--bg-surface);background-size:cover;background-position:center" data-action="${action}" data-bvid="${escapeHtml(it.bvid || '')}" data-item-title="${escapeHtml(it.title)}">
                <div class="tag-card-name">${escapeHtml(it.title)}${songCount}</div>
            </div>`;
        });
        html += '</div>';
        return html;
    }
```

- [ ] **Step 3: Add navigation functions**

Add these three functions after `navigateToTags()` (after line 413, before `findTagName()` on line 415):

```js
    // ========== 歌曲汇总导航 ==========
    async function navigateToCollection() {
        _currentView = 'collection';
        _currentCollectionData = null;
        updateViewHeader(false, '');
        $.sectionHeader.style.display = '';
        $.sectionHeader.textContent = '📊 歌曲汇总';
        setActiveSidebarNav('collection');
        $.viewContainer.innerHTML = '<div class="empty-state"><span class="empty-icon">⏳</span>加载中…</div>';

        try {
            const resp = await fetch('/api/collections');
            if (!resp.ok) throw new Error('加载失败');
            const data = await resp.json();
            _collectionTree = data.collections || [];
            $.viewContainer.innerHTML = renderCollectionGrid(_collectionTree);
        } catch (e) {
            $.viewContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span>加载失败<br><small>${escapeHtml(e.message)}</small></div>`;
        }
    }

    function navigateToCollectionItems(collId) {
        if (!_collectionTree) return;
        const coll = _collectionTree.find(c => c.id === collId);
        if (!coll) return;

        _currentView = 'collection-items';
        _currentCollectionData = coll;
        updateViewHeader(true, coll.name);
        $.viewContainer.innerHTML = renderCollectionItemsGrid(coll.items, coll.name);
    }

    async function navigateToCollectionSongs(bvid, title) {
        if (!bvid) return;

        _currentView = 'collection-songs';
        updateViewHeader(true, title);

        $.viewContainer.innerHTML = '<div class="empty-state"><span class="empty-icon">⏳</span>加载中…</div>';

        try {
            const resp = await fetch(`/api/songs?bvid=${encodeURIComponent(bvid)}&limit=50`);
            if (!resp.ok) throw new Error('加载失败');
            const songs = await resp.json();
            if (!songs || !songs.length) {
                $.viewContainer.innerHTML = '<div class="empty-state"><span class="empty-icon">🎵</span>暂无歌曲</div>';
                return;
            }
            window._currentSongs = songs;
            window._currentPlaylist = null;
            $.viewContainer.innerHTML = renderCoverGrid(songs);
            bindCardClicks();
        } catch (e) {
            $.viewContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span>加载失败<br><small>${escapeHtml(e.message)}</small></div>`;
        }
    }
```

(Both `_currentCollectionData` and `_collectionTree` were already declared in Step 1 above.)

- [ ] **Step 4: Extend goBack()**

Replace the existing `goBack()` function (lines 365-386) with:

```js
    function goBack() {
        if (_currentView === 'collection-songs') {
            // 从歌曲列表返回子标签列表
            if (_currentCollectionData) {
                navigateToCollectionItems(_currentCollectionData.id);
            } else {
                navigateToCollection();
            }
        } else if (_currentView === 'collection-items') {
            // 从子标签列表返回分类总览
            navigateToCollection();
        } else if (_currentView === 'collection') {
            // 从分类总览返回首页
            navigateHome();
        } else if (_currentView === 'star') {
            // 从星之子分类返回音乐分类总览
            navigateToTags();
        } else if (_currentView === 'tag') {
            // 如果来自某个父标签的子分类，返回子分类列表
            if (_currentStarParent && _currentStarParent.children && _currentStarParent.children.length) {
                _currentView = 'star';
                _currentTagId = _currentStarParent.id;
                updateViewHeader(true, _currentStarParent.name);
                $.viewContainer.innerHTML = renderStarCards(_currentStarParent);
            } else {
                navigateToTags();
            }
        } else if (_currentView === 'tags') {
            navigateHome();
        } else if (_currentView === 'favorites') {
            navigateHome();
        } else if (_currentView === 'playlists') {
            navigateHome();
        }
    }
```

- [ ] **Step 5: Add event delegation handlers**

In `setupGlobalDelegation()`, inside the `document.body` click listener, add the three new actions after the existing `action === 'navigate-star'` block (after line 1036):

```js
            if (action === 'nav-collection') {
                e.preventDefault();
                await navigateToCollection();
                return;
            }
            if (action === 'navigate-collection-item') {
                const collId = parseInt(btn.dataset.collectionId);
                if (collId) navigateToCollectionItems(collId);
                return;
            }
            if (action === 'navigate-collection-songs') {
                const bvid = btn.dataset.bvid;
                const itemTitle = btn.dataset.itemTitle || '';
                if (bvid) await navigateToCollectionSongs(bvid, itemTitle);
                return;
            }
```

- [ ] **Step 6: Test in browser**

```bash
# Ensure server is running
/d/softwa/nodejs/node server.js &
```

Open `http://localhost:8765` in a browser:
1. Click "📊 歌曲汇总" in sidebar → should show 12 collection cards
2. Click "华语流行" → should show sub-item cards with song counts
3. Click "治愈华语女声歌单" → should show song cover grid
4. Click "← 返回" → should go back through the navigation chain
5. Click "主题歌单" → should show 5 placeholder items (治愈、睡前、学习、开车、伤感) with no click action
6. Verify sidebar active state highlights "歌曲汇总" when in collection views

- [ ] **Step 7: Commit**

```bash
git add js/ui.js
git commit -m "feat: add collection navigation, rendering, and goBack extension"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] Sidebar shows "📊 歌曲汇总" between "分类浏览" and "我的收藏"
- [ ] Clicking "歌曲汇总" shows 12 category cards with icons and wallpapers
- [ ] Clicking a category (e.g. "华语流行") shows its sub-items with song counts
- [ ] Clicking a sub-item with songs (e.g. "治愈华语女声歌单") shows song cover grid
- [ ] Clicking a song plays it correctly
- [ ] ← Back button works through all 3 levels: songs → items → collections → home
- [ ] "主题歌单" shows 5 placeholder items (no bvid, no click action)
- [ ] `GET /api/collections` returns valid JSON with correct song counts
- [ ] `GET /api/songs?bvid=BVxxx` returns songs filtered and sorted by page
- [ ] Existing functionality (tags, favorites, playlists, search) still works
