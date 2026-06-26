/**
 * fix_foreign_swaps.js — 修复英文/纯音乐/日文歌曲 title/singer 互换（第二轮）
 * ==============================================================================
 * 用法:
 *   /d/softwa/nodejs/node scripts/fix_foreign_swaps.js --dry-run   (预览)
 *   /d/softwa/nodejs/node scripts/fix_foreign_swaps.js             (执行修复)
 *
 * 这是 fix_swapped_songs.js 的补充 — 只处理上一轮没覆盖的英文/日文/纯音乐 BV。
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

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[init] 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const HEADERS = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const NUM_PREFIX_RE = /^\d{1,4}[\.\-\s、\)）]\s*/;
function stripNumberPrefix(str) { return str ? str.replace(NUM_PREFIX_RE, '').trim() : str; }

// ===================================================================
// 新增 BV 列表（不在第一轮修复范围内）
// ===================================================================

// 完全互换 — 该 BV 下所有歌曲都要交换
const FULLY_SWAPPED_BVIDS = [
    'BV15hV36ZENH',  // 40首欧美顶流 (欧美音乐)
    'BV1RFAkzPEij',  // 40首上头欧美歌 (欧美音乐)
    'BV1PSNPe9EJg',  // 超好听英文歌 (欧美音乐)
    'BV1j4EM6aELa',  // 100首经典英文歌 (欧美音乐)
    'BV1ueL96CEXN',  // B站欧美神曲100期 (欧美音乐/热歌榜单)
    'BV1FEQuBXEn1',  // 100首超好听纯音乐 (纯音乐)
    'BV1xh68YvEij',  // 100首绝美纯音乐 (纯音乐)
    'BV1P7Vo6NETX',  // 全 BV title=歌手名, singer=歌名
    'BV1f1421q74i',  // 全 BV title=歌手名, singer=歌名
];

// 部分互换 — 需要智能检测
const PARTIALLY_SWAPPED_CONFIG = {
    'BV1GxVU6oEWW': {  // 2026年5月最火50首
        // title 含英文或日文假名 → 说明歌手名存到 title 了
        detectBy: 'titleHasForeign',
        description: '2026年5月最火50首',
    },
    'BV1sM4y1z7G8': {  // 50首经典英文歌
        // title 是中文（如"马修·连恩"译名）而 singer 含英文 → 存反
        detectBy: 'chineseTitleEnglishSinger',
        description: '50首经典英文歌',
    },
    'BV1gT5Y6mEXM': {  // 150首怀旧金曲
        // title 是短中文人名（2-6字）且 singer 更长 → 存反
        detectBy: 'shortChineseTitle',
        description: '150首怀旧金曲',
    },
    'BV1Mcjr6rEv1': {  // 其他合集
        detectBy: 'shortChineseTitle',
        description: '其他合集',
    },
};

// ===================================================================
// 主流程
// ===================================================================

async function fetchSongsByBvid(bvid) {
    const url = `${SUPABASE_URL}/rest/v1/songs?select=id,bvid,page,title,singer&bvid=eq.${bvid}&order=id.asc&limit=300`;
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) { console.error(`  ✗ 查询 ${bvid} 失败: ${resp.status}`); return []; }
    return await resp.json();
}

function detectFixes(songs) {
    const fixes = [];

    for (const song of songs) {
        const singer = song.singer || '';
        const title = song.title || '';

        if (FULLY_SWAPPED_BVIDS.includes(song.bvid)) {
            // 全部交换
            const newTitle = stripNumberPrefix(singer);
            const newSinger = title;
            if (newTitle !== title || newSinger !== singer) {
                fixes.push({ id: song.id, bvid: song.bvid, page: song.page,
                    oldTitle: title, oldSinger: singer, newTitle, newSinger, reason: 'swap' });
            }
            continue;
        }

        const config = PARTIALLY_SWAPPED_CONFIG[song.bvid];
        if (!config) continue;

        let isSwapped = false;
        if (config.detectBy === 'titleHasForeign') {
            isSwapped = /[a-zA-Zぁ-ゟ゠-ヿ]/.test(title);
        } else if (config.detectBy === 'chineseTitleEnglishSinger') {
            isSwapped = /[一-鿿]/.test(title) && /[a-zA-Z]{3,}/.test(singer);
        } else if (config.detectBy === 'shortChineseTitle') {
            isSwapped = /^[一-鿿·]{2,6}$/.test(title) && singer.length > title.length + 2;
        }

        if (isSwapped) {
            const newTitle = stripNumberPrefix(singer);
            const newSinger = title;
            fixes.push({ id: song.id, bvid: song.bvid, page: song.page,
                oldTitle: title, oldSinger: singer, newTitle, newSinger, reason: 'swap-partial' });
        }
    }

    return fixes;
}

