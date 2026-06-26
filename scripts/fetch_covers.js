/**
 * fetch_covers.js — 从 iTunes API 获取高清专辑封面替换 B站 CDN 图片
 * ===========================================================================
 * 用法: /d/softwa/nodejs/node scripts/fetch_covers.js
 *
 * 流程:
 *   1. 查询所有歌曲（含当前 cover_url）
 *   2. 对每首歌，调用 iTunes Search API 搜索专辑封面
 *   3. 匹配最佳结果（歌手名匹配优先）
 *   4. 升级到 600x600 分辨率
 *   5. PATCH 更新到 Supabase
 */

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

// ========== 工具函数 ==========

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** 判断 cover_url 是否是 B站 CDN（需要替换） */
function isBilibiliCover(url) {
    if (!url) return true;
    return url.includes('hdslb.com') || url.includes('bilibili');
}

/** 升级 iTunes artwork URL 到指定分辨率 */
function upgradeArtworkUrl(url, size = 600) {
    if (!url) return null;
    return url.replace(/\/\d+x\d+bb\.jpg$/, `/${size}x${size}bb.jpg`);
}

/** 模糊匹配歌手名：返回 0-1 的匹配度 */
function singerMatchScore(dbSinger, iTunesArtist) {
    if (!dbSinger || !iTunesArtist) return 0;
    const a = dbSinger.toLowerCase().replace(/[\(\)（）、\s]/g, '');
    const b = iTunesArtist.toLowerCase().replace(/[\(\)（）、\s]/g, '');
    if (a === b) return 1;                          // 完全相同（忽略大小写和括号）
    if (a.includes(b) || b.includes(a)) return 0.8; // 一方包含另一方
    // 提取纯中文/英文部分比较
    const aClean = a.replace(/[^a-z一-鿿]/g, '');
    const bClean = b.replace(/[^a-z一-鿿]/g, '');
    if (aClean && bClean && (aClean.includes(bClean) || bClean.includes(aClean))) return 0.7;
    return 0;
}

// ========== Supabase 操作 ==========

/** 查询所有歌曲（分页） */
async function getAllSongs() {
    console.log('查询所有歌曲...');
    let allSongs = [];
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/songs?select=id,title,singer,cover_url&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
        const resp = await fetch(url, {
            headers: {
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
        });
        if (!resp.ok) {
            console.log(`  ✗ 查询失败: ${resp.status}`);
            break;
        }
        const page = await resp.json();
        if (!page || page.length === 0) break;
        allSongs = allSongs.concat(page);
        console.log(`  → 第 ${offset / PAGE_SIZE + 1} 页: ${page.length} 首 (累计 ${allSongs.length})`);
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }
    console.log(`找到 ${allSongs.length} 首歌曲`);
    return allSongs;
}

/** 更新歌曲的 cover_url */
async function updateCover(songId, coverUrl) {
    const url = `${SUPABASE_URL}/rest/v1/songs?id=eq.${songId}`;
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ cover_url: coverUrl }),
    });
    return resp.ok;
}

// ========== iTunes API 搜索 ==========

/**
 * 在 iTunes 搜索结果中找到最佳匹配的 artwork URL
 * @param {Array} results - iTunes search results
 * @param {string} singer - 数据库中的歌手名
 * @returns {string|null} 600x600 artwork URL 或 null
 */
function findBestArtwork(results, singer) {
    if (!results || results.length === 0) return null;

    // 按歌手匹配度排序
    const scored = results.map(r => ({
        artwork: r.artworkUrl100,
        score: singer ? singerMatchScore(singer, r.artistName) : 0.5,
        artistName: r.artistName,
        trackName: r.trackName,
    })).filter(r => r.artwork);

    if (scored.length === 0) return null;

    // 优先返回匹配度最高的
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    return {
        url: upgradeArtworkUrl(best.artwork),
        artistName: best.artistName,
        trackName: best.trackName,
        score: best.score,
    };
}

