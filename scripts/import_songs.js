/**
 * import_songs.js — 批量导入 B站 视频中的歌曲到 Supabase
 * ======================================================
 * 用法: /d/softwa/nodejs/node scripts/import_songs.js
 *
 * 流程:
 *   1. 调用 B站 API 获取每个 BV 号的分 P 列表
 *   2. 查询数据库中已有的 bvid+page 组合（去重）
 *   3. 批量插入新歌曲
 *   4. 输出摘要
 */

const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ========== 加载 .env ==========
(function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) {
        console.error('[env] .env 文件不存在');
        process.exit(1);
    }
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

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[init] 缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const SUPABASE_HEADERS = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
};

const BILI_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Referer': 'https://www.bilibili.com/',
};

// ========== 从配置文件加载 BVID 列表 ==========
const VIDEO_LIST_PATH = path.join(__dirname, 'video_list.json');
let VIDEOS;
try {
    if (fs.existsSync(VIDEO_LIST_PATH)) {
        const raw = JSON.parse(fs.readFileSync(VIDEO_LIST_PATH, 'utf-8'));
        VIDEOS = raw.map((bvid, i) => ({ bvid, label: `视频${i + 1}` }));
        console.log(`[config] 从 video_list.json 加载了 ${VIDEOS.length} 个视频\n`);
    } else {
        console.error('[config] video_list.json 不存在，使用默认列表');
        VIDEOS = [
            { bvid: 'BV1Dd4y1U7AE', label: '视频1' },
            { bvid: 'BV1tv4y127ZC', label: '视频2' },
            { bvid: 'BV1BDk2YCEHF', label: '视频3' },
        ];
    }
} catch (err) {
    console.error('[config] 读取 video_list.json 失败:', err.message);
    process.exit(1);
}

// ========== 工具函数 ==========

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** HTTP GET (支持 https) */
function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, { headers, timeout: 15000 }, (res) => {
            // 处理重定向
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                httpGet(res.headers.location, headers).then(resolve).catch(reject);
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data), raw: data });
                } catch {
                    resolve({ status: res.statusCode, data: null, raw: data });
                }
            });
        }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
    });
}

/** 获取某个 BVID 在数据库中已有的 page 集合（用于去重） */
async function getExistingPages(bvid) {
    const url = `${SUPABASE_URL}/rest/v1/songs?select=page&bvid=eq.${encodeURIComponent(bvid)}`;
    const resp = await fetch(url, { headers: SUPABASE_HEADERS });
    if (!resp.ok) throw new Error(`查询失败: ${resp.status}`);
    const songs = await resp.json();
    return new Set(songs.map(s => s.page));
}

/** 统计数据库中已有歌曲总数 */
async function countExistingSongs() {
    const url = `${SUPABASE_URL}/rest/v1/songs?select=id&limit=1&order=id.desc`;
    const resp = await fetch(url, { headers: { ...SUPABASE_HEADERS, 'Prefer': 'count=exact' } });
    // PostgREST 返回的 content-range 里有总数
    const range = resp.headers.get('content-range');
    if (range) {
        const total = range.split('/')[1];
        return parseInt(total) || 0;
    }
    return 0;
}

/** 获取视频信息（包括分P列表） */
async function getVideoInfo(bvid) {
    const url = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
    const result = await httpGet(url, BILI_HEADERS);
    if (!result.data || result.data.code !== 0) {
        throw new Error(`B站 API 返回错误: ${JSON.stringify(result.data)}`);
    }
    const data = result.data.data;
    console.log(`  标题: ${data.title}`);
    console.log(`  分P数: ${data.pages.length}`);

    const song = data.pages[0]; // 第一页
    console.log(`  P1 示例: ${song.part} (${song.duration}秒)`);

    return data;
}

/** 解析歌手和歌名（B站合集格式：NN.歌名 - 歌手 或 歌名） */
function parseTitle(raw) {
    let part = raw.trim();

    // 去除数字前缀: "01.", "1.", "001." 等
    part = part.replace(/^\d{1,4}\.\s*/, '');

    // 常见分隔符: " - ", " – ", "—", "：", ": "
    const separators = [' - ', ' – ', '— ', '—', '：', ': '];
    for (const sep of separators) {
        const idx = part.indexOf(sep);
        if (idx > 0) {
            return {
                title: part.slice(0, idx).trim(),
                singer: part.slice(idx + sep.length).trim(),
            };
        }
    }

    // 尝试用最后一个 "-" 分割（无空格版本，如 "晴天-周杰伦"）
    const lastDash = part.lastIndexOf('-');
    if (lastDash > 0) {
        const left = part.slice(0, lastDash).trim();
        const right = part.slice(lastDash + 1).trim();
        if (right.length >= 1 && left.length >= 1
            && !/^\d+$/.test(right) && !/^\d+$/.test(left)) {
            return { title: left, singer: right };
        }
    }

    // 没有明显的分隔符，整个就是歌名
    return { singer: null, title: part.trim() };
}

