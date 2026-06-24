# 邮箱验证码登录 + 用户资料 + UI 改进 实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现邮箱验证码登录（替换密码）、用户名/头像修改、播放器图标/音量修复、集合去背景、意见反馈

**Architecture:** 后端新增 nodemailer 发邮件，改造 /api/auth/login 从密码→验证码，新增 profile/avatar/feedback 端点。前端 auth.js 新增 sendCode/verifyCode/updateProfile/uploadAvatar，ui.js 改造 Auth Modal 为两步式、SVG 图标、音量直接调 Player API。

**Tech Stack:** Node.js Express + Supabase (Auth + Storage + PostgreSQL) + Nodemailer (163 SMTP) + vanilla JS IIFE modules

## Global Constraints

- Node.js 路径: `/d/softwa/nodejs/node`
- 唯一新增依赖: `nodemailer`
- `.env` 新增: `EMAIL_SMTP_PASS`（163 授权码）
- 数据库 DDL 需在 Supabase SQL Editor 执行
- Supabase Storage bucket `avatars` 需手动创建并设为公开
- 端口: 8765

---

### Task 1: 环境准备 — 安装依赖 + 数据库 DDL

**Files:**
- Create: `sql/verification_codes.sql` (DDL 文件，仅记录)
- Modify: `.env` (添加 EMAIL_SMTP_PASS)

**Interfaces:**
- Consumes: nothing
- Produces: `nodemailer` 可用, `verification_codes` 表存在, `public.users.avatar_url` 列存在

- [ ] **Step 1: 安装 nodemailer**

```bash
cd "c:/Users/xiaokang/Desktop/歌曲" && /d/softwa/nodejs/node -e "require('nodemailer')" 2>&1 || /d/softwa/nodejs/npm install nodemailer
```

Expected: 如果已安装输出 nothing，否则安装成功。

- [ ] **Step 2: 在 Supabase SQL Editor 执行 DDL**

打开 https://supabase.com/dashboard/project/orphftlwdwuvoscizndx/sql/new，粘贴执行：

```sql
-- 验证码表
CREATE TABLE IF NOT EXISTS verification_codes (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '5 minutes'),
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vc_email_code ON verification_codes(email, code, expires_at, used);

-- 用户头像列
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
```

确认 SQL Editor 返回成功。

- [ ] **Step 3: 在 Supabase Storage 创建 avatars bucket**

1. 打开 https://supabase.com/dashboard/project/orphftlwdwuvoscizndx/storage/buckets
2. 点击 "New Bucket"
3. Name: `avatars`, 勾选 "Public bucket"
4. 点击 "Create bucket"

- [ ] **Step 4: 更新 .env 文件**

在 `.env` 末尾添加：
```
EMAIL_SMTP_PASS=<你的163邮箱SMTP授权码>
```

163 授权码获取：登录 163 邮箱 → 设置 → POP3/SMTP/IMAP → 开启 SMTP 服务 → 获取授权码。

- [ ] **Step 5: Commit**

```bash
cd "c:/Users/xiaokang/Desktop/歌曲"
git add sql/verification_codes.sql .env
git commit -m "chore: add nodemailer dep, verification_codes DDL, avatars bucket setup"
```

---

### Task 2: 后端 — Nodemailer 配置 + POST /api/auth/send-code

**Files:**
- Modify: `server.js` — 顶部新增 nodemailer require 和 transporter 创建（在 `const app = express();` 之前）
- Modify: `server.js` — 在 auth endpoints 区域新增 send-code 端点

**Interfaces:**
- Consumes: `EMAIL_SMTP_PASS` from process.env
- Produces: `POST /api/auth/send-code` — 接收 `{ email }`，发送验证码，返回 `{ ok: true }`

- [ ] **Step 1: 在 server.js 顶部添加 nodemailer 初始化**

在 `const app = express();` 行之前插入：

```js
// ========== Nodemailer 邮件服务 ==========
const nodemailer = require('nodemailer');
const mailTransporter = nodemailer.createTransport({
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    auth: {
        user: 'lexiaode@163.com',
        pass: process.env.EMAIL_SMTP_PASS || '',
    },
});

// 启动时验证邮件配置
mailTransporter.verify((err) => {
    if (err) console.error('[mail] SMTP 配置错误:', err.message);
    else console.log('[mail] SMTP 就绪 (lexiaode@163.com)');
});
```

- [ ] **Step 2: 添加 POST /api/auth/send-code 端点**

在 `/** POST /api/auth/signup` 之前插入：