/**
 * 搜索 iTunes API
 * @param {string} term - 搜索词
 * @param {string} country - 国家代码
 * @returns {Array} results 数组
 */
async function searchiTunesTerm(term, country = 'cn') {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country}&media=music&limit=5`;
    try {
        const resp = await fetch(url, {
            headers: { 'Accept': 'application/json' },
        });
        if (!resp.ok) return [];
        const data = await resp.json();
        return data.results || [];
    } catch (err) {
        return [];
    }
}

/**
 * 为歌曲搜索最佳封面
 * 策略：title + singer（CN）→ title  only（CN）→ title + singer（US）
 */
async function searchCover(song) {
    const title = song.title.replace(/\(.*?\)|（.*?）|【.*?】/g, '').trim();
    const singer = (song.singer || '').trim();

    // 策略 1: title + singer, CN store
    if (singer) {
        const results = await searchiTunesTerm(`${title} ${singer}`, 'cn');
        const match = findBestArtwork(results, singer);
        if (match && match.score >= 0.5) {
            console.log(`  ✓ iTunes CN: "${match.trackName}" by ${match.artistName} (score=${match.score.toFixed(1)})`);
            return match.url;
        }
    }

    // 策略 2: title only, CN store
    const results2 = await searchiTunesTerm(title, 'cn');
    const match2 = findBestArtwork(results2, singer);
    if (match2 && match2.score >= 0.3) {
        console.log(`  ✓ iTunes CN(title-only): "${match2.trackName}" by ${match2.artistName} (score=${match2.score.toFixed(1)})`);
        return match2.url;
    }

    // 策略 3: title + singer, US store (some Chinese songs have English metadata)
    if (singer) {
        const results3 = await searchiTunesTerm(`${title} ${singer}`, 'us');
        const match3 = findBestArtwork(results3, singer);
        if (match3) {
            console.log(`  ✓ iTunes US: "${match3.trackName}" by ${match3.artistName} (score=${match3.score.toFixed(1)})`);
            return match3.url;
        }
    }

    return null;
}

// ========== 主流程 ==========

async function main() {
    console.log('🎵 封面图片自动匹配脚本\n');
    console.log(`Supabase: ${SUPABASE_URL}\n`);

    const songs = await getAllSongs();
    console.log(`找到 ${songs.length} 首歌曲\n`);

    // 需要更新的歌曲（B站 cover 或 无 cover）
    const needUpdate = songs.filter(s => isBilibiliCover(s.cover_url));
    console.log(`其中 ${needUpdate.length} 首需要更新封面 (B站 CDN 或无封面)\n`);

    if (needUpdate.length === 0) {
        console.log('所有歌曲已有非 B站 封面，无需更新。');
        return;
    }

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < needUpdate.length; i++) {
        const song = needUpdate[i];
        const label = `[${i + 1}/${needUpdate.length}] #${song.id} ${song.title}` +
            (song.singer ? ` — ${song.singer}` : '');
        console.log(label);

        try {
            const coverUrl = await searchCover(song);

            if (coverUrl) {
                const ok = await updateCover(song.id, coverUrl);
                if (ok) {
                    updated++;
                    console.log(`  ✓ 已更新封面`);
                } else {
                    failed++;
                    console.log(`  ✗ 写入数据库失败`);
                }
            } else {
                skipped++;
                console.log(`  ✗ 未找到匹配封面`);
            }
        } catch (err) {
            failed++;
            console.log(`  ✗ 错误: ${err.message}`);
        }

        // 限速：iTunes API 友好
        if (i < needUpdate.length - 1) {
            await sleep(1500);
        }
    }

    console.log(`\n========== 完成 ==========`);
    console.log(`更新成功: ${updated} 首`);
    console.log(`跳过未匹配: ${skipped} 首`);
    console.log(`失败: ${failed} 首`);
    console.log(`总计处理: ${needUpdate.length} 首`);
}

main().catch(err => {
    console.error('脚本执行失败:', err);
    process.exit(1);
});