async function main() {
    const mode = DRY_RUN ? '🔍 DRY RUN（仅预览）' : '🔧 实际修复模式';
    console.log(`🎵 英文/日文/纯音乐 swap 修复 — ${mode}\n`);

    const allBvids = [...FULLY_SWAPPED_BVIDS, ...Object.keys(PARTIALLY_SWAPPED_CONFIG)];
    console.log(`📊 涉及 ${allBvids.length} 个 BV\n`);

    // Fetch all affected songs
    const allSongs = [];
    const bvidStats = {};
    for (const bvid of allBvids) {
        const songs = await fetchSongsByBvid(bvid);
        allSongs.push(...songs);
        bvidStats[bvid] = songs.length;
        console.log(`  ${bvid}: ${songs.length} 首`);
        await sleep(100);
    }
    console.log(`\n  → 总计 ${allSongs.length} 首候选歌曲\n`);

    // Detect fixes
    const fixes = detectFixes(allSongs);
    const swapped = fixes.filter(f => f.reason.includes('swap'));
    console.log(`🔍 需交换: ${swapped.length} 首\n`);

    // Group by bvid
    const byBvid = {};
    for (const f of swapped) {
        byBvid[f.bvid] = (byBvid[f.bvid] || 0) + 1;
    }
    for (const [bvid, count] of Object.entries(byBvid)) {
        console.log(`  ${bvid}: ${count} 首`);
    }

    // Preview
    console.log(`\n📝 ${DRY_RUN ? '预览（前30条）:' : '将修复（前30条）:'}`);
    console.log('='.repeat(90));
    for (const f of swapped.slice(0, 30)) {
        console.log(`#${f.id} (${f.bvid} p${f.page}):`);
        console.log(`  "${f.oldTitle}" || "${f.oldSinger}"  →  "${f.newTitle}" || "${f.newSinger}"`);
    }
    if (swapped.length > 30) console.log(`  ... 还有 ${swapped.length - 30} 条`);

    if (DRY_RUN) {
        console.log('\n🔍 DRY RUN 完成。确认无误后运行:');
        console.log('  /d/softwa/nodejs/node scripts/fix_foreign_swaps.js');
        return;
    }

    // Execute fixes
    console.log(`\n🔧 开始修复 ${swapped.length} 首...`);
    let success = 0, failed = 0;

    for (let i = 0; i < swapped.length; i++) {
        const f = swapped[i];
        try {
            const resp = await fetch(`${SUPABASE_URL}/rest/v1/songs?id=eq.${f.id}`, {
                method: 'PATCH',
                headers: { ...HEADERS, 'Prefer': 'return=minimal' },
                body: JSON.stringify({ title: f.newTitle, singer: f.newSinger }),
            });
            if (resp.ok) success++;
            else { failed++; console.log(`  ✗ #${f.id}: ${(await resp.text()).slice(0,80)}`); }
        } catch (err) {
            failed++;
            console.log(`  ✗ #${f.id}: ${err.message}`);
        }

        if ((i + 1) % 50 === 0) {
            console.log(`  进度: ${i+1}/${swapped.length} (成功 ${success}, 失败 ${failed})`);
        }
        await sleep(30);
    }

    console.log(`\n========== 完成 ==========`);
    console.log(`成功: ${success} | 失败: ${failed} | 总计: ${swapped.length}`);

    // Verify: spot-check each BV
    console.log('\n📝 修复后验证:');
    for (const bvid of allBvids) {
        const url = `${SUPABASE_URL}/rest/v1/songs?select=id,title,singer,page&bvid=eq.${bvid}&order=page.asc&limit=3`;
        const vResp = await fetch(url, { headers: HEADERS });
        const vData = await vResp.json();
        console.log(`\n  ${bvid}:`);
        for (const s of vData) {
            console.log(`    #${s.id} p${s.page}: "${s.title}" || "${s.singer || '(无)'}"`);
        }
    }
}

main().catch(err => { console.error(err); process.exit(1); });
