/**
 * fix_swapped_songs.js — 修复歌名/歌手互换 + 数字前缀清理 (v3)
 * ============================================================
 * 用法:
 *   /d/softwa/nodejs/node scripts/fix_swapped_songs.js --dry-run   (预览)
 *   /d/softwa/nodejs/node scripts/fix_swapped_songs.js             (执行修复)
 *   /d/softwa/nodejs/node scripts/fix_swapped_songs.js --verify    (仅验证)
 *
 * v3 改进: 不再盲目交换整个 BV 的所有歌曲。改为逐首智能检测:
 *   1. 从已知正确的歌曲中构建"歌手姓名集合"
 *   2. 对每首歌判断 title/singer 是否互换（多信号综合判断）
 *   3. 对 歌手专区 BV 使用已知主歌手名称辅助判断
 *
 * 受影响合集（18个 BV）:
 *   歌手专区: 周深、周杰伦、许嵩、西城男孩、霉霉
 *   热歌榜单: 2024热评榜首、2026上半年最火
 *   KTV必点: 00后、8090后、百首华语代表作
 *   华语流行: 111首华语经典、百首华语代表作、150首华语热歌
 *   欧美音乐: 西城男孩精选、霉霉精选
 *   粤语经典: 百首粤语经典
 *   古风国风: 100首超好听古风
 *   经典怀旧: 滚石经典、100首经典老歌
 *   网络神曲: 网吧通宵130首、90后150首
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
const VERIFY_ONLY = process.argv.includes('--verify');

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

// 数字前缀正则: "0001.", "01.", "1.", "1、" 等 + 可选空格
const NUM_PREFIX_RE = /^\d{1,4}[\.\-\s、\)）]\s*/;

function hasNumberPrefix(str) {
    return str && NUM_PREFIX_RE.test(str);
}

function stripNumberPrefix(str) {
    return str ? str.replace(NUM_PREFIX_RE, '').trim() : str;
}

// ===================================================================
// 受影响 BV 列表
// ===================================================================

// 所有需要检查的 BV（18个）
const AFFECTED_BVIDS = [
    'BV1Wg4heQEQU',  // 周深神仙嗓音
    'BV1e9Lo64EJx',  // 周杰伦100首合集
    'BV1KXjF6REto',  // 许嵩歌曲合集
    'BV1BALF6NENq',  // 西城男孩精选20首
    'BV1ChR7B4ECE',  // 霉霉精选40首
    'BV1vg4y1U7Xf',  // 2024热评榜首100首
    'BV17vLz62EHG',  // 2026上半年最火100首
    'BV1Ei421i7mm',  // 8090后KTV必点200首
    'BV1cUjW61EFN',  // 100首超好听古风
    'BV1Y2w4zXEJ9',  // 网吧通宵130首神曲
    'BV1GSEj6UEaN',  // 90后150首网络神曲
    'BV1tyKceWETg',  // 百首粤语经典
    'BV1qpsPznEWJ',  // 百首华语代表作
    'BV1fDqiYNEuf',  // 111首华语经典
    'BV1NURNBtETP',  // 150首华语热歌
    'BV1QC4y1P7YG',  // 滚石经典歌曲合集
    'BV1RnEL6UEkY',  // 100首经典老歌
    'BV1SrbkzxEVi',  // 00后KTV必点
];

const AFFECTED_SET = new Set(AFFECTED_BVIDS);

// BVID → 合集名称 映射
const BVID_NAMES = {
    'BV1Wg4heQEQU': '周深神仙嗓音',
    'BV1e9Lo64EJx': '周杰伦100首合集',
    'BV1KXjF6REto': '许嵩歌曲合集',
    'BV1BALF6NENq': '西城男孩精选20首',
    'BV1ChR7B4ECE': '霉霉精选40首',
    'BV1vg4y1U7Xf': '2024热评榜首100首',
    'BV17vLz62EHG': '2026上半年最火100首',
    'BV1Ei421i7mm': '8090后KTV必点200首',
    'BV1cUjW61EFN': '100首超好听古风',
    'BV1Y2w4zXEJ9': '网吧通宵130首神曲',
    'BV1GSEj6UEaN': '90后150首网络神曲',
    'BV1tyKceWETg': '百首粤语经典',
    'BV1qpsPznEWJ': '百首华语代表作',
    'BV1fDqiYNEuf': '111首华语经典',
    'BV1NURNBtETP': '150首华语热歌',
    'BV1QC4y1P7YG': '滚石经典歌曲合集',
    'BV1RnEL6UEkY': '100首经典老歌',
    'BV1SrbkzxEVi': '00后KTV必点',
};

