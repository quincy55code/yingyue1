/**
 * fix_song_data.js — 批量修复歌曲的标题、歌手数据问题
 * ====================================================
 * 用法: /d/softwa/nodejs/node scripts/fix_song_data.js [--dry-run]
 *
 * 问题类型:
 *   1. 歌手名带序号前缀: "001. 周杰伦" → "周杰伦"
 *   2. 歌名带序号前缀: "01.我心永恒" → "我心永恒"
 *   3. 歌名/歌手搞反（序号在歌手上但歌名是歌手名）: "罗大佑" | "100.东方之珠" → "东方之珠" | "罗大佑"
 *   4. 歌手名为空但歌名包含歌手信息: "01.我心永恒-席琳·迪翁" | "" → "我心永恒" | "席琳·迪翁"
 */

const path = require('path');
const fs = require('fs');

// ========== 加载 .env ==========
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

// ========== 常见中文姓氏（用于检测歌名/歌手搞反） ==========
const SURNAMES = new Set([
    '李','王','张','刘','陈','杨','赵','黄','周','吴','徐','孙','马','胡','朱',
    '郭','何','罗','高','林','郑','梁','谢','唐','许','冯','宋','韩','邓','彭',
    '曹','曾','田','董','潘','袁','于','蒋','蔡','余','杜','叶','程','苏','魏',
    '吕','丁','任','沈','姚','卢','姜','崔','钟','谭','陆','汪','范','金','石',
    '廖','贾','夏','韦','付','方','白','邹','孟','熊','秦','邱','江','尹','薛',
    '闫','雷','侯','龙','段','郝','孔','邵','史','毛','常','万','顾','赖','武',
    '康','贺','严','覃','温','莫','章','关','阮','岳','齐','肖','戴','梅','文',
    '易','乔','钱','汤','殷','代','盛','庄','童','祝','翁','管','洪','鲁','柳',
    '蓝','包','尤','樊','颜','庞','舒','纪','欧','刁','凌','季','涂','甘','苗',
    '裴','柯','施','陶','屈','聂','池','詹','邬','连','向','成','阮',
]);

// ========== 工具函数 ==========

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 判断字符串是否看起来像中文人名（2-3字纯中文，首字是常见姓氏） */
function looksLikeChineseName(str) {
    if (!str || typeof str !== 'string') return false;
    const trimmed = str.trim();
    // 2-3 个纯中文字符
    if (!/^[一-鿿]{2,3}$/.test(trimmed)) return false;
    // 首字是常见姓氏
    return SURNAMES.has(trimmed[0]);
}

/** 去除数字前缀: "001.", "01.", "1." 等，也处理不带点的 "001 " */
function stripNumberPrefix(str) {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/^\d{1,4}\.\s*/, '').trim();
}

/** 检测字符串是否有数字前缀 */
function hasNumberPrefix(str) {
    if (!str || typeof str !== 'string') return false;
    return /^\d{1,4}\.\s*/.test(str);
}

/** 从歌名中提取歌名和歌手（格式: "NN.歌名-歌手" 或 "歌名-歌手"） */
function parseTitleWithSinger(raw) {
    let part = raw.trim();

    // 去除数字前缀
    const numPrefixRe = /^\d{1,4}\.\s*/;
    part = part.replace(numPrefixRe, '');

    // 去除尾部无意义标点
    part = part.replace(/[。．.，,、\s]+$/, '');

    // 尝试用 " - " 分割（带空格）
    let idx = part.indexOf(' - ');
    if (idx > 0) {
        return { title: part.slice(idx + 3).trim(), singer: part.slice(0, idx).trim() };
    }

    // 注意: 以下模式容易误判，仅当 singer 原本为空时才使用
    // 尝试用 "-" 分割（最后一个 "-"）
    idx = part.lastIndexOf('-');
    if (idx > 0) {
        const left = part.slice(0, idx).trim();
        const right = part.slice(idx + 1).trim();
        if (right.length >= 1 && left.length >= 1
            && !/^\d+$/.test(right) && !/^\d+$/.test(left)) {
            return { title: left, singer: right };
        }
    }

    // 尝试用 "—" 或 "–" 分割
    for (const sep of ['—', '–', '：', ':']) {
        idx = part.lastIndexOf(sep);
        if (idx > 0) {
            return {
                title: part.slice(0, idx).trim(),
                singer: part.slice(idx + sep.length).trim(),
            };
        }
    }

    return { title: part, singer: null };
}

// ========== 数据获取 ==========

async function fetchAllSongs() {
    console.log('📊 获取所有歌曲...');
    let allSongs = [];
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/songs?select=id,bvid,title,singer&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
        const resp = await fetch(url, { headers: HEADERS });
        if (!resp.ok) {
            console.log(`  ✗ 查询失败: ${resp.status}`);
            break;
        }
        const page = await resp.json();
        if (!page || page.length === 0) break;
        allSongs = allSongs.concat(page);
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }
    console.log(`  → 总计 ${allSongs.length} 首`);
    return allSongs;
}

// ========== 修复逻辑 ==========