```js
/** POST /api/auth/send-code — 发送邮箱验证码 */
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }

    try {
        // 60 秒内重复请求限制
        const { data: recent } = await supabaseAdmin
            .from('verification_codes')
            .select('created_at')
            .eq('email', email)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (recent) {
            const elapsed = Date.now() - new Date(recent.created_at).getTime();
            if (elapsed < 60000) {
                const waitSec = Math.ceil((60000 - elapsed) / 1000);
                return res.status(429).json({ error: `请 ${waitSec} 秒后再试` });
            }
        }

        // 生成 6 位验证码
        const code = String(Math.floor(100000 + Math.random() * 900000));

        // 存入数据库（5 分钟有效）
        const { error: insertErr } = await supabaseAdmin
            .from('verification_codes')
            .insert({
                email,
                code,
                expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            });

        if (insertErr) {
            console.error('[send-code] insert error:', insertErr.message);
            return res.status(500).json({ error: '验证码生成失败' });
        }

        // 发送邮件
        await mailTransporter.sendMail({
            from: '"青春旋律" <lexiaode@163.com>',
            to: email,
            subject: '青春旋律 - 登录验证码',
            text: `您的验证码是：${code}\n\n有效期 5 分钟，请勿将验证码泄露给他人。\n\n—— 青春旋律音乐播放器`,
            html: `<div style="max-width:480px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;background:#0B0E0C;color:#EDF0EE;border-radius:12px">
                <h2 style="color:#4DB88D">🎵 青春旋律</h2>
                <p style="font-size:16px;margin:20px 0">您的登录验证码是：</p>
                <div style="background:#1C2320;padding:16px 24px;border-radius:8px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#4DB88D">${code}</div>
                <p style="font-size:13px;color:#9BA89F;margin-top:20px">有效期 5 分钟，请勿将验证码泄露给他人。</p>
                <hr style="border-color:rgba(255,255,255,0.05);margin:20px 0">
                <p style="font-size:12px;color:#5D6B62">—— 青春旋律音乐播放器</p>
            </div>`,
        });

        res.json({ ok: true });
    } catch (err) {
        console.error('[send-code]', err.message);
        res.status(500).json({ error: '发送失败，请稍后重试' });
    }
});
```

- [ ] **Step 3: Commit**

```bash
cd "c:/Users/xiaokang/Desktop/歌曲"
git add server.js
git commit -m "feat: add nodemailer setup and POST /api/auth/send-code"
```

---

### Task 3: 后端 — 改造 POST /api/auth/login（密码→验证码） + 移除 signup

**Files:**
- Modify: `server.js` — 替换现有 login 端点（约第 672-710 行）+ 移除 signup 端点（约第 601-670 行）

**Interfaces:**
- Consumes: `verification_codes` 表, `supabaseAdmin.auth.admin` methods
- Produces: 新的 `POST /api/auth/login` — 接收 `{ email, code }`，返回 `{ user, session }`

- [ ] **Step 1: 移除旧的 signup 端点**

删除从 `/** POST /api/auth/signup — 邮箱注册 */` 到对应的 `});` 结束行（约第 601-670 行）。即删除整个 `app.post('/api/auth/signup', ...)` 块。

- [ ] **Step 2: 替换 login 端点**

将现有的 `app.post('/api/auth/login', ...)` 整个块（约第 672-710 行）替换为：

```js
/** POST /api/auth/login — 邮箱验证码登录（新用户自动注册） */
app.post('/api/auth/login', async (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
        return res.status(400).json({ error: '请输入邮箱和验证码' });
    }

    try {
        // 1. 查找有效验证码
        const { data: vcRecord, error: vcError } = await supabaseAdmin
            .from('verification_codes')
            .select('*')
            .eq('email', email)
            .eq('code', code)
            .eq('used', false)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (vcError || !vcRecord) {
            return res.status(401).json({ error: '验证码错误或已过期' });
        }

        // 2. 标记验证码已使用
        await supabaseAdmin
            .from('verification_codes')
            .update({ used: true })
            .eq('id', vcRecord.id);

        // 3. 检查 public.users 是否存在
        const { data: existingProfile } = await supabaseAdmin
            .from('users')
            .select('id, username, avatar_url')
            .eq('email', email)
            .single();

        const tempPass = 'temp_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        let userId, username, avatarUrl;
        let isNewUser = false;

        if (existingProfile) {
            // 已有用户：重置密码后登录
            userId = existingProfile.id;
            username = existingProfile.username;
            avatarUrl = existingProfile.avatar_url;
            await supabaseAdmin.auth.admin.updateUserById(userId, {
                password: tempPass,
                email_confirm: true,
            });
        } else {
            // 新用户：在 Supabase Auth 创建 + public.users 插入
            isNewUser = true;
            const { data: newAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
                email,
                password: tempPass,
                email_confirm: true,
            });

            if (createErr) {
                console.error('[login] create auth user error:', createErr.message);
                return res.status(500).json({ error: '创建用户失败' });
            }

            userId = newAuth.user.id;
            username = email.split('@')[0];

            const { error: dbErr } = await supabaseAdmin
                .from('users')
                .insert({ id: userId, username, email });

            if (dbErr) {
                // 回滚 auth 用户
                await supabaseAdmin.auth.admin.deleteUser(userId);
                console.error('[login] create profile error:', dbErr.message);
                return res.status(500).json({ error: '创建用户资料失败' });
            }
        }

        // 4. 用临时密码登录获取 session
        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
            email,
            password: tempPass,
        });

        if (signInErr) {
            console.error('[login] signin error:', signInErr.message);
            return res.status(500).json({ error: '登录失败，请重试' });
        }

        res.json({
            user: { id: userId, email, username, avatar_url: avatarUrl || null },
            session: {
                access_token: signInData.session.access_token,
                refresh_token: signInData.session.refresh_token,
                expires_at: signInData.session.expires_at,
            },
            is_new_user: isNewUser,
        });
    } catch (err) {
        console.error('[login]', err.message);
        res.status(500).json({ error: '登录失败' });
    }
});
```

- [ ] **Step 3: Commit**

```bash
cd "c:/Users/xiaokang/Desktop/歌曲"
git add server.js
git commit -m "feat: switch login from password to email verification code, remove signup"
```

---

### Task 4: 后端 — PATCH /api/auth/profile + POST /api/auth/avatar

**Files:**
- Modify: `server.js` — 在 `/api/auth/me` 之后新增两个端点

**Interfaces:**
- Consumes: `authMiddleware`, `supabaseAdmin`
- Produces:
  - `PATCH /api/auth/profile` — `{ username }` → `{ user: { id, email, username, avatar_url } }`
  - `POST /api/auth/avatar` — `{ avatar_base64: "data:image/..." }` → `{ avatar_url }`

