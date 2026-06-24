# 设计文档：邮箱验证码登录 + 用户资料 + UI 改进

**日期：** 2026-06-24
**状态：** 待审核

---

## 概述

7 个改动项：邮箱验证码登录（替换密码登录）、用户名修改、用户头像、播放模式/音量图标替换、音量控制修复、歌曲汇总子目录去背景图、意见反馈。

---

## 1. 邮箱验证码登录

### 后端 (server.js)

**新增依赖：** `nodemailer`（npm install nodemailer）

**SMTP 配置（163 邮箱）：**
```js
const transporter = nodemailer.createTransport({
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    auth: { user: 'lexiaode@163.com', pass: process.env.EMAIL_SMTP_PASS },
});
```

环境变量新增 `.env` 项：`EMAIL_SMTP_PASS`（163 邮箱授权码）。

**新增 `POST /api/auth/send-code`：**
- 接收 `{ email }`
- 生成 6 位随机数字验证码
- 插入 `verification_codes` 表：`{ email, code, expires_at: NOW()+5min }`
- 通过 Nodemailer 发送邮件（主题："青春旋律 - 登录验证码"，正文包含验证码和5分钟有效期提醒）
- 同一邮箱 60 秒内重复请求返回 429

**改造 `POST /api/auth/login`：**
- 接收 `{ email, code }`（原 `{ email, password }`）
- 从 `verification_codes` 查找匹配、未过期、未使用的记录
- 验证通过后标记为已使用
- 在 Supabase Auth 查找用户 → 存在则用 `supabaseAdmin.auth.admin.updateUserById` 确保邮箱确认 → 不存在则 `supabaseAdmin.auth.admin.createUser` 自动创建（随机密码，email_confirm: true）
- `public.users` 表：存在则跳过，不存在则 INSERT（username 默认为邮箱前缀）
- 用 `supabase.auth.signInWithPassword` 获取 session（admin create 时需要记录随机密码以备 sign-in，或直接用 `supabaseAdmin.auth.admin.generateLink` 替代）
  - **注意：** admin.createUser 返回的 user 不能直接 signInWithPassword（不知道密码）。改用 admin API 生成 session 的方式，或直接用 service_role 签发自定义 JWT。**实际采用方案：** createUser 时设一个已知的临时密码，然后 signInWithPassword，再不用管密码（用户永远用验证码登录）。
- 返回 `{ user: { id, email, username, avatar_url }, session: { access_token, refresh_token, expires_at } }`

**移除 `POST /api/auth/signup`：** 验证码登录已涵盖注册。

**新增 DDL（在 Supabase SQL Editor 执行）：**
```sql
CREATE TABLE IF NOT EXISTS verification_codes (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vc_email_code ON verification_codes(email, code, expires_at, used);
```

### 前端 (js/auth.js)

- 移除 `login(email, password)` → 新增 `sendCode(email)` + `verifyCode(email, code)`
- `sendCode()` 调用 `POST /api/auth/send-code`
- `verifyCode()` 调用 `POST /api/auth/login`，保存 session/user 同原逻辑

### 前端 (js/ui.js — Auth Modal)

- 改为两步式：
  - **步骤1：** 邮箱输入框 + "发送验证码"按钮（点击后倒计时 60 秒）+ 切换到验证码输入
  - **步骤2：** 6 位验证码输入框 + "登录/注册"按钮 + 返回修改邮箱
- 移除密码字段

---

## 2. 用户名修改

### 后端 (server.js)

**新增 `PATCH /api/auth/profile`：**
- `authMiddleware` 鉴权
- 接收 `{ username }`
- 校验：长度 1-30，不含特殊字符
- `supabaseAdmin.from('users').update({ username }).eq('id', req.user.id)`
- 唯一性冲突返回 409
- 返回 `{ user: { id, email, username, avatar_url } }`

### 前端 (js/auth.js)

- 新增 `updateProfile({ username })` 方法
- 成功后更新 `_user` 并 `notify()`

### 前端 (js/ui.js)

- 用户下拉菜单新增"修改用户名"选项
- 点击弹出 Modal：输入框 + 确定/取消
- 成功后即时更新侧边栏显示

---

## 3. 用户头像

### 数据库

```sql
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
```

### Supabase Storage

- 新建 bucket `avatars`（公开读取）
- 文件路径：`{userId}/avatar.jpg`
- 上传时覆盖同名文件

### 后端 (server.js)

**新增 `POST /api/auth/avatar`：**
- `authMiddleware` 鉴权
- 用 `multer` 处理 `multipart/form-data`（或手动解析，维持无额外依赖风格）
  - **采用方案：** 用 `express.raw` + 手动解析 boundary，避免引入 multer 依赖。或直接在请求 body 中接收 base64 图片。
  - **最终选择：** 前端用 FileReader 读成 base64，POST `{ avatar_base64: "data:image/..." }`，后端解码后通过 `supabaseAdmin.storage.from('avatars').upload()` 上传，获取 public URL，更新 `public.users.avatar_url`。
- 限制文件大小 ≤ 2MB
- 限制格式：PNG / JPEG / WebP
- 返回 `{ avatar_url }`

### 前端 (js/auth.js)

- 新增 `uploadAvatar(file)` → 读 base64 → POST /api/auth/avatar → 更新 `_user.avatar_url` → notify()

### 前端 (js/ui.js)

