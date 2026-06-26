/**
 * fix_bv1xh68YvEij.js — 修复 BV1xh68YvEij 的混合互换问题
 * 该 BV 中约 32 首歌是反的（title=作曲家），66 首是正确的
 * 全量 swap 会破坏已正确的 → 需要精准修复
 */

const path = require('path');
const fs = require('fs');

(function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) return;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (key && value) process.env[key] = value;
    });
})();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

const HEADERS = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
};

const BVID = 'BV1xh68YvEij';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 检测: title 是英文/日文名（作曲家），singer 是曲名 → 存反了
// 对于这个纯音乐 BV，正确格式是: title=曲名, singer=作曲家
function isSwapped(song) {
    const title = song.title || '';
    const singer = song.singer || '';

    // 如果 title 是中文 → 这是曲名 → 正确，不交换
    // 但如果 singer 也是中文且 title 像人名（短中文）→ 可能存反
    if (/[一-鿿]/.test(title)) {
        // title 是中文: 可能是曲名（正确），也可能是作曲家中文名（存反）
        // 短中文(2-5字) + singer 是英文/曲名 → 可能是作曲家
        if (title.length <= 5 && /[a-zA-Z]/.test(singer)) {
            return true; // 短中文名 + 英文singer → 作曲家存反
        }
        if (title.length <= 5 && singer.length > title.length + 3) {
            return true; // 短中文名 + 长singer → 作曲家存反
        }
        return false; // 长中文title → 曲名，正确
    }

    // title 是英文/日文:
    // 英文短名(1-3词) → 可能是作曲家名 → 存反
    const words = title.split(/[\s\/&,]+/).filter(Boolean);
    if (words.length <= 3) {
        // 但像 "My Soul", "Natsu Koi" 这种可能是曲名也可能是作曲家
        // 对于这个 BV，短英文 title 大概率是作曲家名
        return true;
    }

    // title 是英文长名 → 曲名，正确
    return false;
}

async function main() {
    const mode = DRY_RUN ? '🔍 DRY RUN' : '🔧 实际修复';
    console.log(`🎵 精准修复 ${BVID} — ${mode}\n`);

    // 获取所有歌曲
    const url = `${SUPABASE_URL}/rest/v1/songs?select=id,page,title,singer&bvid=eq.${BVID}&order=id.asc&limit=200`;
    const resp = await fetch(url, { headers: HEADERS });
    const songs = await resp.json();
    console.log(`📊 共 ${songs.length} 首歌\n`);

    // 检测哪些存反
    const swaps = [];
    const correct = [];
    for (const s of songs) {
        if (isSwapped(s)) {
            swaps.push(s);
        } else {
            correct.push(s);
        }
    }

    console.log(`🔍 存反（需交换）: ${swaps.length} 首`);
    console.log(`✅ 已正确（不交换）: ${correct.length} 首\n`);

    // 预览
    console.log('需交换的歌曲:');
    console.log('='.repeat(80));
    for (const s of swaps.slice(0, 15)) {
        console.log(`  #${s.id} p${s.page}: "${s.title}" || "${s.singer}"  →  "${s.singer}" || "${s.title}"`);
    }
    if (swaps.length > 15) console.log(`  ... 还有 ${swaps.length - 15} 首`);

    // 显示不交换的（验证正确性）
    console.log(`\n不交换的歌曲（前10首）:`);
    console.log('='.repeat(80));
    for (const s of correct.slice(0, 10)) {
        console.log(`  #${s.id} p${s.page}: "${s.title}" || "${s.singer}"`);
    }
    if (correct.length > 10) console.log(`  ... 还有 ${correct.length - 10} 首`);

    if (DRY_RUN) {
        console.log('\n🔍 DRY RUN 完成。确认无误后运行:');
        console.log('  /d/softwa/nodejs/node scripts/fix_bv1xh68YvEij.js');
        return;
    }

    // 实际修复
    console.log(`\n🔧 开始交换 ${swaps.length} 首...`);
    let success = 0, failed = 0;
    for (let i = 0; i < swaps.length; i++) {
        const s = swaps[i];
        try {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/songs?id=eq.${s.id}`, {
                method: 'PATCH',
                headers: { ...HEADERS, 'Prefer': 'return=minimal' },
                body: JSON.stringify({ title: s.singer, singer: s.title }),
            });
            if (r.ok) success++;
            else { failed++; console.log(`  ✗ #${s.id}: ${(await r.text()).slice(0,80)}`); }
        } catch (err) { failed++; console.log(`  ✗ #${s.id}: ${err.message}`); }
        if ((i+1) % 20 === 0) console.log(`  进度: ${i+1}/${swaps.length}`);
        await sleep(30);
    }
    console.log(`\n========== 完成 ==========`);
    console.log(`成功: ${success} | 失败: ${failed}`);
}

main().catch(err => { console.error(err); process.exit(1); });
