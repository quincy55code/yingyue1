/**
 * fix_english_songs.js — 修复英文歌标题问题
 * ==========================================
 * 用法: /d/softwa/nodejs/node scripts/fix_english_songs.js [--dry-run]
 *
 * 处理:
 *   1. 去掉中文翻译包装，只保留英文原名
 *      "我心永恒（My Heart Will Go On）" → "My Heart Will Go On"
 *      "Nothing's Gonna Change...（此情不渝）" → "Nothing's Gonna Change..."
 *   2. 清理歌手名中的中文翻译
 *      "BWO（空壳乐队）" → "BWO"
 *   3. 检测英文歌名/歌手搞反
 *      "Boney M." | "巴比伦河(Rivers Of Babylon)" → "Rivers Of Babylon" | "Boney M."
 *   4. 从歌名末尾提取歌手
 *      "告别时刻(Time To Say Goodbye)莎拉布莱曼" | "" → "Time To Say Goodbye" | "莎拉布莱曼"
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== 修复逻辑 ==========

/**
 * 判断英文部分是否是实质性的歌名（而非版本标记）
 * 版本标记: "Live", "feat. X", "Remix", "Live版" 等
 * 真正歌名: 多单词或较长的英文短语
 */
function isSubstantialTitle(english) {
    if (!english || english.length < 3) return false;
    // 必须主要是英文字母（允许数字和少量符号）
    if (!/^[a-zA-Z0-9\s.,'!?&()\/\-]+$/.test(english)) return false;
    const words = english.trim().split(/\s+/);
    // 2个以上单词 → 大概率是歌名
    if (words.length >= 2) return true;
    // 1个单词但 ≥7 字符 → 可能是歌名 (如 "Casablanca", "Yellow", "Sailing")
    if (words.length === 1 && english.length >= 6) return true;
    return false;
}

/**
 * 从 "中文（English）" 或 "English（中文）" 中提取英文部分
 * 返回 { cleaned, englishOnly } 或 null（不匹配）
 */
function extractEnglishTitle(title) {
    if (!title) return null;

    // 模式1: 中文（English Original）— 中文在外面，英文在括号里
    // 例如: "我心永恒（My Heart Will Go On）", "加州旅馆（Hotel California）"
    const cnWrapFull = /^[\s一-鿿　-〿＀-￯，、。！？…《》㄀-ㄯㆠ-ㆿ]+[（(]\s*([a-zA-Z0-9][^）)]+?)\s*[）)]\s*$/;
    let m = title.match(cnWrapFull);
    if (m) {
        const english = m[1].replace(/[）)]+$/, '').trim();
        // 只提取实质性的英文歌名，忽略版本标记（Live, feat. 等）
        if (isSubstantialTitle(english)) {
            return { cleaned: english, type: 'cn-wrap-en' };
        }
    }

    // 模式2: English （中文翻译）— 英文在外面，中文在括号里
    // 例如: "Nothing's Going to Change My Love For You （此情不渝）"
    const enWrapFull = /^([a-zA-Z0-9][^(（]+?)\s*[（(]\s*[一-鿿][^)）]*\s*[）)]\s*$/;
    m = title.match(enWrapFull);
    if (m) {
        const english = m[1].trim();
        if (isSubstantialTitle(english)) {
            return { cleaned: english, type: 'en-wrap-cn' };
        }
    }

    return null;
}

/**
 * 清理歌手名: "BWO（空壳乐队）" → "BWO"
 */
function cleanSingerName(singer) {
    if (!singer) return null;

    // 英文名（中文注释）
    const enWithCn = /^([a-zA-Z0-9][^(（]+?)\s*[（(]\s*[一-鿿][^)）]{0,20}\s*[）)]\s*$/;
    let m = singer.match(enWithCn);
    if (m) {
        return { cleaned: m[1].trim(), type: 'singer-clean' };
    }

    return null;
}

/**
 * 检测英文歌搞反: title 是英文歌手名，singer 是含英文的中文歌名
 */