- [ ] **Step 1: 新增 GET /api/auth/me 返回 avatar_url**

修改现有 `GET /api/auth/me` 端点，在 `.select('username')` 中加入 `avatar_url`：

找到 `.select('username')`（约第 723 行），改为 `.select('username, avatar_url')`。

在返回的 user 对象中加入 `avatar_url`：

```js
res.json({
    user: {
        id: req.user.id,
        email: req.user.email,
        username: profile.username,
        avatar_url: profile.avatar_url || null,
    },
});
```

- [ ] **Step 2: 新增 PATCH /api/auth/profile 端点**

在 `GET /api/auth/me` 之后插入：

```js
/** PATCH /api/auth/profile — 修改用户名 */
app.patch('/api/auth/profile', authMiddleware, async (req, res) => {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: '请输入用户名' });
    }
    const trimmed = username.trim();
    if (trimmed.length < 1 || trimmed.length > 30) {
        return res.status(400).json({ error: '用户名长度 1-30 个字符' });
    }
    if (!/^[\w一-鿿぀-ゟ゠-ヿ가-힯\-_\s]+$/.test(trimmed)) {
        return res.status(400).json({ error: '用户名包含无效字符' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('users')
            .update({ username: trimmed })
            .eq('id', req.user.id)
            .select('username, avatar_url')
            .single();

        if (error) {
            if (error.message.includes('duplicate key')) {
                return res.status(409).json({ error: '用户名已被占用' });
            }
            console.error('[profile] update error:', error.message);
            return res.status(500).json({ error: '修改失败' });
        }

        res.json({
            user: {
                id: req.user.id,
                email: req.user.email,
                username: data.username,
                avatar_url: data.avatar_url || null,
            },
        });
    } catch (err) {
        console.error('[profile]', err.message);
        res.status(500).json({ error: '修改失败' });
    }
});
```

- [ ] **Step 3: 新增 POST /api/auth/avatar 端点**

在 PATCH /api/auth/profile 之后插入：

```js
/** POST /api/auth/avatar — 上传头像（base64） */
app.post('/api/auth/avatar', authMiddleware, async (req, res) => {
    const { avatar_base64 } = req.body;

    if (!avatar_base64 || typeof avatar_base64 !== 'string') {
        return res.status(400).json({ error: '请提供头像图片' });
    }

    // 解析 base64 data URL
    const m = avatar_base64.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    if (!m) {
        return res.status(400).json({ error: '图片格式不支持，请使用 PNG/JPEG/WebP' });
    }
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');

    // 限制 2MB
    if (buf.length > 2 * 1024 * 1024) {
        return res.status(400).json({ error: '图片大小不能超过 2MB' });
    }

    try {
        const filePath = `${req.user.id}/avatar.${ext}`;

        // 上传到 Supabase Storage（覆盖）
        const { error: uploadErr } = await supabaseAdmin
            .storage
            .from('avatars')
            .upload(filePath, buf, {
                contentType: `image/${ext}`,
                upsert: true,
            });

        if (uploadErr) {
            console.error('[avatar] upload error:', uploadErr.message);
            return res.status(500).json({ error: '头像上传失败' });
        }

        // 获取公开 URL
        const { data: urlData } = supabaseAdmin
            .storage
            .from('avatars')
            .getPublicUrl(filePath);

        const avatarUrl = urlData.publicUrl;

        // 更新 public.users
        const { error: updateErr } = await supabaseAdmin
            .from('users')
            .update({ avatar_url: avatarUrl })
            .eq('id', req.user.id);

        if (updateErr) {
            console.error('[avatar] update error:', updateErr.message);
            return res.status(500).json({ error: '头像信息保存失败' });
        }

        res.json({ avatar_url: avatarUrl });
    } catch (err) {
        console.error('[avatar]', err.message);
        res.status(500).json({ error: '头像上传失败' });
    }
});
```

- [ ] **Step 4: Commit**

```bash
cd "c:/Users/xiaokang/Desktop/歌曲"
git add server.js
git commit -m "feat: add PATCH /api/auth/profile and POST /api/auth/avatar endpoints"
```

---

### Task 5: 后端 — POST /api/feedback 意见反馈端点

**Files:**
- Modify: `server.js` — 在文件末尾 `app.listen` 之前新增

**Interfaces:**
- Consumes: `mailTransporter` (Task 2 创建)
- Produces: `POST /api/feedback` — `{ content, contact? }` → `{ ok: true }`

- [ ] **Step 1: 新增 POST /api/feedback 端点**

在 `app.listen` 之前插入：