- 侧边栏用户按钮改为圆形头像图（替代当前纯文字按钮）
- 未登录显示默认灰色圆形 + `👤`
- 已登录显示头像图（`avatar_url`），无头像时显示用户名首字
- 点击头像弹出菜单（现有下拉菜单逻辑）
- 菜单新增"更换头像"选项 → 触发 `<input type="file" accept="image/*">` → 选择后自动上传

### CSS (css/style.css)

- `.sidebar-avatar` — 40x40 圆形，`object-fit: cover`，绿色边框
- `.sidebar-avatar-placeholder` — 40x40 圆形，灰底，居中文字

---

## 4. 播放模式 & 音量图标替换

### 改动范围：`js/ui.js` — `updateModeDisplay()` + `setupGlobalDelegation()`

用 SVG 图标替代 emoji：

- **列表循环 (loop-all)：** 两个弧线 + 箭头形成闭环，颜色 `--text-secondary`
- **单曲循环 (loop-single)：** 弧线 + 叠加数字 "1" 小标，颜色 `--accent`
- **随机 (shuffle)：** 两条交叉箭头线，颜色 `--accent`
- **音量 (有声音)：** 喇叭 + 声波弧线（3 条），颜色 `--text-secondary`
- **音量 (静音)：** 喇叭 + ✕，颜色 `--text-tertiary`

图标以 SVG 字符串形式写在 `updateModeDisplay()` 和音量按钮渲染中，使用 CSS `fill: currentColor` 继承颜色。

音量图标随音量变化：volume > 50% 显示 3 条声波，> 0% 显示 1-2 条，0% 显示静音图标。

### CSS

- `.btn-mode svg` / `.btn-volume svg` — `width: 18px; height: 18px;`

---

## 5. 音量控制修复

### 根因

`js/ui.js:1250` 行：
```js
const audio = document.querySelector('audio');
if (audio) audio.volume = $.volumeSlider.value / 100;
```
`Player.init()` 用 `new Audio()` 创建 audio，不挂载到 DOM，所以 `document.querySelector('audio')` 永远返回 `null`。

### 修复

**Player (js/player.js) 新增方法：**
```js
function setVolume(v) {
    if (audio) audio.volume = Math.max(0, Math.min(1, v));
}
// 同时暴露 getVolume
function getVolume() {
    return audio ? audio.volume : 1;
}
```
暴露在 Player 返回对象中：`setVolume`, `getVolume`

**UI (js/ui.js) 修改音量事件：**
```js
$.volumeSlider.addEventListener('input', () => {
    Player.setVolume($.volumeSlider.value / 100);
});
```

**初始化音量：** UI 初始化时设置 slider 默认值 80（匹配现有 `value="80"`），调 `Player.setVolume(0.8)`。

---

## 6. 歌曲汇总子目录去背景图

### 改动范围：`js/ui.js` — `renderCollectionItemsGrid()`

移除 `background-image: url('https://www.yumus.cn/api/...')` 动态背景。

替代方案：使用固定色阶渐变，每个卡片根据 index 取不同色调（复用 `getCoverFallbackColor()`），与封面卡片 fallback 风格统一。

```js
// 旧（删除）：
const bgStyle = hasBvid ? `background-image: url(...)` : '';
// 新：
const bgColor = getCoverFallbackColor(i);
const bgStyle = hasBvid ? `background: linear-gradient(135deg, ${bgColor} 0%, ${bgColor}88 100%)` : '';
```

---

## 7. 意见反馈

### 前端 (index.html + js/ui.js + css/style.css)

**侧边栏位置：** 在最底部用户区上方、sidebar-tags 下方，新增反馈按钮：
```html
<div class="sidebar-feedback">
    <button class="sidebar-feedback-btn" data-action="show-feedback">💬 意见反馈</button>
</div>
```

**点击弹出 Modal：**
- textarea（placeholder: "请告诉我们您的想法…"）
- 提交 / 取消按钮
- 无需登录

**提交调用 `POST /api/feedback`：** 发送 `{ content, contact }`（contact 选填，方便回复）

### 后端 (server.js)

**新增 `POST /api/feedback`：**
- 无需鉴权
- 接收 `{ content, contact }`
- 用 Nodemailer（复用同一 SMTP transporter）发送到 `lexiaode@163.com`
- 邮件主题："[青春旋律反馈] 来自用户的意见"
- 邮件正文包含反馈内容、联系方式（如有）、时间戳

### 前端状态处理

- 发送中：按钮 loading 状态
- 成功：显示 "感谢反馈！"
- 失败：显示错误提示，可重试

---

## 实施顺序

1. **DDL：** `verification_codes` 表 + `users.avatar_url` 列
2. **后端：** Nodemailer 集成 + send-code / login 改造 + profile / avatar / feedback 端点
3. **前端 Auth：** sendCode / verifyCode / updateProfile / uploadAvatar
4. **前端 UI：** Auth Modal 两步式 + 用户名修改 + 头像显示/上传 + 图标替换 + 音量修复 + 集合去背景 + 反馈按钮
5. **Supabase Storage：** 创建 avatars bucket + 公开访问策略
6. **测试验证**

---

## 注意事项

- `.env` 需新增 `EMAIL_SMTP_PASS`（163 邮箱 SMTP 授权码）
- `nodemailer` 是唯一新增的 npm 依赖
- 验证码登录后，用户无密码——Supabase Auth 中密码为随机生成，用户不知。后续如需密码功能，需额外开发"设置密码"流程
- 头像文件限制 2MB，超过时前端截断 + 压缩（Canvas resize）
- 现有注册用户过渡：旧用户首次用验证码登录时，Supabase Auth 已存在该邮箱用户，会比对验证码而非密码，无需迁移
