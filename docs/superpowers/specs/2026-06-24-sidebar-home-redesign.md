# 侧边栏 & 首页重构设计

## 改动概述

1. 侧边栏"热门标签"从动态标签改为硬编码的歌曲汇总快捷入口
2. 删除"分类浏览"侧边栏导航
3. 删除标签系统相关前端代码
4. 首页改为展示治愈华语女声歌单（BV1pr6aYiE97）

## 详细改动

### index.html
- 删除 `data-nav="tags"` 侧边栏项
- 删除动态 `#sidebarTags` 占位容器
- 替换为 5 个硬编码按钮：热歌榜单、一人一首成名曲、粤语经典、KTV必点、民谣
- 每个按钮通过 `data-action` 指向对应 collection

### js/ui.js
- 删除：renderSidebarTags, navigateToTags, renderTagGrid, getTagBgStyle, getTagEmoji, navigateToTag, navigateToStar, renderStarCards, getStarBgStyle, findTagById, findTagName
- 删除：_tags 状态, _currentView 的 tags/tag/star 状态
- 修改：navigateHome() — 直接加载治愈华语女声歌单
- 修改：init() — 不再 fetch /api/tags
- 新增：5 个 collection 快捷导航的 action handler
- 修改：goBack() — 删除 tags/tag/star 分支
- 修改：事件委托 — 删除 nav-tags, navigate-tag, navigate-star

### server.js
- /api/songs 默认 limit 改为 300（首页加载完整歌单）

### CSS
- 新 sidebar 按钮复用 .sidebar-tag-item 样式，无需改动
