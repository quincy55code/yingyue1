# Email-First 登录流程重设计

**日期**: 2026-06-24
**目标**: 将当前双 tab（验证码登录/密码登录）替换为成熟的邮箱优先（Email-first）流程

## 当前问题

- 默认 tab 是"验证码登录"，回访用户需要多点击一次
- "登录 / 注册"按钮语义模糊
- 新用户注册是隐式的，设置密码是事后弹窗（可被跳过，导致以后无法密码登录）
- 两个 tab 没有清晰区分"已有账号"和"新用户"

## 目标流程

```
邮箱输入 → 检查账号是否存在
              │
     ┌────────┴────────┐
     ▼                 ▼
  已有账号           新用户
     │                 │
  输入密码           发送验证码 → 验证 → 设置密码 → 完成
     │                 │
  登录成功          同时创建 Auth 用户 + public.users 资料
```

## 后端变更

### 新增 `POST /api/auth/check-email`

```json
// Request:  { "email": "..." }
// Response: { "exists": true, "has_password": true }
```

- 查询 `public.users` 判断是否存在 profile
- 同时查询 Supabase Auth 判断是否有密码（通过 `listUsers` 或尝试获取用户信息）
- 如 `exists=false` → 前端走注册流程
- 如 `exists=true` → 前端走密码登录流程（也可切换验证码）

### 修改 `POST /api/auth/login`

新增操作模式参数 `mode`:
- `mode: "password"` — 现有密码登录逻辑（不变）
- `mode: "code"` — 现有验证码登录逻辑（不变）
- `mode: "register"` — **注册模式**：创建用户 → 同时设置密码 → 返回 session

`mode: "register"` 流程：
1. 创建 Supabase Auth 用户（带用户提供的密码，不用临时密码）
2. 插入 `public.users` 资料
3. signInWithPassword 获取 session
4. 返回 session + user（`is_new_user: true`）

### 移除

- 不再需要 `completeLogin()` 用临时密码覆盖已有用户密码的逻辑
- `completeLogin()` 简化：已有用户签发自定义 JWT（保留），新用户由 `mode: "register"` 处理

## 前端变更

### 弹窗状态机（3 个状态）

| 状态 | 界面 | 说明 |
|------|------|------|
| `email` | 邮箱输入框 + "继续" | 初始状态 |
| `password` | 邮箱（已确认）+ 密码输入框 + "登录" + "用验证码登录"链接 | 已有账号 |
| `register` | 邮箱 + "已发送验证码至 xxx" + 验证码输入框 + 密码输入框 + "注册" | 新用户，密码同步设置 |

### 流程

1. 输入邮箱 → 点击"继续" → 调用 `/api/auth/check-email`
2. `exists=true` → 切换到 `password` 状态
3. `exists=false` → 自动发送验证码 → 切换到 `register` 状态
4. `password` 状态中点击"用验证码登录" → 发送验证码 → 切换到 `register` 状态（但不显示密码框，改为验证成功后设置）

### 实现文件

- `js/ui.js` — 重写 `showAuthModal()` 函数（约 180 行）
- `server.js` — 新增 `/api/auth/check-email`、新增 `mode: "register"`、简化 `completeLogin()`
