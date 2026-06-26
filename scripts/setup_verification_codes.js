/**
 * setup_verification_codes.js — 创建 verification_codes 表 + 添加 avatar_url 列
 * 直连 Supabase PostgreSQL 执行 DDL
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const PASS = fs.readFileSync(path.join(__dirname, '..', '.superpowers', 'db_pass.txt'), 'utf-8').trim();

const client = new Client({
    host: 'db.orphftlwdwuvoscizndx.supabase.co',
    port: 5432,
    user: 'postgres',
    password: PASS,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
});

async function main() {
    await client.connect();
    console.log('[ok] 已连接数据库');

    // 1. 创建 verification_codes 表
    await client.query(`
        CREATE TABLE IF NOT EXISTS verification_codes (
            id BIGSERIAL PRIMARY KEY,
            email TEXT NOT NULL,
            code TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 minutes'),
            used BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    console.log('[ok] verification_codes 表已创建');

    // 2. 创建索引
    await client.query(`
        CREATE INDEX IF NOT EXISTS idx_vc_email_code
        ON verification_codes(email, code, expires_at, used)
    `);
    console.log('[ok] idx_vc_email_code 索引已创建');

    // 3. 添加 avatar_url 列
    await client.query(`
        ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url TEXT
    `);
    console.log('[ok] users.avatar_url 列已添加');

    await client.end();
    console.log('[ok] 全部完成');
}

main().catch(err => {
    console.error('[fail]', err.message);
    process.exit(1);
});
