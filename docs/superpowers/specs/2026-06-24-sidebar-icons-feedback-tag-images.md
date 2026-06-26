# Design: 侧边栏图标升级 + 反馈位置调整 + 子标签卡片图片

**日期**: 2026-06-24
**状态**: 设计中

## 概述

四个相关联的 UI 改进：
1. 侧边栏菜单项 emoji 图标替换为 SVG 图标
2. 修复播放模式按钮刷新后图标不更新
3. 意见反馈移到用户区下方
4. 歌曲汇总子分类卡片添加背景图片

## 1. 侧边栏 SVG 图标

### 现状
侧边栏菜单项使用 emoji（🏠📊⭐📋），用户下拉菜单使用 emoji（✏️📷），与页面已有的 SVG 图标（模式按钮、音量按钮）风格不统一。

### 设计
为以下菜单项创建 SVG 图标，风格与现有 `MODE_ICONS` / `VOLUME_ICONS` 一致：
- 18×18 viewBox
- `stroke="currentColor"` + `stroke-width="2"` + `stroke-linecap="round"` + `stroke-linejoin="round"`
- 通过 `.sidebar-item-icon` 的 `currentColor` 自动适配 hover/active 状态

| 菜单项 | SVG 图标形状 |
|--------|-------------|
| 首页 | 房子 + 屋顶 |
| 歌曲汇总 | 2×2 四宫格 |
| 我的收藏 | 星形 (填充) |
| 我的歌单 | 三条横线 + 播放按钮 |
| 意见反馈 | 消息气泡 |
| 修改用户名 | 铅笔编辑 |
| 更换头像 | 相机 |
| 退出登录 | 门 + 箭头 |

### 实现方式
- 在 `index.html` 中直接替换 emoji 为内联 SVG
- 用户下拉菜单中的 emoji 同步替换
- 反馈按钮的 emoji 同步替换

## 2. 模式按钮图标持久化

### 根因
`ui.js` 的 `init()` 中未调用 `updateModeDisplay()`。该函数仅在 `modeChange` 事件触发时执行，因此页面刷新后 HTML 默认的 🔁 emoji 一直保留，直到用户点击切换模式。

### 修复
在 `init()` 函数中，`setupPlayerEvents()` 之后添加一行：
```js
updateModeDisplay();
```

## 3. 意见反馈移到用户区

### 现状
反馈按钮位于 `.sidebar-feedback` 独立区块，在弹性空白区和用户区之间。

### 设计
将反馈按钮移入 `.sidebar-user` 内部，放在用户名/登录按钮下方。作为小字链接样式：
- 字体 12px，颜色 `--text-tertiary`
- hover 时变为 `--text-primary`
- 始终可见（无论登录状态）

### HTML 结构调整
```
.sidebar-user
  ├── 登录按钮 (未登录) / 用户头像+名 (已登录)
  └── 反馈链接 (新增)
```

删除 `.sidebar-feedback` 区块。

## 4. 子分类卡片背景图片

### 现状
`renderCollectionItemsGrid()` 中的子标签卡片使用纯 CSS 渐变色背景（`linear-gradient(135deg, ...)`），视觉效果单调。

### 设计
子标签卡片复用与顶级分类卡片相同的图片 API（`yumus.cn`），根据子标签在列表中的 index 派生不同的 `type` 参数，确保每个卡片有独特的背景图。

- 保留渐变遮罩层（`::after` 伪元素），确保文字可读性
- 对 `bvid=null` 的占位卡片保持无背景图（仅纯色）

### 备选
如果外部 API 不可靠，回退到更丰富的 CSS 渐变（多色相 + 角度变化），比当前单色渐变更好看。