```js
// ========== 意见反馈 ==========

/** POST /api/feedback — 用户意见反馈（无需登录） */
app.post('/api/feedback', async (req, res) => {
    const { content, contact } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length < 2) {
        return res.status(400).json({ error: '请输入至少 2 个字符的反馈内容' });
    }
    if (content.length > 2000) {
        return res.status(400).json({ error: '反馈内容不能超过 2000 字' });
    }

    try {
        const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const contactInfo = contact ? `\n联系方式：${contact}` : '';

        await mailTransporter.sendMail({
            from: '"青春旋律反馈" <lexiaode@163.com>',
            to: 'lexiaode@163.com',
            subject: `[青春旋律反馈] 来自用户的意见 (${timeStr})`,
            text: `反馈时间：${timeStr}\n\n反馈内容：\n${content.trim()}${contactInfo}\n\n—— 青春旋律音乐播放器`,
            html: `<div style="max-width:480px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;background:#0B0E0C;color:#EDF0EE;border-radius:12px">
                <h2 style="color:#4DB88D">💬 用户反馈</h2>
                <p style="font-size:12px;color:#5D6B62">反馈时间：${timeStr}</p>
                <div style="background:#1C2320;padding:16px;border-radius:8px;margin:16px 0;font-size:15px;line-height:1.6;white-space:pre-wrap">${content.trim()}</div>
                ${contact ? `<p style="font-size:13px;color:#9BA89F">联系方式：${contact}</p>` : ''}
                <hr style="border-color:rgba(255,255,255,0.05);margin:20px 0">
                <p style="font-size:12px;color:#5D6B62">—— 青春旋律音乐播放器</p>
            </div>`,
        });

        res.json({ ok: true });
    } catch (err) {
        console.error('[feedback]', err.message);
        res.status(500).json({ error: '发送失败，请稍后重试' });
    }
});
```

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/xiaokang/Desktop/歌曲"
git add server.js
git commit -m "feat: add POST /api/feedback endpoint"
```

---

### Task 6: Player.js — 新增 setVolume / getVolume

**Files:**
- Modify: `js/player.js` — 在 return 对象中新增两个方法

**Interfaces:**
- Consumes: 内部 `audio` 元素
- Produces: `Player.setVolume(v: number 0-1)`, `Player.getVolume(): number`

- [ ] **Step 1: 在 Player 中添加 setVolume / getVolume**

在 `js/player.js` 中，找到 `getDuration` 函数前的区域（约第 388 行），在 return 之前添加两个函数：

```js
    function setVolume(v) {
        if (audio) audio.volume = Math.max(0, Math.min(1, v));
    }

    function getVolume() {
        return audio ? audio.volume : 1;
    }
```

然后在 return 对象中添加导出（约第 394-411 行）：

```js
    return {
        init,
        on,
        setSongs,
        playAll,
        play,
        pause,
        togglePlay,
        seek,
        next,
        prev,
        setMode,
        getMode,
        getCurrentSong,
        getIsPlaying,
        getCurrentTime,
        getDuration,
        setVolume,
        getVolume,
    };
```

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/xiaokang/Desktop/歌曲"
git add js/player.js
git commit -m "feat: add Player.setVolume and Player.getVolume methods"
```

---

### Task 7: Auth.js — 新方法：sendCode / verifyCode / updateProfile / uploadAvatar

**Files:**
- Modify: `js/auth.js` — 替换 login/signup，新增方法

**Interfaces:**
- Consumes: `fetch` API
- Produces:
  - `Auth.sendCode(email): Promise<void>` — 发送验证码
  - `Auth.verifyCode(email, code): Promise<user>` — 验证码登录
  - `Auth.updateProfile({ username }): Promise<user>` — 修改用户名
  - `Auth.uploadAvatar(file): Promise<avatarUrl>` — 上传头像

- [ ] **Step 1: 重写 js/auth.js**

将 `js/auth.js` 中的 `login` 和 `signup` 方法替换为新的 `sendCode` 和 `verifyCode`，并新增 `updateProfile` 和 `uploadAvatar`。

替换 `login` 方法（约第 103-117 行）为：

```js
    /** 发送邮箱验证码 */
    async function sendCode(email) {
        const resp = await fetch('/api/auth/send-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || '发送验证码失败');
        }
    }

    /** 验证码登录（新用户自动注册） */
    async function verifyCode(email, code) {
        const resp = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code }),
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || '登录失败');
        }

        saveSession(data.session, data.user);
        return data.user;
    }
```

移除 `signup` 方法（约第 119-134 行）。

在 `logout` 方法之后（约第 145 行）新增 `updateProfile` 和 `uploadAvatar`：

```js
    /** 修改用户名 */
    async function updateProfile(updates) {
        const resp = await fetch('/api/auth/profile', {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify(updates),
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || '修改失败');
        }

        _user = data.user;
        try { localStorage.setItem(USER_KEY, JSON.stringify(_user)); } catch (e) {}
        notify();
        return _user;
    }

    /** 上传头像 */
    async function uploadAvatar(file) {
        // 读取文件为 base64
        const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('读取文件失败'));
            reader.readAsDataURL(file);
        });

        const resp = await fetch('/api/auth/avatar', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ avatar_base64: base64 }),
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || '上传失败');
        }

        // 更新本地缓存
        _user.avatar_url = data.avatar_url;
        try { localStorage.setItem(USER_KEY, JSON.stringify(_user)); } catch (e) {}
        notify();
        return data.avatar_url;
    }
```

在 return 对象中导出新方法，替换旧的 `login` 和 `signup`：