// 歌手专区 BV → 已知主歌手名称（用于检测 title 是否含歌手名）
const KNOWN_MAIN_SINGERS = {
    'BV1Wg4heQEQU': ['周深'],
    'BV1e9Lo64EJx': ['周杰伦'],
    'BV1KXjF6REto': ['许嵩'],
    'BV1BALF6NENq': ['Westlife', '西城男孩', 'West Life'],
    'BV1ChR7B4ECE': ['Taylor Swift', 'Taylor', 'Swift'],
};

// ===================================================================
// 核心: 智能检测一首歌是否 title/singer 互换
// ===================================================================

// 硬编码的歌手/组合名单（外部知识，不依赖数据库）
// 用于检测 title/singer 是否互换——如果 title 匹配此名单，大概率是歌手名
const SUPPLEMENTARY_SINGERS = [
    // 男歌手
    '光良', '品冠', '伍佰', '赵雷', '许巍', '朴树', '汪峰', '刀郎', '韩磊',
    '孙楠', '杨坤', '腾格尔', '阿杜', '郑源', '欢子', '冷漠', '海伦',
    '李健', '许嵩', '汪苏泷', '徐良', '后弦', '小贱', '星弟',
    '张宇', '张杰', '薛之谦', '李荣浩', '方大同', '陶喆', '胡彦斌',
    '周深', '毛不易', '华晨宇', '吴青峰', '赵英俊', '大张伟',
    '王力宏', '周杰伦', '林俊杰', '陈奕迅', '张敬轩', '李克勤',
    '古巨基', '郑中基', '苏永康', '许志安', '谢霆锋',
    '刘德华', '张学友', '郭富城', '黎明', '张国荣', '谭咏麟',
    '林子祥', '陈百强', '钟镇涛', '王杰', '齐秦', '童安格',
    '周华健', '张信哲', '邰正宵', '任贤齐', '黄品源', '张震岳',
    '罗大佑', '李宗盛', '周传雄', '游鸿明', '熊天平',
    '萧煌奇', '杨宗纬', '萧敬腾', '林宥嘉', '韦礼安', '严爵',
    '柯有伦', 'Tank', '曹格', '吴克群', '胡夏', '李玖哲',
    '永邦', '欧得洋', '盛哲', '郭顶', '周兴哲', '阿冗',
    '队长', '黄欣彬', '海明威', '吕方', '棉子', '周蕙',
    '林依轮', '倪浩毅', '张德伊玲', '央金拉姆', '一颗狼星',
    '阿图表妹', '高鱼', '张栋梁', '王强', '李圣杰',
    '光良', '张震岳', '黄欣彬', '海明威',
    // 女歌手
    '孙燕姿', '蔡依林', '萧亚轩', '王心凌', '杨丞琳', '张韶涵',
    '梁静茹', '戴佩妮', '刘若英', '范玮琪', '郭静', '徐佳莹',
    '田馥甄', 'A-Lin', '邓紫棋', '张靓颖', '周笔畅', '李宇春',
    '郁可唯', '张碧晨', '袁娅维', '谭维维', '吉克隽逸', '尚雯婕',
    '莫文蔚', '王菲', '那英', '韩红', '辛晓琪', '孟庭苇',
    '陈淑桦', '蔡健雅', '彭佳慧', '顺子', '许茹芸',
    '许美静', '郑秀文', '陈慧琳', '容祖儿', '杨千嬅',
    '谢安琪', '卫兰', '吴雨霏', '薛凯琪', '官恩娜',
    '庄心妍', '戚薇', '阿桑', '黄小琥', '曲婉婷',
    '陈粒', '程响', '任然', '大籽', '刘瑞琦', '梦然',
    '高鱼', '阿YueYue', '叶斯淳', '一只白羊', '小蓝背心',
    '戴羽彤', '王靖雯', '尹昔眠', '黄霄雲', '深海鱼子酱',
    '秋原依', '唐千云', '陆虎', '蒋雪儿', '买辣椒也用券',
    '平生不晚', 'HITA', 'KBShinya', '唐伯虎Annie', '张惠',
    // 组合/乐团
    '五月天', '苏打绿', '飞儿乐团', 'S.H.E', 'BY2', 'Twins',
    '动力火车', '草蜢', 'Beyond', 'BEYOND', 'F4', '5566', '183club',
    '飞轮海', '棒棒堂', '南拳妈妈', 'T.R.Y', 'T_R_Y',
    '筷子兄弟', '凤凰传奇', '牛奶咖啡', '房东的猫',
    'F.I.R.', 'F.I.R.飞儿乐团', '八三夭乐团',
    '信乐团', '黑豹乐队', '唐朝乐队', '零点乐队',
    'TFBOYS', 'SNH48',
    // 其他
    '群星', '佚名',
];

