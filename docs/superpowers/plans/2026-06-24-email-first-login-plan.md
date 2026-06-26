# Email-First 登录流程重设计 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将双 tab 登录弹窗替换为成熟产品的邮箱优先（Email-first）单步流程

**Architecture:** 3 状态弹窗（email → password/register）替代双 tab；后端新增 `check-email` 端点和 `mode: "register"` 注册模式

**Tech Stack:** Node.js Express + vanilla JS (IIFE)，Supabase Auth + PostgreSQL

## Global Constraints

- 无新依赖，用 Node.js 内置 `crypto` 签 JWT
- 弹窗重用现有 `showModal()` / `hideModal()` 函数
- 密码最少 6 位，邮箱需含 `@`
- 验证码 6 位数字，60s 重发倒计时

---

### Task 1: 后端 — 新增 `/api/auth/check-email` 端点

**Files:**
- Modify: `server.js`（在 `app.post('/api/auth/login', ...)` 之前插入）

**Interfaces:**
- Consumes: `supabaseAdmin` (service_role client)
- Produces: `POST /api/auth/check-email` → `{ exists: boolean }`

- [ ] **Step 1: 在 login 端点前插入 check-email 端点**

在 `/** POST /api/auth/login */` 注释行之前插入以下代码：

```javascript
/** POST /api/auth/check-email — 邮箱优先登录：检查账号是否存在 */
app.post('/api/auth/check-email', async (req, res) => {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }

    try {
        const { data: profile } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        res.json({ exists: !!profile });
    } catch (err) {
        console.error('[check-email]', err.message);
        res.status(500).json({ error: '查询失败' });
    }
});
```

- [ ] **Step 2: 重启服务器并测试端点**

