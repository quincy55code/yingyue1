/**
 * undo_bv.js — 将指定 BV 的所有歌曲 title/singer 对调（撤销全量 swap）
 * 用法: /d/softwa/nodejs/node scripts/undo_bv.js BV1xh68YvEij [--dry-run]
 */
const path = require('path');
const fs = require('fs');
(function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
        const t = line.trim();
        if (!t || t.startsWith('#')) return;
        const i = t.indexOf('=');
        if (i === -1) return;
        process.env[t.slice(0,i).trim()] = t.slice(i+1).trim();
    });
})();

const SUPABASE_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const BVID = process.argv[2];
const DRY = process.argv.includes('--dry-run');

async function main() {
    if (!BVID) { console.log('Usage: node scripts/undo_bv.js <BVID> [--dry-run]'); return; }
    console.log(`${DRY ? '🔍 DRY RUN' : '🔧'} 撤销 ${BVID} 的全量 swap\n`);

    const url = `${SUPABASE_URL}/rest/v1/songs?select=id,page,title,singer&bvid=eq.${BVID}&order=id.asc&limit=300`;
    const songs = await (await fetch(url, {headers: H})).json();
    console.log(`${songs.length} 首歌\n`);

    if (DRY) {
        songs.slice(0,10).forEach(s => console.log(`  #${s.id}: "${s.title}"||"${s.singer}" → "${s.singer}"||"${s.title}"`));
        console.log(`  ... 还有 ${songs.length-10} 首\n🔍 DRY RUN 完成`);
        return;
    }

    let ok=0, fail=0;
    for (let i=0; i<songs.length; i++) {
        const s = songs[i];
        try {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/songs?id=eq.${s.id}`, {
                method: 'PATCH', headers: H,
                body: JSON.stringify({title: s.singer, singer: s.title}),
            });
            if (r.ok) ok++; else fail++;
        } catch(e) { fail++; }
        if ((i+1)%30===0) console.log(`  ${i+1}/${songs.length}`);
        await new Promise(r=>setTimeout(r,30));
    }
    console.log(`\n完成: 成功 ${ok}, 失败 ${fail}`);
}
main();