```js
    return {
        init,
        isLoggedIn,
        getUser,
        getToken,
        sendCode,
        verifyCode,
        updateProfile,
        uploadAvatar,
        logout,
        onChange,
        getAuthHeaders,
    };
```

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/xiaokang/Desktop/歌曲"
git add js/auth.js
git commit -m "feat: add sendCode, verifyCode, updateProfile, uploadAvatar to Auth"
```

---

### Task 8: UI.js + index.html + CSS — Auth Modal 两步式 + 用户头像/菜单

**Files:**
- Modify: `js/ui.js` — `showAuthModal()`, `updateAuthUI()`, 新增头像上传逻辑
- Modify: `index.html` — 侧边栏用户区改用头像
- Modify: `css/style.css` — 新增头像/反馈按钮样式

**Interfaces:**
- Consumes: `Auth.sendCode`, `Auth.verifyCode`, `Auth.updateProfile`, `Auth.uploadAvatar`
- Produces: 两步式 Auth Modal, 头像显示/上传, 用户名修改菜单

- [ ] **Step 1: 修改 index.html 侧边栏用户区**

将侧边栏用户区（约第 84-94 行）的用户菜单部分改为：

```html
            <div class="sidebar-user" id="sidebarUser">
                <button class="btn-login" id="btnLogin" data-action="show-auth">👤 登录</button>
                <div class="user-menu-wrap" id="userMenuWrap" style="display:none">
                    <button class="btn-user-avatar" id="btnUserAvatar" data-action="toggle-user-menu">
                        <img class="sidebar-avatar-img" id="sidebarAvatarImg" src="" alt="" style="display:none">
                        <span class="sidebar-avatar-placeholder" id="sidebarAvatarPH">👤</span>
                    </button>
                    <div class="user-menu-info">
                        <span class="user-menu-name" id="btnUserLabel">用户</span>
                    </div>
                    <div class="user-dropdown" id="userDropdown" style="display:none">
                        <div class="user-dropdown-item" data-action="change-username">✏️ 修改用户名</div>
                        <div class="user-dropdown-item" data-action="change-avatar">📷 更换头像</div>
                        <div class="user-dropdown-item" data-action="logout">退出登录</div>
                    </div>
                </div>
            </div>
```

在 sidebar-user 上方（`</div>` sidebar-spacer 之后）新增反馈按钮：

```html
            <div class="sidebar-feedback">
                <button class="sidebar-feedback-btn" data-action="show-feedback">💬 意见反馈</button>
            </div>
```

- [ ] **Step 2: 修改 js/ui.js — cacheDom() 新增 DOM 引用**

在 `cacheDom()` 函数中（约第 22-107 行），修改用户区 DOM 引用：

替换原来的 `$.btnUser` 和 `$.btnUserLabel`：

```js
        $.sidebarUser = document.getElementById('sidebarUser');
        $.btnLogin = document.getElementById('btnLogin');
        $.userMenuWrap = document.getElementById('userMenuWrap');
        $.btnUserAvatar = document.getElementById('btnUserAvatar');
        $.sidebarAvatarImg = document.getElementById('sidebarAvatarImg');
        $.sidebarAvatarPH = document.getElementById('sidebarAvatarPH');
        $.btnUserLabel = document.getElementById('btnUserLabel');
        $.userDropdown = document.getElementById('userDropdown');
```

- [ ] **Step 3: 修改 js/ui.js — updateAuthUI()**

替换现有的 `updateAuthUI()` 函数（约第 595-611 行）：

```js
    function updateAuthUI() {
        if (Auth.isLoggedIn()) {
            const user = Auth.getUser();
            $.btnLogin.style.display = 'none';
            $.userMenuWrap.style.display = '';
            $.btnUserLabel.textContent = user.username || '用户';

            // 头像
            if (user.avatar_url) {
                $.sidebarAvatarImg.src = user.avatar_url;
                $.sidebarAvatarImg.style.display = '';
                $.sidebarAvatarPH.style.display = 'none';
            } else {
                $.sidebarAvatarImg.style.display = 'none';
                $.sidebarAvatarPH.style.display = '';
                $.sidebarAvatarPH.textContent = (user.username || '用')[0];
            }

            if ($.sidebarFavCount) {
                const favs = PlaylistStore.getFavorites();
                $.sidebarFavCount.textContent = favs.length;
                $.sidebarFavCount.style.display = favs.length > 0 ? '' : 'none';
            }
        } else {
            $.btnLogin.style.display = '';
            $.userMenuWrap.style.display = 'none';
            if ($.sidebarFavCount) $.sidebarFavCount.style.display = 'none';
        }
    }
