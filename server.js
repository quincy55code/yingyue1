/**
 * 音乐播放器 — Node.js 后端
 * 代理 B站 DASH 音频流 + Supabase 数据查询
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

// ========== 手动加载 .env（不依赖 dotenv 包） ==========
(function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) {
        console.warn('[env] .env 文件不存在，使用系统环境变量');
        return;
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

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('[init] 缺少 SUPABASE_URL 或 SUPABASE_ANON_KEY，请检查 .env 文件');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[init] 缺少 SUPABASE_SERVICE_ROLE_KEY，请检查 .env 文件');
    process.exit(1);
}
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(express.json());   // 解析 POST JSON body
const PORT = 8765;

// CORS — 允许前端跨域访问
app.use((_req, res, next) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
    });
    if (_req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// 提供静态文件（index.html, css, js）
app.use(express.static(__dirname));

// ========== 工具函数：格式化歌曲数据 ==========
function formatSong(s) {
    if (!s) return null;
    const hasSegment = s.start_seconds != null && s.end_seconds != null;
    return {
        id: s.id,
        title: s.title || '未知歌曲',
        singer: s.singer || '',
        bvid: s.bvid,
        page: s.page,
        start_time: hasSegment ? s.start_seconds : null,
        end_time: hasSegment ? s.end_seconds : null,
        page_duration: s.duration_seconds || null,
        cover_url: s.cover_url || null,
        duration: hasSegment
            ? (s.end_seconds - s.start_seconds)
            : (s.duration_seconds || null),
    };
}

// ========== 原硬编码歌曲（备份） ==========
// const SONGS = [
//     { id: 1, title: "离别开出花", bvid: "BV1pY5q6jECZ", page: 1, ... },
// ];

// B站 API 请求头
const BILI_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Referer": "https://www.bilibili.com/",
};

// cid 缓存：bvid:page → cid（cid 对于给定 bvid+page 是静态的，缓存可跳过一次 B站 API 调用）
const cidCache = new Map();
function cacheKey(bvid, page) { return `${bvid}:${page || 1}`; }

// ========== API 端点 ==========

/** GET /api/songs — 从 Supabase 查询前 10 首歌曲 */
app.get('/api/songs', async (_req, res) => {
    try {
        const { data, error } = await supabase
            .from('songs')
            .select('id,title,singer,bvid,page,start_seconds,end_seconds,duration_seconds,cover_url,bilibili_url')
            .order('id', { ascending: true })
            .limit(10);

        if (error) {
            console.error('[songs] Supabase error:', error.message);
            return res.status(500).json({ error: '获取歌曲列表失败' });
        }

        res.json((data || []).map(formatSong).filter(Boolean));
    } catch (err) {
        console.error('[songs]', err.message);
        res.status(500).json({ error: '获取歌曲列表失败' });
    }
});

/** GET /api/search?q=关键词 — 模糊搜索歌名 + 歌手 */
app.get('/api/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q || q.length > 100) {
        return res.json({ results: [], query: q });
    }

    try {
        const { data, error } = await supabase
            .from('songs')
            .select('id,title,singer,bvid,page,start_seconds,end_seconds,duration_seconds,cover_url,bilibili_url')
            .or(`title.ilike.%${q}%,singer.ilike.%${q}%`)
            .order('id', { ascending: true })
            .limit(20);

        if (error) {
            console.error('[search] Supabase error:', error.message);
            return res.status(500).json({ error: '搜索失败' });
        }

        res.json({
            results: (data || []).map(formatSong).filter(Boolean),
            query: q,
        });
    } catch (err) {
        console.error('[search]', err.message);
        res.status(500).json({ error: '搜索失败' });
    }
});

/** POST /api/search-log — 记录未找到的搜索词（5 分钟内去重） */
app.post('/api/search-log', async (req, res) => {
    const query = (req.body.query || '').trim();
    if (!query) {
        return res.status(400).json({ error: 'query is required' });
    }

    try {
        // 检查 5 分钟内是否已有相同查询，避免重复记录
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: existing } = await supabase
            .from('search_logs')
            .select('id')
            .eq('query', query)
            .gte('searched_at', fiveMinAgo)
            .limit(1);

        if (existing && existing.length > 0) {
            return res.json({ ok: true, deduped: true });
        }

        const { error } = await supabase
            .from('search_logs')
            .insert({ query, searched_at: new Date().toISOString() });

        if (error) {
            console.error('[search-log] Supabase error:', error.message);
            return res.status(500).json({ error: '记录失败' });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[search-log]', err.message);
        res.status(500).json({ error: '记录失败' });
    }
});

