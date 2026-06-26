-- 验证码表
CREATE TABLE IF NOT EXISTS verification_codes (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 minutes'),
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vc_email_code ON verification_codes(email, code, expires_at, used);

-- 用户头像列
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
