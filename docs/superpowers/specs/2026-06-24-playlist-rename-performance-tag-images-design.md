# Design: 歌单改名 + 性能优化 + 标签图片本地化

**Date:** 2026-06-24
**Status:** Draft

## Overview

五个改进点，覆盖功能补全（歌单改名）、性能优化（汇总加载、整体速度）、视觉提升（加载骨架屏、标签图片本地化）。

---

## 1. 歌单改名（内联编辑）

### 1.1 后端：PATCH /api/playlists/:id

- **认证**：`authMiddleware` 验证 JWT
- **参数**：`{ name: string }` — 1-100 字符，trim 后非空
- **逻辑**：
  1. 查询 playlist 验证 `user_id` 所有权
  2. 检查新名字在当前用户下是否唯一（同名 → 409）
  3. `supabaseAdmin.from('playlists').update({ name }).eq('id', id)`
- **响应**：`{ id, name, updated_at }`

### 1.2 前端：PlaylistStore.renamePlaylist(id, newName)

```js
async renamePlaylist(id, newName) {
  const old = _playlistsCache.find(p => p.id === id);
  // 乐观更新
  if (old) { old.name = newName; old._optimistic = true; }
  _notify();
  try {
    const resp = await fetch(`/api/playlists/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...Auth.getAuthHeaders() },
      body: JSON.stringify({ name: newName.trim() })
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || '重命名失败');
    }
    const updated = await resp.json();
    // 用服务器返回值替换缓存
    const idx = _playlistsCache.findIndex(p => p.id === id);
    if (idx >= 0) _playlistsCache[idx] = { ..._playlistsCache[idx], ...updated, _optimistic: false };
    _notify();
  } catch (e) {
    // 回滚
    if (old) old.name = old._nameBeforeRename || old.name;
    _notify();
    throw e;
  }
}
```

### 1.3 前端 UI

- 在歌单列表渲染中，歌单名字用 `<span class="playlist-name" data-action="rename-playlist" data-id="${id}">` 包裹
- 点击名字 → `contenteditable` 或替换为 `<input>`：
  - 显示输入框，预填当前名字，自动聚焦并全选
  - Enter / 失焦 → 校验非空 → 调用 `PlaylistStore.renamePlaylist()` → 恢复为文本
  - Esc → 取消，恢复原名
- 视觉：输入框继承原文字样式（颜色、字号），底部加一条细下划线表示编辑态

---

## 2. 歌曲汇总提速

### 2.1 预加载 Collections

- 首页 `init()` 时，在 `Promise.all([fetchSongs, fetchTags])` 之外加一个**不阻塞**的预加载：
  ```js
  fetch('/api/collections').then(r => r.json()).then(d => {
    _collectionTree = d.collections || [];
  }).catch(() => {});
  ```
- 这样用户点"歌曲汇总"时大概率缓存已就绪，几乎零等待

### 2.2 侧边栏快捷入口优化

- `navigateToCollectionBySlug()` 已有缓存检查，如果 `_collectionTree` 存在则直接使用
- 预加载策略（2.1）让首次点击也大概率命中缓存

### 2.3 API 响应头

- `/api/collections` 加短时缓存头（`Cache-Control: private, max-age=300`），浏览器 5 分钟内不重复请求

---

## 3. 骨架屏（Skeleton Loading）

### 3.1 替换所有 `⏳加载中…`

现有加载占位符出现位置：
- 歌曲汇总首页（`navigateToCollection`）
- 子分类列表（`navigateToCollectionItems`）
- 歌曲列表（`navigateToCollectionSongs`）
- 搜索结果
- 标签视图

全部替换为骨架屏。

### 3.2 骨架屏设计

- **汇总分类卡片**：12 张 140×100 的灰色圆角矩形，闪烁动画（已定义的 `skeleton-shimmer` keyframe）
- **子分类卡片**：同形状灰色占位卡，数量与后端返回一致（不可预知时显示 6 张）
- **歌曲列表**：6 行 44px 高的占位行（左侧 44×44 灰色方块 + 右侧两行文字条）
- **CSS**：复用已有的 `skeleton` 类，补充 `.skeleton-card`、`.skeleton-row` 变体

### 3.3 过渡动画

数据加载完成后：
1. 骨架屏 `opacity: 0 → 0`，`display: none`
2. 真实卡片以 `cardEnter` 交错动画入场（已有，`animation-delay: calc(var(--stagger-index) * 50ms)`）

---

## 4. 标签/分类卡片 → 本地图片

### 4.1 下载图片

执行 `scripts/download_tag_bg.js`，将 15 个标签类别的 Unsplash 背景图下载到 `public/images/tags/`。

已有映射（tag → Unsplash 关键词）：
```
热歌榜单 → hot songs concert
一人一首成名曲 → classic hits
粤语经典 → hong kong city
KTV必点 → karaoke party
民谣 → folk acoustic guitar
华语流行 → chinese pop music
欧美音乐 → western music vinyl
古风国风 → chinese traditional
纯音乐 → piano instrument
经典怀旧 → vintage retro
网络神曲 → internet viral music
歌手专区 → singer microphone
主题歌单 → music playlist
...
```

### 4.2 前端引用路径

**`renderCollectionGrid`（12 张分类卡片）**：
```js
// Before: yumus.cn API
// After:
function getCollectionBgStyle(name) {
  const slugMap = {
    '热歌榜单': 'hot-songs', 'KTV必点': 'ktv-must-sing', /* ... */
  };
  const slug = slugMap[name] || 'default';
  return `background-image: url('/public/images/tags/${slug}.jpg')`;
}
```

**`renderCollectionItemsGrid`（子分类卡片）**：
```js
// Before: yumus.cn API
// After: 用所属分类 slug + index 轮换，或直接用纯色渐变作为降级
const bgStyle = hasBvid
  ? `background-image:url('/public/images/tags/${collectionSlug}.jpg');background-size:cover;background-position:center`
  : '';