/** 批量插入歌曲 */
async function insertSongs(songsToInsert) {
    let success = 0;
    let failed = 0;

    for (let i = 0; i < songsToInsert.length; i++) {
        const song = songsToInsert[i];
        const label = `[${i + 1}/${songsToInsert.length}] ${song.singer || '未知'} — ${song.title}`;

        try {
            const resp = await fetch(`${SUPABASE_URL}/rest/v1/songs`, {
                method: 'POST',
                headers: {
                    ...SUPABASE_HEADERS,
                    'Prefer': 'return=representation',
                },
                body: JSON.stringify(song),
            });

            if (resp.ok) {
                const inserted = await resp.json();
                song._inserted_id = inserted[0]?.id;
                success++;
            } else {
                const errText = await resp.text();
                failed++;
                console.log(`  ✗ ${label}: ${errText.slice(0, 100)}`);
            }
        } catch (err) {
            failed++;
            console.log(`  ✗ ${label}: ${err.message}`);
        }

        // 小延迟避免请求过快
        if (i < songsToInsert.length - 1 && (i + 1) % 10 === 0) {
            await sleep(200);
        }
    }

    return { success, failed };
}

// ========== 主流程 ==========

async function main() {
    console.log('🎵 批量导入歌曲脚本\n');
    console.log('='.repeat(60));

    // 1. 获取已有歌曲总数
    console.log('\n📊 查询数据库已有歌曲...');
    const existingTotal = await countExistingSongs();
    console.log(`  → 数据库中已有 ${existingTotal} 首歌曲\n`);

    // 2. 逐个获取视频信息
    const allNewSongs = [];
    const videoStats = [];

    for (let vi = 0; vi < VIDEOS.length; vi++) {
        const video = VIDEOS[vi];
        try {
            console.log(`\n📺 [${vi + 1}/${VIDEOS.length}] 获取 ${video.bvid} 视频信息...`);
            const info = await getVideoInfo(video.bvid);
            const pages = info.pages;
            let newCount = 0;
            let dupCount = 0;

            // 查询该 BVID 已在数据库中的 page 集合
            const existingPages = await getExistingPages(video.bvid);

            for (const page of pages) {
                if (existingPages.has(page.page)) {
                    dupCount++;
                    continue; // 跳过已存在的
                }

                // 解析歌名和歌手
                const { singer, title } = parseTitle(page.part);

                // 构建歌曲对象
                const song = {
                    title: title,
                    singer: singer || '',
                    bilibili_url: `https://www.bilibili.com/video/${video.bvid}/?p=${page.page}`,
                    bvid: video.bvid,
                    page: page.page,
                    start_seconds: null,
                    end_seconds: null,
                    duration_seconds: page.duration,
                    cover_url: info.pic || '',
                };

                allNewSongs.push(song);
                newCount++;
            }

            videoStats.push({
                bvid: video.bvid,
                title: info.title,
                total: pages.length,
                new: newCount,
                dup: dupCount,
            });
            console.log(`  → 总计 ${pages.length} 页，新增 ${newCount}，重复 ${dupCount}（已跳过）`);

        } catch (err) {
            console.log(`  ✗ 获取 ${video.bvid} 失败: ${err.message}`);
        }

        // 限速：请求间隔
        await sleep(500);
    }

    // 3. 摘要
    console.log('\n' + '='.repeat(60));
    console.log('📋 摘要:');
    for (const vs of videoStats) {
        console.log(`  ${vs.bvid} - "${vs.title}": ${vs.total}页, 新增${vs.new}, 重复${vs.dup}`);
    }
    console.log(`\n  总计待插入: ${allNewSongs.length} 首`);

    if (allNewSongs.length === 0) {
        console.log('\n✅ 没有新歌曲需要导入，所有歌曲已存在数据库中。');
        return;
    }

    // 4. 确认并插入
    console.log('\n🚀 开始插入...');
    const { success, failed } = await insertSongs(allNewSongs);

    console.log('\n' + '='.repeat(60));
    console.log('✅ 导入完成!');
    console.log(`  成功: ${success} 首`);
    console.log(`  失败: ${failed} 首`);
    console.log(`  跳过（重复）: ${allNewSongs.length - success - failed} 首`);

    // 输出新增歌曲的前5首供参考
    if (success > 0) {
        console.log('\n📝 新增歌曲示例（前5首）:');
        const inserted = allNewSongs.filter(s => s._inserted_id);
        for (const s of inserted.slice(0, 5)) {
            console.log(`  #${s._inserted_id} ${s.singer || '未知'} — ${s.title} (${s.duration_seconds}s)`);
        }

        console.log(`\n💡 接下来请运行:
  /d/softwa/nodejs/node scripts/map_tags.js    # 为新歌曲添加标签
  /d/softwa/nodejs/node scripts/fetch_lyrics.js  # 为新歌曲获取歌词`);
    }
}

main().catch(err => {
    console.error('脚本执行失败:', err);
    process.exit(1);
});
