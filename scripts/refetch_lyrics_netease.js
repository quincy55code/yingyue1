/**
 * refetch_lyrics_netease.js — 用网易云音乐重新覆盖所有歌词
 * ==========================================================
 * 用法: /d/softwa/nodejs/node scripts/refetch_lyrics_netease.js
 *
 * 与 fetch_lyrics.js 不同：
 *   - 只使用网易云音乐（对中文歌时间轴最准）
 *   - 覆盖已有的 lrc_text（不只是 NULL 的）
 *   - 如果网易云搜不到，保留原有歌词不变
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

const NETEAZE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Referer': 'https://music.163.com/',
    'Accept': 'application/json',
};

// ========== 工具函数 ==========

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function isValidLRC(text, minLines = 5) {
    if (!text || typeof text !== 'string') return false;
    const timeRe = /\[\d{2}:\d{2}\.\d{2,3}\]/;
    const validLines = text.split('\n').filter(l => timeRe.test(l) && l.replace(timeRe, '').trim());
    return validLines.length >= minLines;
}

function hasActualLyrics(lrc) {
    const lines = lrc.split('\n').filter(l => /\[\d{2}:\d{2}\.\d{2,3}\]/.test(l));
    const lyricLines = lines.filter(l => {
        const text = l.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();
        return text && !/^(作词|作曲|编曲|制作人|混音|录音|和声|吉他|贝斯|钢琴|键盘|鼓手|弦乐|监制|出品|发行|OP|SP|母带|企划|文案|封面|演唱|歌手|专辑|原唱|翻唱|词曲|Written|Composed|Produced|Arranged|Mixed|Mastered|Lyrics|Music|Vocal|Guitar|Bass|Piano|Drums|Strings)/i.test(text);
    });
    return lyricLines.length >= 3;
}

// ========== 获取所有有歌词的歌曲 ==========

async function getAllSongsWithLyrics() {
    console.log('查询所有有歌词的歌曲...');
    let allSongs = [];
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/songs?select=id,title,singer,lrc_text&lrc_text=not.is.null&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
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
    console.log(`  → 总计 ${allSongs.length} 首有歌词`);
    return allSongs;
}

// ========== 网易云搜索歌词 ==========

async function searchNeteaseLyric(song) {
    const query = `${song.title} ${song.singer || ''}`.trim();

    try {
        const searchUrl = `https://music.163.com/api/search/get?type=1&s=${encodeURIComponent(query)}&limit=5`;
        const sr = await fetchWithTimeout(searchUrl, { headers: NETEAZE_HEADERS }, 10000);
        if (!sr.ok) return null;
        const sd = await sr.json();
        if (sd.code !== 200 || !sd.result?.songs?.length) return null;

        const songs = sd.result.songs.slice(0, 3);
        for (const s of songs) {
            const lyricUrl = `https://music.163.com/api/song/lyric?id=${s.id}&lv=1`;
            const lr = await fetchWithTimeout(lyricUrl, { headers: NETEAZE_HEADERS }, 10000);
            if (!lr.ok) continue;
            const ld = await lr.json();
            if (ld.code !== 200 || !ld.lrc?.lyric) continue;

            const lrc = ld.lrc.lyric.trim();
            if (isValidLRC(lrc) && hasActualLyrics(lrc)) {
                let fullLrc = lrc;
                if (ld.tlyric?.lyric) fullLrc += '\n' + ld.tlyric.lyric.trim();
                return {
                    lrc: fullLrc,
                    matchedName: s.name,
                    matchedArtist: s.artists?.map(a => a.name).join('/') || '',
                    lineCount: lrc.split('\n').length,
                };
            }
        }
    } catch (err) {
        // Silently fail
    }
    return null;
}

// ========== 更新歌词 ==========

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
        return false;
    }
}

// ========== 主流程 ==========

async function main() {
    console.log('🎵 网易云歌词全覆盖脚本\n');
    console.log('策略：用网易云重新匹配已有歌词的歌曲，已匹配过的自动跳过\n');

    // 加载已匹配 ID 跳过列表
    const skipPath = path.join(__dirname, 'skip_ids.json');
    let skipIds = new Set();
    if (fs.existsSync(skipPath)) {
        skipIds = new Set(JSON.parse(fs.readFileSync(skipPath, 'utf-8')));
        console.log(`从 skip_ids.json 加载了 ${skipIds.size} 个已匹配 ID\n`);
    }

    const allSongs = await getAllSongsWithLyrics();
    if (allSongs.length === 0) {
        console.log('没有需要处理的歌曲。');
        return;
    }

    // 过滤掉已匹配的
    const songs = allSongs.filter(s => !skipIds.has(s.id));
    const skipped = allSongs.length - songs.length;
    console.log(`总计 ${allSongs.length} 首有歌词，跳过 ${skipped} 首已匹配，需处理 ${songs.length} 首\n`);
    if (songs.length === 0) {
        console.log('所有歌曲都已用网易云匹配！');
        return;
    }

    let overwritten = 0;  // 成功覆盖
    let kept = 0;         // 网易云搜不到，保留原歌词
    let apiFail = 0;      // API 调用异常（保留原歌词）

    for (let i = 0; i < songs.length; i++) {
        const song = songs[i];
        const label = `[${i + 1}/${songs.length}] #${song.id} ${song.title}` +
            (song.singer ? ` — ${song.singer}` : '');
        console.log(label);

        try {
            const result = await searchNeteaseLyric(song);

            if (result) {
                const updated = await updateLyrics(song.id, result.lrc);
                if (updated) {
                    overwritten++;
                    console.log(`  ✓ 网易云覆盖: "${result.matchedName}" — ${result.matchedArtist} (${result.lineCount} 行)`);
                } else {
                    apiFail++;
                    console.log(`  ✗ 写入失败，保留原歌词`);
                }
            } else {
                kept++;
                console.log(`  — 网易云未找到，保留原歌词`);
            }
        } catch (err) {
            apiFail++;
            console.log(`  ✗ 异常: ${err.message}，保留原歌词`);
        }

        if (i < songs.length - 1) {
            await sleep(200);
        }
    }

    console.log(`\n========== 完成 ==========`);
    console.log(`覆盖成功: ${overwritten} 首`);
    console.log(`保留原歌词: ${kept} 首 (网易云无结果)`);
    console.log(`API异常: ${apiFail} 首 (保留原歌词)`);
    console.log(`总计处理: ${songs.length} 首`);
}

main().catch(err => {
    console.error('脚本执行失败:', err);
    process.exit(1);
});
