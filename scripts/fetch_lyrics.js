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

/** 从 Supabase 获取所有无歌词的歌曲 */
async function getSongsWithoutLyrics() {
    const url = `${SUPABASE_URL}/rest/v1/songs?select=id,title,singer&lrc_text=is.null&order=id.asc`;
    const resp = await fetch(url, {
        headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
    });
    if (!resp.ok) {
        throw new Error(`查询歌曲失败: ${resp.status}`);
    }
    return resp.json();
}

/** 更新歌曲的 lrc_text */
async function updateLyrics(songId, lrcText) {
    const url = `${SUPABASE_URL}/rest/v1/songs?id=eq.${songId}`;
    const resp = await fetch(url, {
        method: 'PATCH',
        headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ lrc_text: lrcText }),
    });
    return resp.ok;
}

// ========== LRC API 搜索（多源尝试） ==========

/**
 * 搜索源 1: lrcshare 系列 API
 * 歌名 + 歌手 → 最佳匹配 LRC
 */
async function searchLRCMusic(song) {
    const query = `${song.title} ${song.singer || ''}`.trim();
    const encoded = encodeURIComponent(query);

    // 尝试多个公开 LRC API
    const apis = [
        {
            name: 'lrclib',
            url: `https://lrclib.net/api/search?q=${encoded}`,
            extract: async (data) => {
                // data is array, take first with syncedLyrics
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
            const resp = await fetch(api.url, {
                headers: { ...BILI_HEADERS, 'Accept': 'application/json' },
            });
            if (!resp.ok) continue;

            const data = await resp.json();
            const lrc = await api.extract(data);
            if (lrc && isValidLRC(lrc)) {
                console.log(`  ✓ ${api.name} 匹配成功 (${lrc.split('\n').length} 行)`);
                return lrc;
            }
        } catch (err) {
            console.log(`  ✗ ${api.name} 请求失败: ${err.message}`);
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

        const lrc = await searchLRCMusic(song);

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

        // 限速：避免请求过于频繁
        if (i < songs.length - 1) {
            await sleep(1500);
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