/**
 * 分析一首歌需要什么修复
 * 返回 { id, title, singer, newTitle, newSinger, reason } 或 null（无需修复）
 */
function analyzeSong(song) {
    let newTitle = song.title || '';
    let newSinger = song.singer || '';
    const reasons = [];

    // --- Rule 1: 如果歌名含数字前缀，去除 ---
    if (hasNumberPrefix(newTitle)) {
        const stripped = stripNumberPrefix(newTitle);
        reasons.push(`标题去序号: "${newTitle}" → "${stripped}"`);
        newTitle = stripped;
    }

    // --- Rule 2: 如果歌手名为空，尝试从歌名中提取 ---
    if (!newSinger && newTitle.includes('-')) {
        const parsed = parseTitleWithSinger(song.title); // 用原始 title 解析
        if (parsed.singer) {
            reasons.push(`从标题提取歌手: "${parsed.singer}"`);
            newTitle = parsed.title;
            newSinger = parsed.singer;
        }
    }

    // --- Rule 3: 检测歌名/歌手搞反 ---
    // 条件: 歌手有数字前缀 AND 歌名像中文人名 AND (歌名没有数字前缀)
    if (hasNumberPrefix(newSinger) && looksLikeChineseName(newTitle) && !hasNumberPrefix(newTitle)) {
        // 还要确认：去除歌手前缀后，歌手的文本是合理的歌名（不是另一个歌手名）
        const singerStripped = stripNumberPrefix(newSinger);
        // 如果去除前缀后的歌手名也不像人名（歌名通常更长或包含非姓氏字），确认是搞反了
        if (singerStripped.length >= 2 && !looksLikeChineseName(singerStripped)) {
            reasons.push(`歌名/歌手搞反: "${newTitle}" ↔ "${newSinger}" → "${singerStripped}" | "${newTitle}"`);
            newSinger = newTitle;
            newTitle = singerStripped;
        }
    }

    // --- Rule 4: 歌手名有数字前缀（未被 Rule 3 处理的） ---
    if (hasNumberPrefix(newSinger)) {
        const stripped = stripNumberPrefix(newSinger);
        if (stripped !== newSinger && !reasons.some(r => r.includes('搞反'))) {
            reasons.push(`歌手去序号: "${newSinger}" → "${stripped}"`);
            newSinger = stripped;
        }
    }

    // --- 检查是否真的有变化 ---
    newTitle = newTitle.trim();
    newSinger = newSinger.trim();

    if (newTitle === (song.title || '').trim() && newSinger === (song.singer || '').trim()) {
        return null; // 无需修复
    }

    return {
        id: song.id,
        bvid: song.bvid,
        oldTitle: song.title,
        oldSinger: song.singer,
        newTitle,
        newSinger,
        reason: reasons.join('; '),
    };
}

// ========== 主流程 ==========

async function main() {
    const mode = DRY_RUN ? '🔍 DRY RUN（仅预览，不实际修改）' : '🔧 实际修复模式';
    console.log(`🎵 歌曲数据修复脚本 — ${mode}\n`);

    const songs = await fetchAllSongs();

    // 分析所有歌曲
    console.log('\n🔍 分析数据问题...');
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

    // 按问题类型统计
    const byReason = {};
    for (const f of fixes) {
        const key = f.reason.includes('搞反') ? '歌名/歌手搞反 (swap)'
            : f.reason.includes('提取歌手') ? '从标题提取歌手'
            : f.reason.includes('歌手去序号') ? '歌手去序号'
            : f.reason.includes('标题去序号') ? '标题去序号'
            : '其他';
        byReason[key] = (byReason[key] || 0) + 1;
    }
    console.log('修复类型分布:');
    for (const [k, v] of Object.entries(byReason)) {
        console.log(`  ${k}: ${v} 首`);
    }

    // 预览前 40 条
    console.log(`\n📝 ${DRY_RUN ? '预览（前40条）:' : '将要修复（前40条）:'}`);
    console.log('='.repeat(100));
    for (const f of fixes.slice(0, 40)) {
        console.log(`#${f.id} | ${f.oldTitle || '(空)'} | ${f.oldSinger || '(空)'}`);
        console.log(`  →  | ${f.newTitle} | ${f.newSinger}`);
        console.log(`  原因: ${f.reason}`);
    }
    if (fixes.length > 40) {
        console.log(`  ... 还有 ${fixes.length - 40} 条`);
    }

    if (DRY_RUN) {
        console.log('\n🔍 DRY RUN 完成。确认无误后用以下命令实际执行:');
        console.log('  /d/softwa/nodejs/node scripts/fix_song_data.js');
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
            if (resp.ok) {
                success++;
            } else {
                failed++;
                const errText = await resp.text();
                console.log(`  ✗ #${f.id}: ${errText.slice(0, 80)}`);
            }
        } catch (err) {
            failed++;
            console.log(`  ✗ #${f.id}: ${err.message}`);
        }

        if ((i + 1) % 200 === 0) {
            console.log(`  进度: ${i + 1}/${fixes.length} (成功 ${success}, 失败 ${failed})`);
        }

        // 轻量限速
        if (i < fixes.length - 1) {
            await sleep(50);
        }
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