/**
 * 构建"已知歌手姓名集合"。
 * 只使用硬编码名单，不依赖数据库（避免被未识别的互换 BV 污染）。
 */
function buildKnownSingersSet(allSongs) {
    return new Set(SUPPLEMENTARY_SINGERS);
}

/**
 * 判断字符串是否像一个歌手姓名（而非歌名）
 * 特征: 2-12 字符, 由中文/英文/数字/常见分隔符组成, 不含歌名标点
 */
function looksLikeSingerName(str) {
    if (!str) return false;
    // 排除纯数字前缀（B站分P序号）
    if (/^\d{1,4}[\.\-\s、\)）]/.test(str)) return false;
    // 允许: 中文、英文字母、数字、&、· (U+00B7)、. (英文缩写如 S.H.E)、空格
    // 排除: 歌名常见的标点符号
    return /^[一-龥a-zA-Z0-9·&\.\s]{2,12}$/.test(str) &&
           !/[，。！？、（）《》「」『』【】\-–—]/.test(str) &&
           !/^\d+$/.test(str);  // 纯数字不是人名
}

/**
 * 判断是否像英文缩写组合名（如 S.H.E, T.R.Y, T_R_Y）
 * 特征: 单个字母由 . 或 _ 分隔
 */
function looksLikeAbbreviatedGroupName(str) {
    if (!str) return false;
    return /^[A-Z][\._][A-Z]([\._][A-Z])*$/i.test(str) ||
           /^[A-Z][\._][A-Z][\._][A-Z]$/i.test(str);
}

/**
 * 判断字符串是否像一个歌名（而非歌手名）
 * 特征: 较长的文本, 或包含歌名特征字符
 */
function looksLikeSongTitle(str) {
    if (!str) return false;
    // 较长（>10 字符通常不是单纯歌手名）
    // 包含歌名特征: 中文标点、英文小写单词(≥3字母)、括号
    return str.length > 10 ||
           /[，。！？、（）《》「」『』【】]/.test(str) ||
           /[a-z]{3,}/.test(str);  // 含英文小写单词(歌名特征)
}

/**
 * 核心检测函数: 判断一首歌是否 title/singer 互换了
 * @returns {{ isSwapped: boolean, reason: string }}
 */