```bash
# 测试已存在用户
curl -s -X POST http://localhost:8765/api/auth/check-email \
  -H "Content-Type: application/json" \
  -d '{"email":"lexiaode@163.com"}'
# 预期: {"exists":true}

# 测试不存在用户
curl -s -X POST http://localhost:8765/api/auth/check-email \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@example.com"}'
# 预期: {"exists":false}
```

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: add /api/auth/check-email endpoint for email-first login"
```

---

### Task 2: 后端 — 新增 `mode: "register"` 注册模式

**Files:**
- Modify: `server.js:706-813`（`/api/auth/login` 处理函数）

**Interfaces:**
- Consumes: `supabase`, `supabaseAdmin`
- Produces: `POST /api/auth/login` 支持 `mode: "register"`（含 email + code + password）

- [ ] **Step 1: 在 login 端点开头添加 mode 分发逻辑**

将当前 `app.post('/api/auth/login', async (req, res) => {` 所在行之后的 `const { email, code, password } = req.body;` 替换为：

```javascript
app.post('/api/auth/login', async (req, res) => {
    const { email, code, password, mode } = req.body;

    if (!email) {
        return res.status(400).json({ error: '请输入邮箱' });
    }

    // ===== 注册模式：验证码 + 密码一次性完成注册 =====
    if (mode === 'register') {
        if (!code) return res.status(400).json({ error: '请输入验证码' });
        if (!password || password.length < 6) return res.status(400).json({ error: '密码长度至少 6 位' });

        try {
            // 1. 验证验证码
            const { data: vcRecord, error: vcError } = await supabaseAdmin
                .from('verification_codes')
                .select('*')
                .eq('email', email)
                .eq('code', code)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (vcError || !vcRecord) {
                return res.status(401).json({ error: '验证码错误' });
            }
            if (vcRecord.used) {
                return res.status(401).json({ error: '验证码已使用' });
            }
            const now = new Date();
            if (now > new Date(vcRecord.expires_at)) {
                return res.status(401).json({ error: '验证码已过期，请重新发送' });
            }

            // 标记验证码已使用
            await supabaseAdmin
                .from('verification_codes')
                .update({ used: true })
                .eq('id', vcRecord.id);

            // 2. 创建 Auth 用户（用真正的密码，不用临时密码）
            const { data: newAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
            });

            if (createErr) {
                console.error('[login-register] create error:', createErr.message);
                return res.status(500).json({ error: '创建用户失败' });
            }

            const userId = newAuth.user.id;
            const username = email.split('@')[0];
            const avatarUrl = `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(username)}`;

            // 3. 插入 public.users 资料
            const { error: dbErr } = await supabaseAdmin
                .from('users')
                .insert({ id: userId, username, email, avatar_url: avatarUrl });

            if (dbErr) {
                await supabaseAdmin.auth.admin.deleteUser(userId);
                console.error('[login-register] profile error:', dbErr.message);
                return res.status(500).json({ error: '创建用户资料失败' });
            }

            // 4. 用真实密码登录获取 session
            const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (signInErr) {
                console.error('[login-register] signin error:', signInErr.message);
                return res.status(500).json({ error: '登录失败，请重试' });
            }

            return res.json({
                user: { id: userId, email, username, avatar_url: avatarUrl || null },
                session: {
                    access_token: signInData.session.access_token,
                    refresh_token: signInData.session.refresh_token,
                    expires_at: signInData.session.expires_at,
                },
                is_new_user: true,
            });
        } catch (err) {
            console.error('[login-register]', err.message);
            return res.status(500).json({ error: '注册失败' });
        }
    }

    // ===== 密码登录 =====
    if (password) {
```

- [ ] **Step 2: 确保密码登录和验证码登录逻辑不变**

后续代码保持不变——`if (password)` 密码登录和 `if (code)` 验证码登录的逻辑紧接在注册模式分支之后，无需修改。

- [ ] **Step 3: 重启并测试注册端点**

```bash
# 先发送验证码
curl -s -X POST http://localhost:8765/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email":"test-new@example.com"}'
# 预期: {"ok":true}

# 用验证码 + 密码注册（code 需要是真实的）
curl -s -X POST http://localhost:8765/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test-new@example.com","code":"123456","password":"mypassword","mode":"register"}'
# 预期: {"user":{...},"session":{...},"is_new_user":true}
```

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: add mode=register to /api/auth/login for one-step signup"
```

---

### Task 3: 前端 — `js/auth.js` 新增方法

**Files:**
- Modify: `js/auth.js:226-241`（return 对象）

**Interfaces:**
- Consumes: fetch API
- Produces: `Auth.checkEmail(email)` → `{ exists }`, `Auth.register(email, code, password)` → login result

- [ ] **Step 1: 在 `verifyCode` 函数之后插入新方法**

在 `verifyCode` 函数（约第 131 行）之后插入：

```javascript
    /** 检查邮箱是否已注册 */
    async function checkEmail(email) {
        const resp = await fetch('/api/auth/check-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || '查询失败');
        }
        return data;
    }

    /** 注册新用户：验证码 + 密码一步完成 */
    async function register(email, code, password) {
        const resp = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code, password, mode: 'register' }),
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || '注册失败');
        }

        saveSession(data.session, data.user);
        return data;
    }
```

- [ ] **Step 2: 在 return 对象中导出新方法**

```javascript
    return {
        init,
        isLoggedIn,
        getUser,
        getToken,
        sendCode,
        verifyCode,
        loginWithPassword,
        checkEmail,        // 新增
        register,          // 新增
        setPassword,
        updateProfile,
        uploadAvatar,
        logout,
        onChange,
        getAuthHeaders,
    };
```

- [ ] **Step 3: Commit**

```bash
git add js/auth.js
git commit -m "feat: add Auth.checkEmail() and Auth.register() for email-first flow"
```

---

### Task 4: 前端 — 重写 `showAuthModal()` 为 Email-First 3 状态

**Files:**
- Modify: `js/ui.js:1527-1766`（整个 `showAuthModal` 函数）
- Remove: `js/ui.js:1780-1830`（`showSetPasswordModal` 函数，不再需要）
- Modify: `js/ui.js:1713`（调用 `showSetPasswordModal` 的地方改为不需要）

**Interfaces:**
- Consumes: `Auth.checkEmail`, `Auth.loginWithPassword`, `Auth.sendCode`, `Auth.verifyCode`, `Auth.register`, `showModal`, `hideModal`, `updateAuthUI`, `PlaylistStore.loadFromServer`
- Produces: 3 状态 Email-first 登录弹窗

- [ ] **Step 1: 移除旧函数**

1. 删除整个 `showSetPasswordModal()` 函数（约 `js/ui.js:1780-1830`）
2. 删除整个 `showAuthModal()` 函数（约 `js/ui.js:1527-1766`）
3. 删除 `showAuthModal` 内调用 `showSetPasswordModal` 的那行（`js/ui.js:1714` 附近）

- [ ] **Step 2: 写入新的 `showAuthModal()` 函数**

在原 `showAuthModal` 位置写入：

```javascript
    /**
     * Email-First 登录弹窗
     * 3 个状态：'email' → 'password'（已有账号）/ 'register'（新用户）
     */
    function showAuthModal() {
        let state = 'email';    // 'email' | 'password' | 'register'
        let email = '';
        let isNewUser = false;  // true = 新注册，false = 已有账号用验证码
        let countdown = 0;
        let cdTimer = null;

        function stopCountdown() {
            if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
        }

        function render() {
            let fields, btnText;

            if (state === 'email') {
                // ===== 状态 1: 输入邮箱 =====
                fields = `
                    <input class="modal-input" id="authEmail" type="email" placeholder="请输入邮箱地址" autocomplete="email" value="${escapeHtml(email)}">
                    <div class="auth-error" id="authError" style="display:none"></div>`;
                btnText = '继续';
            } else if (state === 'password') {
                // ===== 状态 2: 已有账号 → 输入密码 =====
                fields = `
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:13px;color:var(--text-secondary)">
                        <span style="cursor:pointer;color:var(--accent)" data-action="auth-back">← 返回</span>
                        <span>${escapeHtml(email)}</span>
                    </div>
                    <input class="modal-input" id="authPassword" type="password" placeholder="请输入密码" autocomplete="current-password">
                    <div class="auth-error" id="authError" style="display:none"></div>
                    <div style="margin-top:10px;text-align:center">
                        <a data-action="auth-use-code" style="cursor:pointer;color:var(--accent);font-size:13px">用验证码登录</a>
                    </div>`;
                btnText = '登录';
            } else {
                // ===== 状态 3: 新用户 或 已有账号验证码登录 =====
                const hint = isNewUser
                    ? `验证码已发送至 <strong>${escapeHtml(email)}</strong>`
                    : `验证码已发送至 <strong>${escapeHtml(email)}</strong>`;

                const passwordField = isNewUser
                    ? `<input class="modal-input" id="authPassword" type="password" placeholder="设置密码（至少6位）" autocomplete="new-password" style="margin-top:8px">`
                    : '';

                fields = `
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:13px;color:var(--text-secondary)">
                        <span style="cursor:pointer;color:var(--accent)" data-action="auth-back">← 更换邮箱</span>
                    </div>
                    <div class="auth-code-sent">${hint}</div>
                    <input class="modal-input auth-code-input" id="authCode" type="text" placeholder="请输入6位验证码" maxlength="6" autocomplete="one-time-code" inputmode="numeric">
                    ${passwordField}
                    <div class="auth-error" id="authError" style="display:none"></div>
                    <div style="margin-top:10px;text-align:center">
                        <a id="btnResend" style="cursor:pointer;color:var(--accent);font-size:13px;${countdown > 0 ? 'opacity:0.5;pointer-events:none' : ''}">${countdown > 0 ? `重新发送 (${countdown}s)` : '重新发送'}</a>
                    </div>`;
                btnText = isNewUser ? '注册' : '登录';
            }

            showModal(
                state === 'email' ? '👤 登录 / 注册' : (isNewUser ? '✨ 创建账号' : '🔑 登录'),
                `<div class="auth-form">${fields}</div>`,
                `<button class="btn btn-secondary" data-action="close-modal">取消</button>
                 <button class="btn btn-primary" id="btnAuthSubmit">${btnText}</button>`
            );

            const errEl = document.getElementById('authError');
            const submitBtn = document.getElementById('btnAuthSubmit');

            // 返回链接 (password / register state)
            const backLink = document.querySelector('[data-action="auth-back"]');
            if (backLink) {
                backLink.addEventListener('click', () => {
                    stopCountdown();
                    state = 'email';
                    countdown = 0;
                    isNewUser = false;
                    render();
                });
            }

            // "用验证码登录" 链接 (password state)
            const useCodeLink = document.querySelector('[data-action="auth-use-code"]');
            if (useCodeLink) {
                useCodeLink.addEventListener('click', async () => {
                    const btn = useCodeLink;
                    btn.style.pointerEvents = 'none';
                    btn.textContent = '发送中…';
                    try {
                        await Auth.sendCode(email);
                        isNewUser = false;  // 已有账号，不用设密码
                        state = 'register';
                        countdown = 60;
                        render();
                        startCountdownTimer();
                    } catch (e) {
                        btn.style.pointerEvents = '';
                        btn.textContent = '用验证码登录';
                        if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
                    }
                });
            }

            // 重新发送链接 (register state)
            const resendBtn = document.getElementById('btnResend');
            if (resendBtn) {
                resendBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    if (countdown > 0) return;
                    resendBtn.textContent = '发送中…';
                    resendBtn.style.pointerEvents = 'none';
                    try {
                        await Auth.sendCode(email);
                        countdown = 60;
                        resendBtn.textContent = `重新发送 (${countdown}s)`;
                        resendBtn.style.opacity = '0.5';
                        resendBtn.style.pointerEvents = 'none';
                        cdTimer = setInterval(() => {
                            countdown--;
                            const b = document.getElementById('btnResend');
                            if (b) {
                                if (countdown > 0) {
                                    b.textContent = `重新发送 (${countdown}s)`;
                                } else {
                                    b.textContent = '重新发送';
                                    b.style.opacity = '';
                                    b.style.pointerEvents = '';
                                    stopCountdown();
                                }
                            }
                        }, 1000);
                    } catch (e2) {
                        resendBtn.textContent = '重新发送';
                        resendBtn.style.opacity = '';
                        resendBtn.style.pointerEvents = '';
                        if (errEl) { errEl.textContent = e2.message; errEl.style.display = ''; }
                    }
                });
            }

            function startCountdownTimer() {
                stopCountdown();
                cdTimer = setInterval(() => {
                    countdown--;
                    const b = document.getElementById('btnResend');
                    if (b) {
                        if (countdown > 0) {
                            b.textContent = `重新发送 (${countdown}s)`;
                        } else {
                            b.textContent = '重新发送';
                            b.style.opacity = '';
                            b.style.pointerEvents = '';
                            stopCountdown();
                        }
                    }
                }, 1000);
            }

            // 提交按钮
            submitBtn.addEventListener('click', async () => {
                try {
                    if (state === 'email') {
                        // ===== Email → 检查账号 =====
                        email = document.getElementById('authEmail').value.trim();
                        if (!email || !email.includes('@')) {
                            throw new Error('请输入有效的邮箱地址');
                        }
                        submitBtn.disabled = true;
                        submitBtn.textContent = '查询中…';

                        const result = await Auth.checkEmail(email);

                        if (result.exists) {
                            // 已有账号 → 密码登录
                            state = 'password';
                            render();
                        } else {
                            // 新用户 → 发送验证码 → 注册
                            isNewUser = true;
                            submitBtn.textContent = '发送中…';
                            await Auth.sendCode(email);
                            state = 'register';
                            countdown = 60;
                            render();
                            startCountdownTimer();
                        }
                    } else if (state === 'password') {
                        // ===== 密码登录 =====
                        const pwd = document.getElementById('authPassword').value;
                        if (!pwd) throw new Error('请输入密码');
                        submitBtn.disabled = true;
                        submitBtn.textContent = '登录中…';
                        await Auth.loginWithPassword(email, pwd);
                        hideModal();
                        updateAuthUI();
                        PlaylistStore.loadFromServer();
                    } else {
                        // ===== 注册 / 验证码登录 =====
                        const code = document.getElementById('authCode').value.trim();
                        if (code.length !== 6 || !/^\d{6}$/.test(code)) {
                            throw new Error('请输入6位数字验证码');
                        }

                        if (isNewUser) {
                            // 新用户：验证码 + 密码 → 注册
                            const pwd = document.getElementById('authPassword').value;
                            if (!pwd || pwd.length < 6) {
                                throw new Error('密码长度至少 6 位');
                            }
                            submitBtn.disabled = true;
                            submitBtn.textContent = '注册中…';
                            stopCountdown();
                            await Auth.register(email, code, pwd);
                        } else {
                            // 已有账号：验证码 → 登录
                            submitBtn.disabled = true;
                            submitBtn.textContent = '登录中…';
                            stopCountdown();
                            await Auth.verifyCode(email, code);
                        }

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
                        submitBtn.disabled = false;
                        if (state === 'email') submitBtn.textContent = '继续';
                        else if (state === 'password') submitBtn.textContent = '登录';
                        else submitBtn.textContent = isNewUser ? '注册' : '登录';
                    }
                }
            });

            // 自动聚焦
            setTimeout(() => {
                if (state === 'email') {
                    const el = document.getElementById('authEmail');
                    if (el) el.focus();
                } else if (state === 'password') {
                    const el = document.getElementById('authPassword');
                    if (el) el.focus();
                } else {
                    const el = document.getElementById('authCode');
                    if (el) el.focus();
                }
            }, 100);

            // Enter 键提交
            const keyEls = [document.getElementById('authEmail'),
                           document.getElementById('authPassword'),
                           document.getElementById('authCode')];
            keyEls.forEach(el => {
                if (el) {
                    el.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            const btn = document.getElementById('btnAuthSubmit');
                            if (btn && !btn.disabled) btn.click();
                        }
                    });
                }
            });
        }

        render();
    }
```

- [ ] **Step 3: 移除 `showSetPasswordModal` 调用处**

找到 `js/ui.js` 中调用 `showSetPasswordModal()` 的位置（应在 `showAuthModal` 旧的验证码登录成功处，约 1714 行），确保已随旧 `showAuthModal` 一起删除。（如果 `showSetPasswordModal` 在其他地方被调用，一并清理。）

- [ ] **Step 4: Commit**

```bash
git add js/ui.js
git commit -m "feat: rewrite auth modal as email-first 3-state flow"
```

---

### Task 5: 端到端测试

- [ ] **Step 1: 测试新用户注册流程**

```bash
# 1. 检查邮箱不存在
curl -s -X POST http://localhost:8765/api/auth/check-email \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e-test@example.com"}'
# 预期: {"exists":false}

# 2. 发送验证码
curl -s -X POST http://localhost:8765/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e-test@example.com"}'
# 预期: {"ok":true}

# 3. 用验证码+密码注册（替换 <CODE> 为真实验证码）
curl -s -X POST http://localhost:8765/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e-test@example.com","code":"<CODE>","password":"mypass123","mode":"register"}'
# 预期: {"user":{...},"session":{...},"is_new_user":true}

# 4. 用密码登录验证
curl -s -X POST http://localhost:8765/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"e2e-test@example.com","password":"mypass123"}'
# 预期: {"user":{...},"session":{...},"is_new_user":false}

# 5. 再次验证码登录 → 密码不应被覆盖
# （发送验证码后用 mode 不含 register 的 code 登录，再用密码验证）
```

- [ ] **Step 2: 测试已有用户密码登录**

```bash
curl -s -X POST http://localhost:8765/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"lexiaode@163.com","password":"test123456"}'
# 预期: {"user":{...},"session":{...},"is_new_user":false}
```

- [ ] **Step 3: 测试已有用户验证码登录**

```bash
# 1. 发送验证码
curl -s -X POST http://localhost:8765/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"email":"lexiaode@163.com"}'

# 2. 验证码登录
curl -s -X POST http://localhost:8765/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"lexiaode@163.com","code":"<CODE>"}'
# 预期: {"user":{...},"session":{...},"is_new_user":false}

# 3. 密码登录仍然有效
curl -s -X POST http://localhost:8765/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"lexiaode@163.com","password":"test123456"}'
# 预期: {"user":{...},"session":{...},"is_new_user":false}
```

- [ ] **Step 4: Commit（如有修正）**

```bash
git add -A
git commit -m "test: verify email-first login flow end-to-end"
```
