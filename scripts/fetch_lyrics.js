/**
 * fetch_lyrics.js — 为数据库中的歌曲自动匹配 LRC 歌词
 * =====================================================
 * 用法: /d/softwa/nodejs/node scripts/fetch_lyrics.js
 *
 * 流程:
 *   1. 查询所有 lrc_text IS NULL 的歌曲
 *   2. 对每首歌，调用公开 LRC API 搜索
 *   3. 校验歌词（至少 5 行时间戳行）
 *   4. 写入数据库
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

const BILI_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com/",
};

// ========== 工具函数 ==========

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** 校验 LRC 文本：至少有 minLines 行有效时间戳行 */
function isValidLRC(text, minLines = 5) {
    if (!text || typeof text !== 'string') return false;
    const timeRe = /\[\d{2}:\d{2}\.\d{2,3}\]/;
    const validLines = text.split('\n').filter(l => timeRe.test(l) && l.replace(timeRe, '').trim());
    return validLines.length >= minLines;
}

/** Schema-validation: reject metadata-only LRC lines */
function hasActualLyrics(lrc) {
    const lines = lrc.split('\n').filter(l => /\[\d{2}:\d{2}\.\d{2,3}\]/.test(l));
    const lyricLines = lines.filter(l => {
        const text = l.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();
        // Reject metadata-only lines (作词/作曲/编曲/producer/乐器 etc.)
        return text && !/^(作词|作曲|编曲|制作人|混音|录音|和声|吉他|贝斯|钢琴|键盘|鼓手|弦乐|监制|出品|发行|OP|SP|母带|企划|文案|封面|演唱|歌手|专辑|原唱|翻唱|词曲|Written|Composed|Produced|Arranged|Mixed|Mastered|Lyrics|Music|Vocal|Guitar|Bass|Piano|Drums|Strings)/i.test(text);
    });
    return lyricLines.length >= 3;
}

/** Create a fetch with timeout */
function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** 从 Supabase 获取所有无歌词的歌曲（分页） */
async function getSongsWithoutLyrics() {
    console.log('查询无歌词的歌曲...');
    let allSongs = [];
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/songs?select=id,title,singer&lrc_text=is.null&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
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
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }
    console.log(`  → 总计 ${allSongs.length} 首无歌词`);
    return allSongs;
}

/** 更新歌曲的 lrc_text */
async function updateLyrics(songId, lrcText) {
    const url = `${SUPABASE_URL}/rest/v1/songs?id=eq.${songId}`;
    try {
        const resp = await fetchWithTimeout(url, {
            method: 'PATCH',
            headers: {
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ lrc_text: lrcText }),
        }, 15000);
        return resp.ok;
    } catch (err) {
        console.log(`  ✗ 写入请求失败: ${err.message}`);
        return false;
    }
}

// ========== LRC API 搜索（多源尝试） ==========

/**
 * 网易云音乐歌词搜索
 * 对中文歌曲覆盖率远高于 lrclib
 */
