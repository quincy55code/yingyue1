/**
 * auth.js — 用户认证状态管理
 * ============================
 * 管理登录/注册/登出、会话持久化（localStorage）、
 * 提供 onChange 回调供 UI 订阅状态变化。
 */
const Auth = (() => {
    const SESSION_KEY = 'music_player_session';
    const USER_KEY = 'music_player_user';

    let _session = null;   // { access_token, refresh_token, expires_at }
    let _user = null;      // { id, email, username }
    let _listeners = [];

    function notify() {
        _listeners.forEach(fn => fn(_user));
    }

    /** 注册状态变化回调 */
    function onChange(fn) {
        _listeners.push(fn);
        return () => { _listeners = _listeners.filter(f => f !== fn); };
    }

    function isLoggedIn() {
        return !!(_session && _session.access_token);
    }

    function getUser() {
        return _user;
    }

    function getToken() {
        return _session ? _session.access_token : null;
    }

    // 供 PlaylistStore 使用的 headers 构建方法
    function getAuthHeaders() {
        const token = getToken();
        if (!token) return { 'Content-Type': 'application/json' };
        return {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
        };
    }

    /** 保存会话到 localStorage */
    function saveSession(session, user) {
        _session = session;
        _user = user;
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
            localStorage.setItem(USER_KEY, JSON.stringify(user));
        } catch (e) { /* ignore */ }
        notify();
    }

    /** 清除会话 */
    function clearSession() {
        _session = null;
        _user = null;
        try {
            localStorage.removeItem(SESSION_KEY);
            localStorage.removeItem(USER_KEY);
        } catch (e) { /* ignore */ }
        notify();
    }

    /** 初始化：尝试从 localStorage 恢复会话并验证 */
    async function init() {
        try {
            const savedSession = localStorage.getItem(SESSION_KEY);
            const savedUser = localStorage.getItem(USER_KEY);
            if (!savedSession || !savedUser) return;

            _session = JSON.parse(savedSession);
            _user = JSON.parse(savedUser);

            // 检查 token 是否过期
            if (_session.expires_at && Date.now() > _session.expires_at * 1000) {
                clearSession();
                return;
            }

            // 向服务器验证会话有效性
            const resp = await fetch('/api/auth/me', {
                headers: { 'Authorization': 'Bearer ' + _session.access_token },
            });

            if (resp.ok) {
                const data = await resp.json();
                _user = data.user;
                notify();
            } else {
                clearSession();
            }
        } catch (e) {
            clearSession();
        }
    }

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
        return data;
    }

    /** 检查邮箱是否已注册（用于 email-first 流程） */
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

    /** 忘记密码：验证码 + 新密码重置 */
    async function resetPassword(email, code, password) {
        const resp = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code, password }),
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || '重置密码失败');
        }
        return data;
    }

    /** 密码登录 */
    async function loginWithPassword(email, password) {
        const resp = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || '登录失败');
        }

        saveSession(data.session, data.user);
        return data;
    }

    /** 设置密码（首次注册后或忘记密码后） */
    async function setPassword(password) {
        const resp = await fetch('/api/auth/set-password', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ password }),
        });

        const data = await resp.json();
        if (!resp.ok) {
            throw new Error(data.error || '设置密码失败');
        }

        return data;
    }

    /** 登出 */
    async function logout() {
        try {
            if (_session) {
                await fetch('/api/auth/logout', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + _session.access_token },
                });
            }
        } catch (e) { /* ignore */ }
        clearSession();
    }

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

    return {
        init,
        isLoggedIn,
        getUser,
        getToken,
        sendCode,
        verifyCode,
        checkEmail,
        register,
        resetPassword,
        loginWithPassword,
        setPassword,
        updateProfile,
        uploadAvatar,
        logout,
        onChange,
        getAuthHeaders, // 占位，上面会覆盖
    };
})();