function detectSwap(song, knownSingers) {
    const t = (song.title || '').trim();
    const si = (song.singer || '').trim();

    // 空 title/singer → 无法判断，跳过
    if (!t || !si) return { isSwapped: false, reason: 'empty-field' };

    // ── 强信号 ──

    // 1. title 带数字前缀 → 肯定是从 singer 换过来的（B站分P序号）
    if (hasNumberPrefix(t)) {
        return { isSwapped: true, reason: 'title-has-number-prefix' };
    }

    // 2. singer 带数字前缀 → 肯定是歌名（正确的歌手名不会有 B站序号）
    if (hasNumberPrefix(si)) {
        return { isSwapped: true, reason: 'singer-has-number-prefix' };
    }

    // ── 歌手专区检测 ──
    const mainSingers = KNOWN_MAIN_SINGERS[song.bvid];
    if (mainSingers) {
        const titleHasMain = mainSingers.some(n => t.includes(n));
        const singerHasMain = mainSingers.some(n => si.includes(n));

        if (titleHasMain && !singerHasMain) {
            // title 含主歌手, singer 不含 → 互换
            return { isSwapped: true, reason: 'title-contains-main-singer' };
        }
        if (singerHasMain && !titleHasMain) {
            // singer 含主歌手, title 不含 → 正确
            return { isSwapped: false, reason: 'singer-contains-main-singer' };
        }
        if (titleHasMain && singerHasMain) {
            // 都含: collaboration like "陆虎&周深" as title + "缘落" as singer
            // title 短 → 更像人名 → 互换; title 长 → 歌名本身含歌手名(如 "Taylor's Version")
            if (t.length <= 12 && si.length > t.length) {
                return { isSwapped: true, reason: 'both-have-singer-but-title-short' };
            }
            return { isSwapped: false, reason: 'both-have-singer-but-title-long' };
        }
        // 都不含 → 用通用检测
    }

    // ── 已知歌手名检测 ──
    // 优先检查 singer: 如果 singer 是已知歌手 → 大概率正确（信号更强）
    if (knownSingers.has(si)) {
        return { isSwapped: false, reason: 'singer-is-known-singer' };
    }

    // 只有在 singer 不是已知歌手时，才检查 title 是否为已知歌手
    if (knownSingers.has(t)) {
        return { isSwapped: true, reason: 'title-is-known-singer' };
    }

    // ── 形态检测 ──
    const titleLikeName = looksLikeSingerName(t);
    const singerLikeName = looksLikeSingerName(si);
    const singerLikeSong = looksLikeSongTitle(si);

    if (titleLikeName && singerLikeSong) {
        // title 像人名, singer 像歌名 → 互换
        return { isSwapped: true, reason: 'title-like-name+singer-like-song' };
    }

    if (titleLikeName && !singerLikeName) {
        // title 像人名, singer 不像人名 → 互换
        return { isSwapped: true, reason: 'title-like-name-only' };
    }

    if (!titleLikeName && singerLikeName) {
        // title 不像人名, singer 像人名 → 正确
        return { isSwapped: false, reason: 'singer-like-name-only' };
    }

    if (titleLikeName && singerLikeName) {
        // 都像人名: 使用多重信号判断

        // 信号1: 缩写组合名（如 S.H.E, T.R.Y）→ 肯定是歌手
        const titleIsAbbrev = looksLikeAbbreviatedGroupName(t);
        const singerIsAbbrev = looksLikeAbbreviatedGroupName(si);
        if (singerIsAbbrev && !titleIsAbbrev) {
            return { isSwapped: false, reason: 'singer-is-abbrev-group' };
        }
        if (titleIsAbbrev && !singerIsAbbrev) {
            return { isSwapped: true, reason: 'title-is-abbrev-group' };
        }

        // 信号2: 合作关系检测（含 & / _ / 、）→ 很可能是歌手字段
        const titleIsCollab = /[&_、]/.test(t) && t.length <= 20;
        const singerIsCollab = /[&_、]/.test(si) && si.length <= 20;
        if (singerIsCollab && !titleIsCollab) {
            return { isSwapped: false, reason: 'singer-is-collab' };
        }
        if (titleIsCollab && !singerIsCollab) {
            return { isSwapped: true, reason: 'title-is-collab' };
        }

        // 信号3: 比较长度。更短的那个更有可能是真正的歌手名
        // 但如果歌手字段明显更长（≥2倍），且含分隔符，偏向认为是合作
        if (si.length >= t.length * 2 && singerIsCollab) {
            return { isSwapped: false, reason: 'singer-much-longer-collab' };
        }

        // 长度相同时，保守处理——不交换（无法区分）
        if (t.length === si.length) {
            return { isSwapped: false, reason: 'both-like-name-same-length' };
        }

        if (t.length < si.length) {
            return { isSwapped: true, reason: 'both-like-name-title-shorter' };
        } else {
            return { isSwapped: false, reason: 'both-like-name-singer-shorter' };
        }
    }

    // 都不像人名也不像歌名 → 可能是英文歌等
    // 如果标题只包含英文/数字且很短 → 可能是歌名（正确）
    return { isSwapped: false, reason: 'no-clear-signal' };
}

// ===================================================================
// 数据获取
// ===================================================================

async function fetchAllSongs() {
    console.log('📊 查询所有歌曲...');
    let allSongs = [];
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/songs?select=id,bvid,page,title,singer&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
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
    console.log(`  → 总计 ${allSongs.length} 首\n`);
    return allSongs;
}

// ===================================================================
// 主流程
// ===================================================================