async function searchNeteaseLyric(song) {
    const query = `${song.title} ${song.singer || ''}`.trim();
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': 'https://music.163.com/',
        'Accept': 'application/json',
    };

    try {
        // Step 1: Search for the song
        const searchUrl = `https://music.163.com/api/search/get?type=1&s=${encodeURIComponent(query)}&limit=5`;
        console.log(`  → 尝试 netease-search...`);
        const sr = await fetchWithTimeout(searchUrl, { headers }, 10000);
        if (!sr.ok) return null;
        const sd = await sr.json();
        if (sd.code !== 200 || !sd.result?.songs?.length) return null;

        // Try the first 3 results
        const songs = sd.result.songs.slice(0, 3);
        for (const s of songs) {
            const songId = s.id;
            // Step 2: Fetch lyrics
            const lyricUrl = `https://music.163.com/api/song/lyric?id=${songId}&lv=1`;
            const lr = await fetchWithTimeout(lyricUrl, { headers }, 10000);
            if (!lr.ok) continue;
            const ld = await lr.json();
            if (ld.code !== 200 || !ld.lrc?.lyric) continue;

            const lrc = ld.lrc.lyric.trim();
            if (isValidLRC(lrc) && hasActualLyrics(lrc)) {
                // Also try to get translated/tlnote lyrics for dual-language
                let fullLrc = lrc;
                if (ld.tlyric?.lyric) fullLrc += '\n' + ld.tlyric.lyric.trim();
                console.log(`  ✓ netease 匹配成功: "${s.name}" — ${s.artists?.map(a=>a.name).join('/')} (${lrc.split('\n').length} 行)`);
                return fullLrc;
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') console.log(`  ✗ netease 超时`);
        else console.log(`  ✗ netease 请求失败: ${err.message}`);
    }
    return null;
}

/**
 * 搜索源 1: lrcshare 系列 API
 * 歌名 + 歌手 → 最佳匹配 LRC
 */
async function searchLRCMusic(song) {
    const query = `${song.title} ${song.singer || ''}`.trim();
    const encoded = encodeURIComponent(query);

    // 尝试多个公开 LRC API（按优先级排序）
    const apis = [
        {
            name: 'lrclib',
            url: `https://lrclib.net/api/search?q=${encoded}`,
            extract: async (data) => {
                if (!Array.isArray(data) || data.length === 0) return null;
                const match = data.find(d => d.syncedLyrics);
                return match ? match.syncedLyrics : null;
            },
        },
        {
            name: 'lrclib-direct',
            url: `https://lrclib.net/api/get?track_name=${encodeURIComponent(song.title)}${song.singer ? '&artist_name=' + encodeURIComponent(song.singer) : ''}`,
            extract: async (data) => {
                if (!data || !data.syncedLyrics) return null;
                return data.syncedLyrics;
            },
        },
    ];

    for (const api of apis) {
        try {
            console.log(`  → 尝试 ${api.name}: ${api.url.substring(0, 80)}...`);
            const resp = await fetchWithTimeout(api.url, {
                headers: { 'Accept': 'application/json' },
            }, 15000);
            if (!resp.ok) continue;

            const data = await resp.json();
            const lrc = await api.extract(data);
            if (lrc && isValidLRC(lrc) && hasActualLyrics(lrc)) {
                console.log(`  ✓ ${api.name} 匹配成功 (${lrc.split('\n').length} 行)`);
                return lrc;
            }
        } catch (err) {
            if (err.name === 'AbortError') console.log(`  ✗ ${api.name} 超时`);
            else console.log(`  ✗ ${api.name} 请求失败: ${err.message}`);
        }
    }

    return null;
}

// ========== 主流程 ==========

async function main() {
    console.log('🎵 歌词自动匹配脚本\n');

    const songs = await getSongsWithoutLyrics();
    console.log(`找到 ${songs.length} 首无歌词的歌曲\n`);

    if (songs.length === 0) {
        console.log('所有歌曲都已有歌词，无需匹配。');
        return;
    }

    let success = 0;
    let failed = 0;

    for (let i = 0; i < songs.length; i++) {
        const song = songs[i];
        const label = `[${i + 1}/${songs.length}] #${song.id} ${song.title}` +
            (song.singer ? ` — ${song.singer}` : '');
        console.log(label);

        try {
            // 优先尝试网易云（快 + 中文歌曲覆盖率高），失败则尝试 lrclib
            let lrc = await searchNeteaseLyric(song);
            if (!lrc) {
                lrc = await searchLRCMusic(song);
            }

            if (lrc) {
                const updated = await updateLyrics(song.id, lrc);
                if (updated) {
                    success++;
                    console.log(`  ✓ 已写入数据库`);
                } else {
                    failed++;
                    console.log(`  ✗ 写入数据库失败`);
                }
            } else {
                failed++;
                console.log(`  ✗ 未找到匹配歌词`);
            }
        } catch (err) {
            failed++;
            console.log(`  ✗ 处理异常: ${err.message}`);
        }

        // 限速：避免请求过于频繁
        if (i < songs.length - 1) {
            await sleep(200);
        }
    }

    console.log(`\n========== 完成 ==========`);
    console.log(`成功: ${success} 首`);
    console.log(`失败: ${failed} 首`);
    console.log(`总计: ${songs.length} 首`);
}

main().catch(err => {
    console.error('脚本执行失败:', err);
    process.exit(1);
});
