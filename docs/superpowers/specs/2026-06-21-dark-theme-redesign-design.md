# 音乐播放器 — 极简暗色主题重设计

> 日期：2026-06-21 | 状态：待审批

## 设计目标

将现有暖桃色系音乐播放器升级为**极简暗色 + 冰鸢尾紫点缀**的高级感界面。核心原则：克制、呼吸感、让音乐成为界面唯一的主角。

---

## 1. 配色 & 视觉风格

### 背景层级（深 → 浅）

| Token | 色值 | 用途 |
|--------|------|------|
| `--bg-root` | `#09090b` | html/body 根背景 |
| `--bg-surface` | `#141416` | 卡片、面板 |
| `--bg-hover` | `#1e1e21` | hover 态 |
| `--bg-active` | `#252528` | 按压态 / 播放中卡片 |

### 文字层级

| Token | 色值 | 用途 |
|--------|------|------|
| `--text-primary` | `#f0f0f2` | 歌名、标题 |
| `--text-secondary` | `#9a9aa0` | 歌手、标签计数 |
| `--text-tertiary` | `#5c5c64` | 时间戳、提示 |

### 点缀色 — 冰鸢尾紫

| Token | 色值 | 用途 |
|--------|------|------|
| `--accent` | `#a5a0f0` | 按钮、进度条、播放中 |
| `--accent-hover` | `#bdb8f5` | hover 亮 |
| `--accent-active` | `#8b86d6` | active 深 |
| `--accent-glow` | `rgba(165,160,240,0.12)` | 光晕 |

### 边框

| Token | 色值 | 用途 |
|--------|------|------|
| `--border-subtle` | `rgba(255,255,255,0.06)` | 分割线 |
| `--border-card` | `rgba(255,255,255,0.10)` | 卡片边框 |
| `--border-active` | `rgba(255,255,255,0.14)` | 激活态 |

### 阴影 → 光晕

暗色下用 border + glow 替代传统阴影表达层级。毛玻璃播放栏升级为 `blur(24px) saturate(1.2)`。

---

## 2. 布局 & 间距

### 间距阶梯（4px 基准）

`4 → 8 → 12 → 20 → 32 → 48`

- xs: 4px（图标内边距）
- sm: 8px（同类元素间距）
- md: 12px（卡片内 padding）
- lg: 20px（区块间距）
- xl: 32px（页面边距、大区块）
- 2xl: 48px（极稀疏场景）

### 整体结构

```
Header（56px） → Main（flex:1，max-width:1280px） → Player Bar（~64px 单行）
```

- 桌面页面边距：32px
- 右侧面板：300px（原 340px）
- 主视图/面板间距：20px

### 播放栏单行化

`[歌名·歌手] [◀ ▶ ⏭] [━━━━━━] [1:23 / 3:45]`

### 容器宽度上限

`.app-main { max-width: 1280px; margin: 0 auto; }`

---

## 3. 字体 & 排版

### 字体栈

```css
--font-sans: "Inter", -apple-system, BlinkMacSystemFont,
             "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
--font-mono: "JetBrains Mono", "SF Mono", monospace;
```

Inter 从 Google Fonts 引入（~40KB）。

### 字号阶梯（严格 2px 步进）

`11 → 12 → 14 → 16 → 20 → 24 → 32`

不再使用 13px、15px、18px 等中间值。

### 字重

`400 → 500 → 600 → 700`（仅 4 档）

### 行高 & 细节

- 正文：`line-height: 1.6`
- 标题：`line-height: 1.3`
- 全局：`letter-spacing: -0.01em`
- 分类标签：`letter-spacing: 0.06em` + uppercase
- 时间戳：`font-variant-numeric: tabular-nums`

---

## 4. 交互动效

### 曲线变量

```css
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
--duration-fast:  150ms;
--duration-base:  250ms;
--duration-slow:  400ms;
```

### 覆盖场景

| 场景 | 动效 | 曲线 | 时长 |
|------|------|------|------|
| 卡片 hover | translateY(-2px) scale(1.01) + glow | spring | 150ms |
| 播放中卡片 | 呼吸光晕 pulse | in-out | 3s 循环 |
| 收藏按钮 | scale(1.18) hover / scale(0.88) active | spring | 150ms |
| 收藏激活 | heartPop 缩放弹跳 | spring | 400ms |
| 播放按钮 | scale(1.08) + 光晕 hover | spring | 150ms |
| 进度条 | height 4px→6px hover | out | 150ms |
| 模态弹窗 | translateY(16px)→0 + scale(0.95)→1 | out | 250ms |
| 下拉菜单 | translateY(-6px)→0 + scale(0.96)→1 | out | 150ms |
| 标签卡片 | translateY(-4px) hover | spring | 150ms |
| 视图切换 | opacity + translateY(8px) | out | 250ms |
| 页面加载 | 卡片依次淡入（stagger 40-60ms） | out | 400ms |

### 动效禁用

```css
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
    }
}
```

---

## 5. 响应式设计

### 断点

| 断点 | 布局 |
|------|------|
| ≥ 1024px | 完整三栏：主视图 + 右侧面板(300px) + 播放栏 |
| 768–1023px | 双栏：主视图全宽 + 底部抽屉(收藏/歌单) + 播放栏 |
| < 768px | 单栏 + 迷你播放栏(40px)，点击展开完整控制 |

### 平板特色

- 右侧面板 → 底部抽屉（Bottom Sheet），60% 高度，spring 滑入
- 右下角 FAB 按钮触发
- 背景半透明遮罩

### 手机特色

- Header 去掉副标题
- 迷你播放栏：仅进度细线 + 歌名 + 播放/暂停 + 下一首
- 点击歌名区域 → 展开完整播放栏

### 标签网格

```css
≥ 900px: 3 列
< 900px: 3 列
< 600px: 2 列
```

---

## 实施范围

### 文件变更

| 文件 | 变更 |
|------|------|
| `css/style.css` | 全面重写 CSS 变量 + 所有组件样式 |
| `css/lyrics.css` | 同步暗色变量 + 样式适配 |
| `index.html` | 引入 Inter 字体；可能微调结构 |
| `js/ui.js` | 新增视图切换动画、FAB/抽屉逻辑（平板） |
| `js/lyrics.js` | 无需变更 |

### 不变

- 后端 `server.js`
- 数据库结构
- 播放器核心逻辑 `js/player.js`
- 收藏/歌单逻辑 `js/playlist.js`
- 认证逻辑 `js/auth.js`
- API 接口

### 风险

- **低**：纯 CSS 重写，不涉及业务逻辑
- **中低**：平板抽屉需要少量 JS 新增
- **回滚**：git revert 即可