```

- [ ] **Step 4: 修改 js/ui.js — showAuthModal() 两步式**

替换现有的 `showAuthModal()` 函数（约第 1372-1420 行）：

```js
    function showAuthModal() {
        let step = 'email'; // 'email' | 'code'
        let email = '';
        let countdown = 0;
        let cdTimer = null;

        function stopCountdown() {
            if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
        }

        function render() {
            const title = '👤 登录 / 注册';
            let fields;
            if (step === 'email') {
                fields = `
                    <input class="modal-input" id="authEmail" type="email" placeholder="请输入邮箱" autocomplete="email" value="${escapeHtml(email)}">
                    <div class="auth-error" id="authError" style="display:none"></div>`;
            } else {
                fields = `
                    <div class="auth-code-sent">验证码已发送至 <strong>${escapeHtml(email)}</strong></div>
                    <input class="modal-input auth-code-input" id="authCode" type="text" placeholder="请输入6位验证码" maxlength="6" autocomplete="one-time-code" inputmode="numeric">
                    <div class="auth-error" id="authError" style="display:none"></div>`;
            }
            const submitLabel = step === 'email' ? '发送验证码' : '登录 / 注册';
            const switchHtml = step === 'email'
                ? ''
                : `<a data-action="auth-back-email" style="cursor:pointer;color:var(--accent);font-size:13px">← 更换邮箱</a>`;

            showModal(title,
                `<div class="auth-form">${fields}${switchHtml ? `<div class="auth-switch">${switchHtml}</div>` : ''}</div>`,
                `<button class="btn btn-secondary" data-action="close-modal">取消</button>
                 <button class="btn btn-primary" id="btnAuthSubmit" ${countdown > 0 ? 'disabled' : ''}>${countdown > 0 ? `重新发送 (${countdown}s)` : submitLabel}</button>`
            );

            const errEl = document.getElementById('authError');
            const submitBtn = document.getElementById('btnAuthSubmit');

            submitBtn.addEventListener('click', async () => {
                try {
                    if (step === 'email') {
                        email = document.getElementById('authEmail').value.trim();
                        if (!email || !email.includes('@')) {
                            throw new Error('请输入有效的邮箱地址');
                        }
                        submitBtn.disabled = true;
                        submitBtn.textContent = '发送中…';
                        await Auth.sendCode(email);
                        // 进入验证码步骤，启动倒计时
                        step = 'code';
                        countdown = 60;
                        render();
                        cdTimer = setInterval(() => {
                            countdown--;
                            const b = document.getElementById('btnAuthSubmit');
                            if (b) {
                                if (countdown > 0) {
                                    b.textContent = `重新发送 (${countdown}s)`;
                                    b.disabled = true;
                                } else {
                                    b.textContent = '重新发送';
                                    b.disabled = false;
                                    stopCountdown();
                                }
                            }
                        }, 1000);
                    } else {
                        const code = document.getElementById('authCode').value.trim();
                        if (code.length !== 6 || !/^\d{6}$/.test(code)) {
                            throw new Error('请输入6位数字验证码');
                        }
                        submitBtn.disabled = true;
                        submitBtn.textContent = '登录中…';
                        stopCountdown();
                        await Auth.verifyCode(email, code);
                        hideModal();
                        updateAuthUI();
                        PlaylistStore.loadFromServer();
                    }
                } catch (e) {
                    if (errEl) {
                        errEl.textContent = e.message;
                        errEl.style.display = '';
                    }
                    if (submitBtn) {
                        submitBtn.disabled = countdown > 0;
                        submitBtn.textContent = countdown > 0 ? `重新发送 (${countdown}s)` : submitLabel;
                    }
                }
            });

            // 返回邮箱步骤
            const backLink = document.querySelector('[data-action="auth-back-email"]');
            if (backLink) {
                backLink.addEventListener('click', () => {
                    stopCountdown();
                    step = 'email';
                    countdown = 0;
                    render();
                });
            }

            // 自动聚焦
            setTimeout(() => {
                const el = step === 'email'
                    ? document.getElementById('authEmail')
                    : document.getElementById('authCode');
                if (el) el.focus();
            }, 100);
        }

        render();
    }
```

- [ ] **Step 5: 修改 js/ui.js — 事件委托新增 action**

在 `setupGlobalDelegation()` 的事件处理中，`// === Auth ===` 区块（约第 1148-1163 行），在 `if (action === 'logout')` 之后新增：

```js
            if (action === 'change-username') {
                $.userDropdown.style.display = 'none';
                showChangeUsernameModal();
                return;
            }
            if (action === 'change-avatar') {
                $.userDropdown.style.display = 'none';
                triggerAvatarUpload();
                return;
            }
```

- [ ] **Step 6: 在 js/ui.js 中新增辅助函数**

在 `showCreatePlaylistModal` 之后（约第 1456 行后）新增：

```js
    // ========== 修改用户名 Modal ==========
    function showChangeUsernameModal() {
        const user = Auth.getUser();
        showModal('✏️ 修改用户名',
            `<input class="modal-input" id="newUsername" type="text" placeholder="新用户名" value="${escapeHtml(user.username || '')}" maxlength="30" autocomplete="off">`,
            `<button class="btn btn-secondary" data-action="close-modal">取消</button><button class="btn btn-primary" id="btnSaveUsername">保存</button>`
        );
        document.getElementById('btnSaveUsername').addEventListener('click', async () => {
            const username = document.getElementById('newUsername').value.trim();
            if (!username) return;
            try {
                await Auth.updateProfile({ username });
                hideModal();
                updateAuthUI();
            } catch (e) {
                alert(e.message);
            }
        });
    }

    // ========== 头像上传 ==========
    let _avatarFileInput = null;

    function triggerAvatarUpload() {
        if (!_avatarFileInput) {
            _avatarFileInput = document.createElement('input');
            _avatarFileInput.type = 'file';
            _avatarFileInput.accept = 'image/png,image/jpeg,image/webp';
            _avatarFileInput.addEventListener('change', async () => {
                const file = _avatarFileInput.files[0];
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) {
                    alert('图片不能超过 2MB');
                    return;
                }
                try {
                    await Auth.uploadAvatar(file);
                    updateAuthUI();
                } catch (e) {
                    alert('头像上传失败: ' + e.message);
                }
            });
        }
        _avatarFileInput.click();
    }

    // ========== 意见反馈 Modal ==========
    function showFeedbackModal() {
        showModal('💬 意见反馈',
            `<textarea class="modal-textarea" id="feedbackContent" placeholder="请告诉我们您的想法…" rows="5" maxlength="2000"></textarea>
             <input class="modal-input" id="feedbackContact" type="text" placeholder="联系方式（选填，方便我们回复）" style="margin-top:8px">`,
            `<button class="btn btn-secondary" data-action="close-modal">取消</button><button class="btn btn-primary" id="btnSendFeedback">发送反馈</button>`
        );
        document.getElementById('btnSendFeedback').addEventListener('click', async () => {
            const content = document.getElementById('feedbackContent').value.trim();
            const contact = document.getElementById('feedbackContact').value.trim();
            if (content.length < 2) { alert('请至少输入 2 个字符'); return; }
            const btn = document.getElementById('btnSendFeedback');
            btn.disabled = true;
            btn.textContent = '发送中…';
            try {
                const resp = await fetch('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content, contact: contact || undefined }),
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error);
                hideModal();
                alert('感谢反馈！');
            } catch (e) {
                alert('发送失败: ' + e.message);
                btn.disabled = false;
                btn.textContent = '发送反馈';
            }
        });
    }
```

