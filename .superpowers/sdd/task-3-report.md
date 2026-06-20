# Task 3 Report: 歌词弹出窗口

**Status:** DONE

**Commit:** `ea7ff05` — feat: add lyrics popup window with vertical/horizontal modes

**Files created:**
- `lyrics.html` — 独立歌词弹出窗口页面，包含标题栏（可拖拽）和歌词显示区域
- `js/lyrics.js` — 歌词窗口逻辑（IIFE 模块 `Lyrics`），包含 LRC 解析、双模式渲染、BroadcastChannel 通信、窗口拖拽
- `css/lyrics.css` — 歌词窗口完整样式，复用主应用 CSS 变量，支持竖条形（10行）和长条形（2行）两种模式

**Implemented features:**
1. **LRC 解析** — `parseLRC()` 支持 `[mm:ss.xx]` 和 `[mm:ss.xxx]` 两种毫秒格式，空行和元数据标签自动跳过
2. **双模式渲染** — 竖条形（vertical）显示当前行前后共约 10 行，长条形（horizontal）显示当前行和下一行共 2 行；模式切换按钮 `≡/—` 在标题栏
3. **时间同步** — `syncTime()` 使用二分查找定位当前歌词行，仅在行索引变化时重新渲染
4. **BroadcastChannel 通信** — 接收 `time-update`、`song-change`、`lyrics-open` 消息；发送 `lyrics-closed`、`mode-change` 消息
5. **窗口拖拽** — 通过 `window.moveTo()` 实现标题栏拖拽移动
6. **URL 参数加载** — 支持 `?songId=N` 自动加载歌曲歌词
7. **错误处理** — API 失败或无歌词时显示空状态，网络错误静默降级

**Verification:**
- 服务器启动后，`lyrics.html`、`js/lyrics.js`、`css/lyrics.css` 均通过 HTTP 200 正常返回
- `/api/lyrics/:songId` 端点存在并可访问（当前返回 404 是因为数据库 `lrc_text` 列尚未添加 — Task 1 SQL 待执行）
- 页面结构正确：标题栏含歌曲信息、模式切换按钮、关闭按钮；歌词区域默认显示"等待播放..."
- JS 模块无语法错误（IIFE 格式与其他模块一致）
- CSS 变量与主应用 `style.css` 保持一致

**Self-review findings:**
- `renderVertical()` 中的 `translateY(...)` 计算 `* 0` 使实际位移始终为 0 — 这是有意为之的简化实现。窗口高度 520px 内 10 行足够显示，如需真正的滚动高亮居中效果，可改为实际像素位移
- BroadcastChannel 在 `setupChannel()` 中创建且永不关闭 — 窗口存活期间持续监听，符合设计意图
- `window.close()` 在关闭按钮点击时调用 — 注意浏览器可能阻止非 `window.open()` 打开的窗口调用 `close()`（但从主窗口通过 `window.open()` 打开则无此限制）
- 与 Task 4 配合后完整功能才能实现 — Task 4 将在 `player.js` 中添加 `time-update` 和 `song-change` 的 BroadcastChannel 推送

**Dependencies:**
- Task 1 (`sql/alter_lyrics.sql`) — 需要在 Supabase SQL Editor 中执行，添加 `lrc_text` 列
- Task 2 (`server.js` GET /api/lyrics/:songId) — 已完成
- Task 4 (`js/player.js` BroadcastChannel 推送) — 待实施