```

### 4.3 降级策略

- 图片不存在时 CSS `background-color` 作为 fallback（已有 `--tag-color` 自定义属性）
- 图片加载失败 → `onerror` 移除 `background-image`，露出纯色背景

---

## 5. 整体性能提升

### 5.1 express.static 范围收窄

```js
// Before: 暴露整个项目根目录
app.use(express.static(__dirname));

// After: 只暴露必要的前端资源
app.use(express.static(path.join(__dirname, 'public')));
// 前端核心文件单独映射
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/index.html', express.static(path.join(__dirname, 'index.html')));
app.use('/lyrics.html', express.static(path.join(__dirname, 'lyrics.html')));
```

这防止 `.env`、`node_modules/`、`scripts/`、`.superpowers/` 等被公开访问，也减少静态文件中间件的扫描范围。

### 5.2 首页数据并行预加载

```js
// 首页加载时后台预取 tags 和 collections（不阻塞首屏渲染）
const preloadCollections = fetch('/api/collections')
  .then(r => r.json())
  .then(d => { _collectionTree = d.collections || []; })
  .catch(() => {});
```

### 5.3 attachTags 调用优化

- `attachTags()` 在每次 `/api/songs` 请求时都执行，即使部分查询不需要 tags
- 加一个 `?withTags=false` 参数，集合歌曲列表等不需要标签的场景跳过 tags 关联查询

---

## Files Changed

| 文件 | 改动 |
|------|------|
| `server.js` | 新增 `PATCH /api/playlists/:id`；收窄 `express.static`；`/api/collections` 加缓存头；`/api/songs` 支持 `withTags` 参数 |
| `js/playlist.js` | 新增 `renamePlaylist(id, name)` 方法 |
| `js/ui.js` | 歌单内联编辑 UI；骨架屏渲染函数；本地图片路径替换 yumus.cn；预加载 collections；渲染歌单列表时绑定编辑事件 |
| `css/style.css` | 骨架屏样式（`.skeleton-card`、`.skeleton-row`）；歌单内联编辑输入框样式 |
| `public/images/tags/` | 新增 15 张 Unsplash 标签背景图（由 `download_tag_bg.js` 生成） |