- [ ] **Step 7: 在事件委托中添加 feedback action**

在 `setupGlobalDelegation()` 的 `// === Auth ===` 区块，最前面新增：

```js
            if (action === 'show-feedback') {
                showFeedbackModal();
                return;
            }
```

- [ ] **Step 8: 新增 CSS 样式**

在 `css/style.css` 的 Auth 区域（约第 1860 行之后，`.btn-login` 之前或附近），新增：

```css
/* 头像按钮 */
.btn-user-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 2px solid var(--border-default);
    background: var(--bg-surface);
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color var(--duration-micro) var(--ease-out),
                transform var(--duration-micro) var(--ease-spring);
    overflow: hidden;
    flex-shrink: 0;
}

.btn-user-avatar:hover {
    border-color: var(--accent);
    transform: scale(1.05);
}

.sidebar-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
}

.sidebar-avatar-placeholder {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: var(--bg-hover);
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 600;
}

/* 用户菜单信息行 */
.user-menu-info {
    padding: 4px 0 0 0;
    text-align: center;
}

.user-menu-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
}

/* 用户菜单 wrap 调整为 flex 列布局 */
.user-menu-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
}

/* 反馈按钮 */
.sidebar-feedback {
    padding: 0 var(--space-lg) var(--space-sm);
}

.sidebar-feedback-btn {
    width: 100%;
    padding: 8px 14px;
    border: 1px solid var(--border-subtle);
    background: transparent;
    color: var(--text-tertiary);
    font-size: 13px;
    font-weight: 500;
    border-radius: var(--radius-full);
    cursor: pointer;
    font-family: var(--font-sans);
    transition: color var(--duration-micro) var(--ease-out),
                border-color var(--duration-micro) var(--ease-out);
}

.sidebar-feedback-btn:hover {
    color: var(--text-primary);
    border-color: var(--border-default);
}

/* Auth Modal 验证码发送提示 */
.auth-code-sent {
    font-size: 13px;
    color: var(--text-secondary);
    text-align: center;
    padding: 4px 0;
}

.auth-code-input {
    text-align: center;
    letter-spacing: 8px;
    font-size: 24px !important;
    font-weight: 700;
}

/* Modal textarea */
.modal-textarea {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-size: 14px;
    font-family: var(--font-sans);
    resize: vertical;
    outline: none;
    transition: border-color var(--duration-micro) var(--ease-out);
}

.modal-textarea:focus {
    border-color: var(--accent);
}
```

- [ ] **Step 9: Commit**

```bash
cd "c:/Users/xiaokang/Desktop/歌曲"
git add js/ui.js index.html css/style.css
git commit -m "feat: 2-step auth modal, user avatar/menu, feedback button and modal"
```

---

### Task 9: UI.js — 图标替换 + 音量修复 + 集合去背景

**Files:**
- Modify: `js/ui.js` — `updateModeDisplay()`, `setupGlobalDelegation()` 音量事件, `renderCollectionItemsGrid()`

**Interfaces:**
- Consumes: `Player.setVolume`, SVG icon strings
- Produces: 新图标渲染, 音量可用, 集合卡片无外部背景图

- [ ] **Step 1: 替换 updateModeDisplay() — SVG 图标**

替换现有的 `updateModeDisplay()` 函数（约第 505-511 行）：