async function main() {
    const mode = VERIFY_ONLY ? '🔍 验证模式' : (DRY_RUN ? '🔍 DRY RUN（仅预览）' : '🔧 实际修复模式');
    console.log(`🎵 歌名/歌手互换修复脚本 v3 — ${mode}\n`);

    // 1. 获取所有歌曲
    const allSongs = await fetchAllSongs();

    // 2. 构建已知歌手名集合
    const knownSingers = buildKnownSingersSet(allSongs);
    console.log(`📋 已构建已知歌手名集合: ${knownSingers.size} 个\n`);

    // 3. 检测需要修复的歌曲（仅检测受影响的 BV）
    const fixes = [];
    const affectedSongs = allSongs.filter(s => AFFECTED_SET.has(s.bvid));
    console.log(`🔍 检测 ${affectedSongs.length} 首受影响歌曲...\n`);

    for (const song of affectedSongs) {
        const t = (song.title || '').trim();
        const si = (song.singer || '').trim();

        const { isSwapped, reason } = detectSwap(song, knownSingers);

        if (isSwapped) {
            // 互换: singer → newTitle, title → newSinger
            const newTitle = stripNumberPrefix(si);
            const newSinger = stripNumberPrefix(t);
            fixes.push({
                id: song.id,
                bvid: song.bvid,
                page: song.page,
                oldTitle: t,
                oldSinger: si,
                newTitle,
                newSinger,
                reason: `swap (${reason})`,
            });
        } else if (hasNumberPrefix(t)) {
            // 不互换，但 title 有数字前缀需要清理
            fixes.push({
                id: song.id,
                bvid: song.bvid,
                page: song.page,
                oldTitle: t,
                oldSinger: si,
                newTitle: stripNumberPrefix(t),
                newSinger: si,
                reason: 'strip-only',
            });
        }
        // else: 正确，无需修改
    }

    // 统计
    const swapFixes = fixes.filter(f => f.reason.startsWith('swap'));
    const stripOnly = fixes.filter(f => f.reason === 'strip-only');

    console.log(`🔍 检测结果:`);
    console.log(`   需要交换 title/singer: ${swapFixes.length} 首`);
    console.log(`   仅清理数字前缀: ${stripOnly.length} 首`);
    console.log(`   已正确 (无需修改): ${affectedSongs.length - fixes.length} 首`);
    console.log(`   总计需修改: ${fixes.length} 首\n`);

    // 按 BV 分组统计
    const byBvid = {};
    for (const f of fixes) {
        byBvid[f.bvid] = (byBvid[f.bvid] || 0) + 1;
    }
    console.log('受影响的 BVID:');
    for (const [bvid, count] of Object.entries(byBvid).sort()) {
        const name = BVID_NAMES[bvid] || bvid;
        // Also count songs that were correctly detected
        const totalInBv = affectedSongs.filter(s => s.bvid === bvid).length;
        const correctInBv = totalInBv - count;
        console.log(`  ${name} (${bvid}): ${count} 首需修复, ${correctInBv} 首已正确`);
    }

    // 预览前 40 条有变化的修复
    console.log(`\n📝 ${DRY_RUN || VERIFY_ONLY ? '预览（前40条）:' : '将要修复（前40条）:'}`);
    console.log('='.repeat(95));
    for (const f of fixes.slice(0, 40)) {
        console.log(`#${f.id} (${f.bvid} p${f.page}) [${f.reason}]:`);
        console.log(`  修复前: title="${f.oldTitle}"  singer="${f.oldSinger}"`);
        console.log(`  修复后: title="${f.newTitle}"  singer="${f.newSinger}"`);
    }
    if (fixes.length > 40) {
        console.log(`  ... 还有 ${fixes.length - 40} 条`);
    }

    if (DRY_RUN || VERIFY_ONLY) {
        if (!VERIFY_ONLY) {
            console.log('\n🔍 DRY RUN 完成。确认无误后运行:');
            console.log('  /d/softwa/nodejs/node scripts/fix_swapped_songs.js');
        }
        return;
    }

    // 4. 实际修复
    console.log(`\n🔧 开始修复 ${fixes.length} 首...`);
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
                console.log(`  ✗ #${f.id} (${f.bvid} p${f.page}): ${errText.slice(0, 80)}`);
            }
        } catch (err) {
            failed++;
            console.log(`  ✗ #${f.id}: ${err.message}`);
        }

        if ((i + 1) % 50 === 0) {
            console.log(`  进度: ${i + 1}/${fixes.length} (成功 ${success}, 失败 ${failed})`);
        }

        await sleep(30);
    }

    console.log(`\n========== 完成 ==========`);
    console.log(`成功: ${success} 首`);
    console.log(`失败: ${failed} 首`);
    console.log(`总计: ${fixes.length} 首`);

    // 5. 验证: 每个 BV 抽查前 3 首
    console.log('\n📝 修复后验证（每个 BV 取前3首）:');
    for (const bvid of AFFECTED_BVIDS) {
        const verifyUrl = `${SUPABASE_URL}/rest/v1/songs?select=id,title,singer,page&bvid=eq.${bvid}&order=page.asc&limit=3`;
        const vResp = await fetch(verifyUrl, { headers: HEADERS });
        if (!vResp.ok) continue;
        const vData = await vResp.json();

        const name = BVID_NAMES[bvid] || bvid;
        console.log(`\n  ${name} (${bvid}):`);
        for (const s of vData) {
            console.log(`    #${s.id} p${s.page}: "${s.title}" — ${s.singer || '(无)'}`);
        }
    }
}

main().catch(err => {
    console.error('脚本执行失败:', err);
    process.exit(1);
});