function detectEnglishSwap(title, singer) {
    if (!title || !singer) return false;

    // Title 主要是 ASCII（西方艺人名）
    const titleIsAscii = /^[a-zA-Z0-9\s.,&;:'"!?()\/\-]+$/.test(title.trim())
        && /[a-zA-Z]{4}/.test(title);

    if (!titleIsAscii) return false;

    // Singer 包含中文 + 英文（歌名翻译格式）
    const singerHasChinese = /[一-鿿]/.test(singer);
    const singerHasEnglish = /[a-zA-Z]{3}/.test(singer);

    if (!singerHasChinese || !singerHasEnglish) return false;

    // 提取 singer 中的英文（带括号或不带括号）
    // "巴比伦河(Rivers Of Babylon )" → "Rivers Of Babylon"
    // "你离去的原因（That's Why You Go Away）" → "That's Why You Go Away"
    let m = singer.match(/[（(]([a-zA-Z][^）)]+)[）)]/);
    if (m) return m[1].trim();

    // 没有括号，检查是否 singer 本身就是英文歌名
    // （这种不太可能是搞反的）
    return null;
}

/**
 * 从标题末尾提取歌手: "告别时刻(Time To Say Goodbye)莎拉布莱曼" → 歌手="莎拉布莱曼"
 */
function extractSingerFromTitleEnd(title) {
    if (!title) return null;

    // 标题以 ")中文名" 或 "）中文名" 结尾（括号后面还有文字）
    const m = title.match(/[）)][\s]*([一-鿿·]{2,10})\s*$/);
    if (m) {
        return m[1].trim();
    }
    return null;
}

/**
 * 分析一首歌需要什么修复
 */
function analyzeSong(song) {
    let title = (song.title || '').trim();
    let singer = (song.singer || '').trim();
    const changes = [];

    // --- Rule 1: 提取英文歌名（去中文翻译） ---
    const enResult = extractEnglishTitle(title);
    if (enResult) {
        changes.push(`标题去中文翻译: "${title}" → "${enResult.cleaned}"`);
        title = enResult.cleaned;
    }

    // --- Rule 2: 清理歌手名 ---
    const singerClean = cleanSingerName(singer);
    if (singerClean) {
        changes.push(`歌手去中文注释: "${singer}" → "${singerClean.cleaned}"`);
        singer = singerClean.cleaned;
    }

    // --- Rule 3: 检测英文歌搞反 ---
    if (!changes.some(c => c.includes('标题去中文翻译'))) {
        // 只在标题还没被处理过的情况下检测（避免重复处理）
        const swapEnglish = detectEnglishSwap(title, singer);
        if (swapEnglish) {
            changes.push(`英文歌搞反: "${title}" | "${singer}" → "${swapEnglish}" | "${title}"`);
            singer = title;
            title = swapEnglish;
        }
    }

    // --- Rule 4: 从标题末尾提取歌手（仅当歌手为空） ---
    if (!singer && title.includes(')')) {
        const extractedSinger = extractSingerFromTitleEnd(title);
        if (extractedSinger) {
            // 先去除末尾的歌手名
            const newTitle = title.replace(/[）)][\s]*[一-鿿·]{2,10}\s*$/, '').trim();
            // 再尝试从原标题中提取英文
            const enFromNew = extractEnglishTitle(newTitle);
            if (enFromNew) {
                title = enFromNew.cleaned;
            } else {
                title = newTitle;
            }
            singer = extractedSinger;
            changes.push(`从标题提取歌手: "${extractedSinger}"`);
        }
    }

    // --- Rule 5: 去除标题中残留的全角括号中文部分（仅当括号内是纯中文注释） ---
    // "海底（Live）" → 保留（Live是英文标记）
    // "卡农（经典钢琴版）" → 保留（括号内是版本说明，不是翻译）
    // 这些不做处理，因为它们不是翻译包装

    // --- 检查是否真的有变化 ---
    title = title.trim();
    singer = singer.trim();

    const origTitle = (song.title || '').trim();
    const origSinger = (song.singer || '').trim();

    if (title === origTitle && singer === origSinger) {
        return null;
    }

    return {
        id: song.id,
        oldTitle: origTitle,
        oldSinger: origSinger,
        newTitle: title,
        newSinger: singer,
        changes: changes.join('; '),
    };
}

