/**
 * 执行 collections DDL 并插入种子数据
 * 用法：/d/softwa/nodejs/node scripts/setup_collections.js <DB_PASSWORD>
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// 优先从命令行参数，其次从临时文件
let password = process.argv[2];
if (!password) {
    const passFile = path.join(__dirname, '..', '.superpowers', 'db_pass.txt');
    if (fs.existsSync(passFile)) {
        password = fs.readFileSync(passFile, 'utf8').trim();
    }
}
if (!password) {
    console.error('Usage: node scripts/setup_collections.js <DB_PASSWORD>');
    process.exit(1);
}

const client = new Client({
    host: 'db.orphftlwdwuvoscizndx.supabase.co',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: password,
    ssl: { rejectUnauthorized: false },
});

function executeSQL(sql) {
    // 按分号拆分，过滤注释和空语句
    const statements = sql
        .split(';')
        .map(s => s.trim())
        .map(s => s.replace(/^--[^\n]*\n/gm, '').trim())  // 先去掉行首注释
        .filter(s => s && s.length > 5);
    return statements;
}

async function run() {
    await client.connect();
    console.log('[setup_collections] Connected to Supabase PostgreSQL\n');

    // 1. 执行 DDL
    const ddlPath = path.join(__dirname, '..', 'sql', 'collections.sql');
    const ddl = fs.readFileSync(ddlPath, 'utf8');
    const ddlStatements = executeSQL(ddl);

    console.log('--- Executing DDL (collections.sql) ---');
    for (const stmt of ddlStatements) {
        try {
            await client.query(stmt);
            console.log('  OK:', stmt.substring(0, 80).replace(/\n/g, ' ') + '...');
        } catch (err) {
            if (err.message.includes('already exists') || err.code === '42P07') {
                console.log('  SKIP (exists):', stmt.substring(0, 60).replace(/\n/g, ' ') + '...');
            } else {
                console.error('  FAIL:', err.message);
                throw err;
            }
        }
    }

    // 2. 检查是否已有种子数据
    const { rows: countRows } = await client.query('SELECT COUNT(*) FROM collections');
    const existingCount = parseInt(countRows[0].count);
    if (existingCount > 0) {
        console.log(`\n[setup_collections] collections 表已有 ${existingCount} 行，跳过种子数据`);
        console.log('  如需重新插入，请先 DELETE FROM collection_items; DELETE FROM collections;');
    } else {
        // 3. 执行种子数据
        const seedPath = path.join(__dirname, '..', 'sql', 'seed_collections.sql');
        const seed = fs.readFileSync(seedPath, 'utf8');
        const seedStatements = executeSQL(seed);

        console.log('\n--- Executing Seed Data (seed_collections.sql) ---');
        for (const stmt of seedStatements) {
            try {
                await client.query(stmt);
                const preview = stmt.substring(0, 60).replace(/\n/g, ' ').trim();
                console.log('  OK:', preview + '...');
            } catch (err) {
                console.error('  FAIL:', err.message);
                throw err;
            }
        }

        // 验证
        const { rows: verify } = await client.query('SELECT name, slug FROM collections ORDER BY sort_order');
        console.log('\n--- Collections Created ---');
        verify.forEach(r => console.log(`  ${r.name} (${r.slug})`));

        const { rows: itemCount } = await client.query('SELECT COUNT(*) FROM collection_items');
        console.log(`\nTotal collection_items: ${itemCount[0].count}`);
    }

    await client.end();
    console.log('\n[setup_collections] Done!');
}

run().catch(err => {
    console.error('[setup_collections] Fatal error:', err.message);
    client.end().catch(() => {});
    process.exit(1);
});