/** GET /api/stream/:songId — 代理 B站 DASH 音频流 */
app.get('/api/stream/:songId', async (req, res) => {
    const songId = parseInt(req.params.songId);

    // 从 Supabase 查询歌曲元数据
    let song;
    try {
        const { data, error } = await supabase
            .from('songs')
            .select('*')
            .eq('id', songId)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: 'Song not found' });
        }
        song = data;
    } catch (err) {
        return res.status(500).json({ error: '查询歌曲失败' });
    }

    try {
        // 1. 获取 cid（优先从缓存读取，减少一次 B站 API 调用）
        const key = cacheKey(song.bvid, song.page);
        let cid = cidCache.get(key);

        if (!cid) {
            const viewUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${song.bvid}`;
            const viewResp = await fetch(viewUrl, { headers: BILI_HEADERS });
            const viewData = await viewResp.json();

            if (viewData.code !== 0) {
                return res.status(502).json({ error: `B站视频信息获取失败: ${viewData.message}` });
            }

            const pages = viewData.data.pages || [];
            const pageIdx = (song.page || 1) - 1;
            if (pageIdx >= pages.length) {
                return res.status(400).json({ error: '分P不存在' });
            }
            cid = pages[pageIdx].cid;
            cidCache.set(key, cid);  // 缓存 cid（静态值，不会过期）
        }

        // 2. 获取播放地址（DASH 格式）
        const playUrl = `https://api.bilibili.com/x/player/playurl?bvid=${song.bvid}&cid=${cid}&fnval=16&fnver=0&fourk=1`;
        const playResp = await fetch(playUrl, { headers: BILI_HEADERS });
        const playData = await playResp.json();

        if (playData.code !== 0) {
            return res.status(502).json({ error: `B站播放地址获取失败: ${playData.message}` });
        }

        const dash = playData.data.dash;
        if (!dash || !dash.audio || dash.audio.length === 0) {
            return res.status(502).json({ error: '该视频没有可用的 DASH 音频流' });
        }

        // 优先最高码率
        const audios = [...dash.audio].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
        let audioUrl = audios[0].base_url || audios[0].baseUrl;

        // 补全协议前缀
        if (audioUrl.startsWith('//')) {
            audioUrl = 'https:' + audioUrl;
        }

        // 3. 流式转发 — 转发浏览器的 Range 请求头
        const browserRange = req.headers.range;
        const upstreamHeaders = { ...BILI_HEADERS };
        if (browserRange) {
            upstreamHeaders["Range"] = browserRange;
        }

        const upstreamResp = await fetch(audioUrl, {
            headers: upstreamHeaders,
        });

        if (!upstreamResp.ok && upstreamResp.status !== 206) {
            return res.status(502).json({ error: `B站 CDN 请求失败: ${upstreamResp.status}` });
        }

        const isPartial = upstreamResp.status === 206;
        const upstreamContentLength = upstreamResp.headers.get('content-length');

        const baseHeaders = {
            'Content-Type': 'audio/mp4',
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
        };

        if (isPartial) {
            res.status(206);
            const contentRange = upstreamResp.headers.get('content-range');
            if (contentRange) baseHeaders['Content-Range'] = contentRange;
            if (upstreamContentLength) baseHeaders['Content-Length'] = upstreamContentLength;
            res.set(baseHeaders);
        } else if (upstreamContentLength) {
            baseHeaders['Content-Length'] = upstreamContentLength;
            res.set(baseHeaders);
        } else {
            console.log(`[stream] songId=${songId}: 上游无 Content-Length，缓冲完整文件...`);
            const buffer = Buffer.from(await upstreamResp.arrayBuffer());
            baseHeaders['Content-Length'] = buffer.length;
            res.set(baseHeaders);
            res.end(buffer);
            return;
        }

        const reader = upstreamResp.body.getReader();

        req.on('close', () => {
            reader.cancel().catch(() => {});
        });

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                res.write(Buffer.from(value));
            }
        } catch (e) {
            // 客户端断开连接 — 正常情况
        }

        res.end();
    } catch (err) {
        console.error(`[stream error] songId=${songId}:`, err.message);
        if (!res.headersSent) {
            res.status(502).json({ error: `请求B站失败: ${err.message}` });
        }
    }
});

app.listen(PORT, () => {
    console.log(`🎵 音乐播放器后端已启动 → http://localhost:${PORT}`);
    console.log(`   歌曲列表: http://localhost:${PORT}/api/songs`);
    console.log(`   搜索接口: http://localhost:${PORT}/api/search?q=离别`);
    console.log(`   前端页面: http://localhost:${PORT}`);
});
