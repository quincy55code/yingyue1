# 歌曲汇总 — 设计规格

**日期**：2026-06-23  
**状态**：待实施

## 概述

在左侧 sidebar 新增"歌曲汇总"导航项，包含 12 个一级分类，每个分类下有子标签（简化后标题），每个子标签对应一个 B站 BV 号，点击后展示该 BV 下所有歌曲（歌曲已存在于 `songs` 表）。

## 数据库变更（DDL）

在 Supabase SQL Editor 中执行，新增两张表：

### `collections` — 一级分类

```sql
CREATE TABLE collections (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,   -- 热歌榜单、KTV必点…
    slug        TEXT NOT NULL UNIQUE,   -- hot-songs, ktv-must-sing…
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `collection_items` — 子标签

```sql
CREATE TABLE collection_items (
    id             SERIAL PRIMARY KEY,
    collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,       -- 简化后标题
    bvid           TEXT DEFAULT NULL,   -- BV号，主题歌单类为 NULL
    sort_order     INTEGER DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**关系**：
- `collections` ← `collection_items`（一对多，外键 `collection_id`）
- `collection_items.bvid` → `songs.bvid`（隐式关联，不设外键约束）

## 种子数据

12 个一级分类 + ~30 个子标签（BV 映射见用户提供表格）。`主题歌单` 的子标签（治愈、睡前、学习、开车、伤感）`bvid` 为 NULL，暂不关联歌曲。

种子 SQL 写入 `sql/seed_collections.sql`。

## 后端 API

### 新增：`GET /api/collections`

返回完整分类树，含每层歌曲数：

```json
{
  "collections": [
    {
      "id": 1,
      "name": "华语流行",
      "slug": "hua-yu-liu-xing",
      "song_count": 550,
      "items": [
        {
          "id": 1,
          "title": "治愈华语女声歌单",
          "bvid": "BV1pr6aYiE97",
          "song_count": 100
        }
      ]
    }
  ]
}
```

**实现逻辑**：
1. 查询 `collections` 表（`ORDER BY sort_order`）
2. 查询 `collection_items` 表，按 `collection_id` 分组
3. 批量计算 song_count：`SELECT bvid, COUNT(*) FROM songs WHERE bvid = ANY($bvids) GROUP BY bvid`（1 次查询）
4. 顶级 `song_count` = 子标签 `song_count` 之和

### 扩展：`GET /api/songs?bvid=BVxxx`

在现有 `/api/songs` 端点新增 `bvid` 查询参数：

```sql
SELECT * FROM songs WHERE bvid = 'BV1pr6aYiE97' ORDER BY page
```

- `?tag=` 和 `?bvid=` 互斥
- `?limit=` 依然生效（默认 10，最大 50）

## 前端

### HTML（index.html）

侧边栏 `.sidebar-nav` 中新增按钮（放在「分类浏览」和「我的收藏」之间）：

```html
<button class="sidebar-item" data-nav="collection" data-action="nav-collection">
  📊 歌曲汇总
</button>
```

### JS（ui.js）

#### 新增视图状态

- `_currentView = 'collection'` — 12 个分类卡片
- `_currentView = 'collection-items'` — 子标签卡片
- `_currentView = 'collection-songs'` — 歌曲封面网格

#### 新增函数

| 函数 | 职责 |
|------|------|
| `navigateToCollection()` | `GET /api/collections` → 渲染 12 个分类卡片 |
| `navigateToCollectionItems(coll)` | 点击分类 → 渲染子标签卡片 |
| `navigateToCollectionSongs(bvid, title)` | `GET /api/songs?bvid=...` → `renderCoverGrid()` |

#### 事件委托新增

```js
if (action === 'nav-collection')              → navigateToCollection()
if (action === 'navigate-collection-item')    → navigateToCollectionItems(coll)
if (action === 'navigate-collection-songs')   → navigateToCollectionSongs(bvid, title)
```

#### goBack() 扩展

```
collection-songs → collection-items → collection → home
```

#### 分类图标硬编码

| 分类 | 图标 |
|------|------|
| 热歌榜单 | 🔥 |
| KTV必点 | 🎤 |
| 华语流行 | 🎵 |
| 欧美音乐 | 🌍 |
| 粤语经典 | 🇭🇰 |
| 古风国风 | 🏮 |
| 民谣 | 🪕 |
| 纯音乐 | 🎹 |
| 经典怀旧 | 📻 |
| 网络神曲 | 🌐 |
| 歌手专区 | 🎙️ |
| 主题歌单 | 📋 |

### CSS

复用现有 `.tag-card` / `.cover-card` 样式体系，无需新 CSS。

## 实施步骤

1. 在 Supabase SQL Editor 执行 DDL（创建 `collections` + `collection_items` 表）
2. 执行种子 SQL（`sql/seed_collections.sql`）
3. 在 `server.js` 新增 `GET /api/collections` 端点
4. 在 `server.js` 的 `GET /api/songs` 增加 `?bvid=` 支持
5. 在 `index.html` 侧边栏新增按钮
6. 在 `ui.js` 新增导航函数、事件委托、goBack 扩展