```js
    const MODE_ICONS = {
        'loop-all': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 7 7 2 12 7"/><path d="M7 22V2"/><polyline points="22 17 17 22 12 17"/><path d="M17 2v20"/></svg>`,
        'loop-single': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12C2 6.5 6.5 2 12 2s10 4.5 10 10-4.5 10-10 10"/><polyline points="2 8 2 12 6 12"/><text x="18" y="13" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="700">1</text></svg>`,
        'shuffle': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,
    };

    const VOLUME_ICONS = {
        high: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
        medium: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
        low: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg>`,
        mute: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
    };

    function updateModeDisplay() {
        const mode = Player.getMode();
        $.btnMode.innerHTML = MODE_ICONS[mode] || MODE_ICONS['loop-all'];
        $.btnMode.className = 'btn-ctrl btn-mode';
        if (mode === 'loop-all') { $.btnMode.classList.add('loop-all'); $.btnMode.title = '列表循环'; }
        if (mode === 'loop-single') { $.btnMode.classList.add('loop-single'); $.btnMode.title = '单曲循环'; }
        if (mode === 'shuffle') { $.btnMode.classList.add('shuffle'); $.btnMode.title = '随机播放'; }
    }

    function updateVolumeIcon() {
        const v = Player.getVolume();
        let icon;
        if (v === 0) icon = VOLUME_ICONS.mute;
        else if (v < 0.3) icon = VOLUME_ICONS.low;
        else if (v < 0.6) icon = VOLUME_ICONS.medium;
        else icon = VOLUME_ICONS.high;
        $.btnVolume.innerHTML = icon;
    }
```

- [ ] **Step 2: 修复音量控制**

在 `setupGlobalDelegation()` 中（约第 1246-1257 行），替换音量相关代码：

```js
        // 音量 — 初始状态
        Player.setVolume(0.8);
        updateVolumeIcon();

        $.btnVolume.addEventListener('click', () => {
            $.volumePopup.style.display = $.volumePopup.style.display === 'none' ? '' : 'none';
        });
        $.volumeSlider.addEventListener('input', () => {
            Player.setVolume($.volumeSlider.value / 100);
            updateVolumeIcon();
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.player-right')) {
                $.volumePopup.style.display = 'none';
            }
        });
```

- [ ] **Step 3: 集合子目录去除背景图**

修改 `renderCollectionItemsGrid()` 函数（约第 266-287 行），移除 yumus.cn 背景图：

将：
```js
            const bgSeed = i * 53 + 19;
            const bgStyle = hasBvid
                ? `background-image: url('https://www.yumus.cn/api/?target=img&brand=360&type=7&_=${bgSeed}')`
                : '';
            html += `
            <div class="tag-card tag-card--image ${!hasBvid ? 'tag-card--empty' : ''}" style="--tag-color:${getCoverFallbackColor(i)};--stagger-index:${Math.min(i, 19)};${bgStyle};background-size:cover;background-position:center" data-action="${action}" data-bvid="${escapeHtml(it.bvid || '')}" data-item-title="${escapeHtml(it.title)}">
```

改为：
```js
            const bgColor = getCoverFallbackColor(i);
            const bgStyle = hasBvid
                ? `background: linear-gradient(135deg, ${bgColor} 0%, ${bgColor}88 100%)`
                : '';
            html += `
            <div class="tag-card tag-card--image ${!hasBvid ? 'tag-card--empty' : ''}" style="--tag-color:${bgColor};--stagger-index:${Math.min(i, 19)};${bgStyle}" data-action="${action}" data-bvid="${escapeHtml(it.bvid || '')}" data-item-title="${escapeHtml(it.title)}">
```

- [ ] **Step 4: 更新 Player 事件中调用 updateVolumeIcon**

在 `setupPlayerEvents()` 的 `init` 完成后，确保音量图标初始状态正确。在 `init()` 函数末尾（约 `setupPlayerEvents()` 调用之后），添加：

```js
        // 初始化音量图标
        updateVolumeIcon();
```

- [ ] **Step 5: Commit**

```bash
cd "c:/Users/xiaokang/Desktop/歌曲"
git add js/ui.js
git commit -m "feat: SVG icons for mode/volume, fix volume control, remove collection bg images"
```

---

### Task 10: CSS — svg 图标微调 + 旧 CSS 清理

**Files:**
- Modify: `css/style.css` — 调整模式按钮和音量按钮样式适配 SVG

**Interfaces:**
- Consumes: SVG icons in `.btn-mode` and `.btn-volume`
- Produces: 图标正确渲染，颜色继承

- [ ] **Step 1: 调整图标按钮 CSS**

在 `.btn-mode` 样式区域（约第 1619-1649 行），修改为适配 SVG：

```css
.btn-mode {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
}

.btn-mode svg {
    display: block;
}

.btn-mode.loop-all { color: var(--text-secondary); }
.btn-mode.loop-single { color: var(--accent); }
.btn-mode.shuffle { color: var(--accent); }

/* 移除旧的 ::after 数字标识（SVG 自带） */
.btn-mode.loop-single::after {
    display: none;
}
```

在 `.btn-volume` 样式区域（约第 1718-1721 行），确保 SVG 正确显示：

```css
.btn-volume {
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
}

.btn-volume svg {
    display: block;
}
```

- [ ] **Step 2: Commit**

```bash
cd "c:/Users/xiaokang/Desktop/歌曲"
git add css/style.css
git commit -m "style: adapt mode/volume buttons for SVG icons, clean up old ::after"
```

---

### Task 11: 验证测试

**Files:** 无

- [ ] **Step 1: 启动服务器**

```bash
/d/softwa/nodejs/node server.js
```

确认输出 `[mail] SMTP 就绪 (lexiaode@163.com)` 和 `listening on http://localhost:8765`。

- [ ] **Step 2: 测试发送验证码**

```bash
curl -s -X POST http://localhost:8765/api/auth/send-code -H "Content-Type: application/json" -d '{"email":"lexiaode@163.com"}'
```

确认返回 `{"ok":true}`，检查 163 邮箱是否收到验证码。

- [ ] **Step 3: 测试验证码登录**

```bash
# 用收到的验证码替换 XXXXXX
curl -s -X POST http://localhost:8765/api/auth/login -H "Content-Type: application/json" -d '{"email":"lexiaode@163.com","code":"XXXXXX"}'
```

确认返回 `user` 和 `session` 对象。

- [ ] **Step 4: 测试修改用户名**

```bash
TOKEN="<上述返回的 access_token>"
curl -s -X PATCH http://localhost:8765/api/auth/profile -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"username":"测试用户"}'
```

确认返回更新后的 user。

- [ ] **Step 5: 测试意见反馈**

```bash
curl -s -X POST http://localhost:8765/api/feedback -H "Content-Type: application/json" -d '{"content":"测试反馈，一切正常！","contact":"test@test.com"}'
```

确认 163 邮箱收到反馈邮件。

- [ ] **Step 6: 浏览器测试**

1. 打开 `http://localhost:8765`
2. 点击侧边栏"登录" → 验证两步式 Auth Modal
3. 登录后验证头像显示、用户名修改、头像上传
4. 验证播放模式按钮（循环/随机）图标是否正常 SVG
5. 调节音量滑块验证音量是否实际变化
6. 进入"歌曲汇总" → 子目录确认背景为渐变色而非外部图片
7. 点击侧边栏底部"意见反馈"确认功能正常

---

## 实施顺序

Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

每个 Task 独立可测，完成后 commit。Task 11 是最终集成验证。