// ========== 主流程 ==========

async function fetchAllSongs() {
    console.log('📊 获取所有歌曲...');
    let allSongs = [];
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/songs?select=id,title,singer&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
        const resp = await fetch(url, { headers: HEADERS });
        if (!resp.ok) break;
        const page = await resp.json();
        if (!page || page.length === 0) break;
        allSongs = allSongs.concat(page);
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }
    console.log(`  → 总计 ${allSongs.length} 首`);
    return allSongs;
}

async function main() {
    const mode = DRY_RUN ? '🔍 DRY RUN（仅预览，不实际修改）' : '🔧 实际修复模式';
    console.log(`🎵 英文歌数据修复 — ${mode}\n`);

    const songs = await fetchAllSongs();

    console.log('\n🔍 分析英文歌问题...');
    const fixes = [];
    for (const song of songs) {
        const fix = analyzeSong(song);
        if (fix) fixes.push(fix);
    }

    console.log(`  → 发现 ${fixes.length} 首需要修复\n`);

    if (fixes.length === 0) {
        console.log('✅ 没有需要修复的歌曲！');
        return;
    }

    // 按类型统计
    const byType = {};
    for (const f of fixes) {
        let key = '其他';
        if (f.changes.includes('标题去中文翻译')) key = '标题去中文翻译';
        else if (f.changes.includes('英文歌搞反')) key = '英文歌搞反';
        else if (f.changes.includes('歌手去中文注释')) key = '歌手去中文注释';
        else if (f.changes.includes('从标题提取歌手')) key = '从标题提取歌手';
        byType[key] = (byType[key] || 0) + 1;
    }
    console.log('修复类型分布:');
    for (const [k, v] of Object.entries(byType)) {
        console.log(`  ${k}: ${v} 首`);
    }

    // 预览全部
    console.log(`\n📝 ${DRY_RUN ? '预览:' : '将要修复:'}`);
    console.log('='.repeat(100));
    for (const f of fixes) {
        console.log(`#${f.id} | ${f.oldTitle || '(空)'} | ${f.oldSinger || '(空)'}`);
        console.log(`  →  | ${f.newTitle} | ${f.newSinger}`);
        console.log(`  ${f.changes}`);
    }

    if (DRY_RUN) {
        console.log('\n🔍 DRY RUN 完成。确认无误后用以下命令实际执行:');
        console.log('  /d/softwa/nodejs/node scripts/fix_english_songs.js');
        return;
    }

    // 实际修复
    console.log(`\n🔧 开始修复 ${fixes.length} 首歌曲...`);
    let success = 0, failed = 0;

    for (let i = 0; i < fixes.length; i++) {
        const f = fixes[i];
        try {
            const resp = await fetch(
                `${SUPABASE_URL}/rest/v1/songs?id=eq.${f.id}`,
                {
                    method: 'PATCH',
                    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
                    body: JSON.stringify({ title: f.newTitle, singer: f.newSinger }),
                }
            );
            if (resp.ok) success++;
            else {
                failed++;
                console.log(`  ✗ #${f.id}: ${await resp.text().then(t => t.slice(0, 80))}`);
            }
        } catch (err) {
            failed++;
            console.log(`  ✗ #${f.id}: ${err.message}`);
        }

        if ((i + 1) % 50 === 0) {
            console.log(`  进度: ${i + 1}/${fixes.length} (成功 ${success}, 失败 ${failed})`);
        }
        await sleep(80);
    }

    console.log(`\n========== 完成 ==========`);
    console.log(`成功: ${success} 首`);
    console.log(`失败: ${failed} 首`);
    console.log(`总计: ${fixes.length} 首`);
}

main().catch(err => {
    console.error('脚本执行失败:', err);
    process.exit(1);
});
