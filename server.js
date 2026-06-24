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

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
if (!JWT_SECRET) {
    console.error('[init] 缺少 SUPABASE_JWT_SECRET，请检查 .env 文件');
    process.exit(1);
}

// ========== 工具函数：签发自定义 JWT（不依赖 jsonwebtoken 包） ==========
const crypto = require('crypto');
function signJWT(payload) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const header64 = enc(header);
    const payload64 = enc(payload);
    const signature = crypto.createHmac('sha256', JWT_SECRET)
        .update(`${header64}.${payload64}`)
        .digest('base64url');
    return `${header64}.${payload64}.${signature}`;
}

// ========== 163 邮箱 SMTP（直连 IP 绕过 DNS 劫持） ==========
const nodemailer = require('nodemailer');
const mailTransporter = nodemailer.createTransport({
    host: '117.135.214.13',  // 163 SMTP 真实 IP，绕过 DNS 劫持 (198.18.0.4)
    port: 465,
    secure: true,
    tls: { servername: 'smtp.163.com' },  // TLS SNI 必须用域名
    auth: {
        user: 'lexiaode@163.com',
        pass: process.env.EMAIL_SMTP_PASS || '',
    },
});

mailTransporter.verify((err) => {
    if (err) console.error('[mail] SMTP 连接失败:', err.message);
    else console.log('[mail] SMTP 就绪 (lexiaode@163.com)');
});

const app = express();
app.use(express.json({ limit: '5mb' }));   // 解析 POST JSON body（提高限制以支持 base64 头像上传）
const PORT = 8765;

// CORS — 允许前端跨域访问
app.use((_req, res, next) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
    });
    if (_req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// 提供静态文件（仅限必要的目录和文件）
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/css', express.static(path.join(__dirname, 'css')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/lyrics.html', (_req, res) => res.sendFile(path.join(__dirname, 'lyrics.html')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// ========== Auth 中间件 ==========
async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: '请先登录' });
    }
    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
        return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
    req.user = { id: user.id, email: user.email };
    next();
}

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

// 批量查询标签并附加到歌曲对象上（避免 N+1）
async function attachTags(songs) {
    if (!songs || songs.length === 0) return songs;
    const songIds = songs.map(s => s.id);

    const { data: stRows, error: stErr } = await supabase
        .from('song_tags')
        .select('song_id, tag_id')
        .in('song_id', songIds);

    if (stErr || !stRows || stRows.length === 0) {
        // 没有标签关联，给每首歌空数组
        return songs.map(s => ({ ...s, tags: [] }));
    }

    // 收集所有涉及的 tag_id
    const tagIds = [...new Set(stRows.map(r => r.tag_id))];

    const { data: tagRows } = await supabase
        .from('tags')
        .select('id, name')
        .in('id', tagIds);

    // 构建 tag_id → name 映射
    const tagMap = {};
    for (const t of (tagRows || [])) {
        tagMap[t.id] = t.name;
    }

    // 构建 song_id → [tagName, ...] 映射
    const songTagsMap = {};
    for (const st of stRows) {
        if (!songTagsMap[st.song_id]) songTagsMap[st.song_id] = [];
        if (tagMap[st.tag_id]) {
            songTagsMap[st.song_id].push(tagMap[st.tag_id]);
        }
    }

    return songs.map(s => ({ ...s, tags: songTagsMap[s.id] || [] }));
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

/** GET /api/songs — 查询歌曲（支持按标签、BV号筛选 + 可选返回数量） */
app.get('/api/songs', async (req, res) => {
    try {
        const tagName = (req.query.tag || '').trim();
        const bvid = (req.query.bvid || '').trim();
        const limit = Math.min(parseInt(req.query.limit) || 300, 300);

        let songIds = null;

        // 如果指定了标签，先查出对应的 song_id 列表
        if (tagName) {
            const { data: tagRow } = await supabase
                .from('tags')
                .select('id')
                .eq('name', tagName)
                .single();

            if (!tagRow) {
                return res.json([]);
            }

            const { data: stRows } = await supabase
                .from('song_tags')
                .select('song_id')
                .eq('tag_id', tagRow.id);

            songIds = (stRows || []).map(r => r.song_id);
            if (songIds.length === 0) {
                return res.json([]);
            }
        }

        // 构建查询
        let query = supabase
            .from('songs')
            .select('id,title,singer,bvid,page,start_seconds,end_seconds,duration_seconds,cover_url,bilibili_url')
            .limit(limit);

        // 按 bvid 筛选 → 按 page 排序
        if (bvid) {
            query = query.eq('bvid', bvid).order('page', { ascending: true });
        } else {
            query = query.order('id', { ascending: true });
        }

        // 如果有标签筛选，添加 in 过滤
        if (songIds) {
            query = query.in('id', songIds.slice(0, 300));
        }

        const { data, error } = await query;

        if (error) {
            console.error('[songs] Supabase error:', error.message);
            return res.status(500).json({ error: '获取歌曲列表失败' });
        }

        const songs = (data || []).map(formatSong).filter(Boolean);
        const withTags = req.query.withTags !== 'false';  // default true
        const result = withTags ? await attachTags(songs) : songs;

        res.json(result);
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

        const songs = (data || []).map(formatSong).filter(Boolean);
        const songsWithTags = await attachTags(songs);

        // 按歌名去重，同一歌名只保留第一条
        const seen = new Set();
        const deduped = songsWithTags.filter(s => {
            if (seen.has(s.title)) return false;
            seen.add(s.title);
            return true;
        });

        res.json({
            results: deduped,
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

/** GET /api/tags — 获取标签树（顶级标签 + 子标签 + 歌曲计数） */
app.get('/api/tags', async (_req, res) => {
    try {
        // 查询所有标签
        const { data: allTags, error: tagErr } = await supabase
            .from('tags')
            .select('id, name, color, parent_id, sort_order')
            .order('sort_order', { ascending: true });

        if (tagErr) {
            console.error('[tags]', tagErr.message);
            return res.status(500).json({ error: '获取标签失败' });
        }

        if (!allTags || allTags.length === 0) {
            return res.json({ tags: [] });
        }

        // 批量查询所有标签的歌曲数
        const { data: stRows } = await supabase
            .from('song_tags')
            .select('tag_id');

        const countMap = {};
        for (const row of (stRows || [])) {
            countMap[row.tag_id] = (countMap[row.tag_id] || 0) + 1;
        }

        // 分离顶级标签和子标签
        const topTags = allTags.filter(t => !t.parent_id);
        const childTags = allTags.filter(t => t.parent_id);

        // 构建结果
        const tags = topTags.map(t => {
            const entry = {
                id: t.id,
                name: t.name,
                color: t.color,
                song_count: countMap[t.id] || 0,
            };
            // 如果有子标签，附加 children
            const children = childTags.filter(c => c.parent_id === t.id);
            if (children.length > 0) {
                entry.children = children.map(c => ({
                    id: c.id,
                    name: c.name,
                    color: c.color,
                    song_count: countMap[c.id] || 0,
                }));
            }
            return entry;
        });

        res.json({ tags });
    } catch (err) {
        console.error('[tags]', err.message);
        res.status(500).json({ error: '获取标签失败' });
    }
});

/** GET /api/collections — 歌曲汇总树（一级分类 + 子标签 + 歌曲计数） */
app.get('/api/collections', async (_req, res) => {
    try {
        // 1. 查询所有一级分类
        const { data: cols, error: colErr } = await supabase
            .from('collections')
            .select('id, name, slug, sort_order')
            .order('sort_order', { ascending: true });

        if (colErr) {
            console.error('[collections]', colErr.message);
            return res.status(500).json({ error: '获取分类失败' });
        }

        if (!cols || cols.length === 0) {
            return res.json({ collections: [] });
        }

        // 2. 查询所有子标签
        const { data: items } = await supabase
            .from('collection_items')
            .select('id, collection_id, title, bvid, sort_order')
            .order('sort_order', { ascending: true });

        const allItems = items || [];

        // 3. 批量计算每个 bvid 的歌曲数（一次 GROUP BY 查询）
        const bvids = [...new Set(allItems.map(it => it.bvid).filter(Boolean))];
        let bvidCountMap = {};
        if (bvids.length > 0) {
            const { data: countRows } = await supabase
                .from('songs')
                .select('bvid')
                .in('bvid', bvids);

            for (const row of (countRows || [])) {
                bvidCountMap[row.bvid] = (bvidCountMap[row.bvid] || 0) + 1;
            }
        }

        // 4. 按 collection_id 分组 items，构建树
        const itemMap = {};
        for (const it of allItems) {
            if (!itemMap[it.collection_id]) itemMap[it.collection_id] = [];
            itemMap[it.collection_id].push(it);
        }

        const collections = cols.map(c => {
            const colItems = (itemMap[c.id] || []).map(it => ({
                id: it.id,
                title: it.title,
                bvid: it.bvid || null,
                song_count: it.bvid ? (bvidCountMap[it.bvid] || 0) : 0,
            }));
            const totalSongCount = colItems.reduce((sum, it) => sum + it.song_count, 0);
            return {
                id: c.id,
                name: c.name,
                slug: c.slug,
                song_count: totalSongCount,
                items: colItems,
            };
        });

        res.set('Cache-Control', 'private, max-age=300');
        res.json({ collections });
    } catch (err) {
        console.error('[collections]', err.message);
        res.status(500).json({ error: '获取分类失败' });
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

/** GET /api/lyrics/:songId — 获取歌曲 LRC 歌词 */
app.get('/api/lyrics/:songId', async (req, res) => {
    const songId = parseInt(req.params.songId);
    if (!songId || songId < 1) {
        return res.status(400).json({ error: '无效的歌曲 ID' });
    }

    try {
        const { data, error } = await supabase
            .from('songs')
            .select('id, title, singer, lrc_text')
            .eq('id', songId)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: '歌曲不存在' });
        }

        res.json({
            songId: data.id,
            title: data.title,
            singer: data.singer || '',
            lrc_text: data.lrc_text || null,
        });
    } catch (err) {
        console.error('[lyrics]', err.message);
        res.status(500).json({ error: '获取歌词失败' });
    }
});

// ========== Auth 端点 ==========

/** POST /api/auth/send-code — 发送邮箱验证码 */
app.post('/api/auth/send-code', async (req, res) => {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }

    try {
        // 60 秒内重复请求限制
        const { data: recent } = await supabaseAdmin
            .from('verification_codes')
            .select('created_at')
            .eq('email', email)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (recent) {
            const elapsed = Date.now() - new Date(recent.created_at).getTime();
            if (elapsed < 60000) {
                const waitSec = Math.ceil((60000 - elapsed) / 1000);
                return res.status(429).json({ error: `请 ${waitSec} 秒后再试` });
            }
        }

        // 生成 6 位验证码
        const code = String(Math.floor(100000 + Math.random() * 900000));

        // 存入数据库（2 分钟有效）
        const { error: insertErr } = await supabaseAdmin
            .from('verification_codes')
            .insert({
                email,
                code,
                expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
            });

        if (insertErr) {
            console.error('[send-code] insert error:', insertErr.message);
            return res.status(500).json({ error: '验证码生成失败' });
        }

        // 发送邮件
        await mailTransporter.sendMail({
            from: '"青春旋律" <lexiaode@163.com>',
            to: email,
            subject: '青春旋律 - 登录验证码',
            text: `您的验证码是：${code}\n\n有效期 2 分钟，请勿将验证码泄露给他人。\n\n—— 青春旋律音乐播放器`,
            html: `<div style="max-width:480px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;background:#0B0E0C;color:#EDF0EE;border-radius:12px">
                <h2 style="color:#4DB88D">🎵 青春旋律</h2>
                <p style="font-size:16px;margin:20px 0">您的登录验证码是：</p>
                <div style="background:#1C2320;padding:16px 24px;border-radius:8px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#4DB88D">${code}</div>
                <p style="font-size:13px;color:#9BA89F;margin-top:20px">有效期 2 分钟，请勿将验证码泄露给他人。</p>
                <hr style="border-color:rgba(255,255,255,0.05);margin:20px 0">
                <p style="font-size:12px;color:#5D6B62">—— 青春旋律音乐播放器</p>
            </div>`,
        });

        res.json({ ok: true });
    } catch (err) {
        console.error('[send-code]', err.message);
        res.status(500).json({ error: '发送失败，请稍后重试' });
    }
});

/** POST /api/auth/check-email — 邮箱优先登录：检查账号是否存在 */
app.post('/api/auth/check-email', async (req, res) => {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }

    try {
        const { data: profile } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('email', email)
            .single();

        res.json({ exists: !!profile });
    } catch (err) {
        console.error('[check-email]', err.message);
        res.status(500).json({ error: '查询失败' });
    }
});

/** POST /api/auth/login — 验证码登录 / 密码登录 */
app.post('/api/auth/login', async (req, res) => {
    const { email, code, password, mode } = req.body;

    if (!email) {
        return res.status(400).json({ error: '请输入邮箱' });
    }

    // ===== 注册模式：验证码 + 密码一次性完成注册 =====
    if (mode === 'register') {
        if (!code) return res.status(400).json({ error: '请输入验证码' });
        if (!password || password.length < 6) return res.status(400).json({ error: '密码长度至少 6 位' });

        try {
            // 1. 验证验证码
            const { data: vcRecord, error: vcError } = await supabaseAdmin
                .from('verification_codes')
                .select('*')
                .eq('email', email)
                .eq('code', code)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (vcError || !vcRecord) {
                return res.status(401).json({ error: '验证码错误' });
            }
            if (vcRecord.used) {
                return res.status(401).json({ error: '验证码已使用' });
            }
            const now = new Date();
            if (now > new Date(vcRecord.expires_at)) {
                return res.status(401).json({ error: '验证码已过期，请重新发送' });
            }

            await supabaseAdmin
                .from('verification_codes')
                .update({ used: true })
                .eq('id', vcRecord.id);

            // 2. 创建或恢复 Auth 用户
            let userId, username, avatarUrl;

            const { data: newAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
            });

            if (createErr && createErr.message && createErr.message.includes('already')) {
                // Auth 用户已存在（边缘情况）：更新密码 + 补建资料
                console.log('[login-register] auth user already exists, updating password...');
                const { data: existingAuth } = await supabaseAdmin.auth.admin.listUsers();
                const found = existingAuth?.users?.find(u => u.email === email);
                if (!found) {
                    return res.status(500).json({ error: '创建用户失败' });
                }
                userId = found.id;
                await supabaseAdmin.auth.admin.updateUserById(userId, {
                    password,
                    email_confirm: true,
                });

                const { data: existingProfile } = await supabaseAdmin
                    .from('users')
                    .select('id, username, avatar_url')
                    .eq('id', userId)
                    .single();

                if (existingProfile) {
                    username = existingProfile.username;
                    avatarUrl = existingProfile.avatar_url;
                } else {
                    username = email.split('@')[0];
                    avatarUrl = `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(username)}`;
                    await supabaseAdmin
                        .from('users')
                        .insert({ id: userId, username, email, avatar_url: avatarUrl });
                }
            } else if (createErr) {
                console.error('[login-register] create error:', createErr.message);
                return res.status(500).json({ error: '创建用户失败' });
            } else {
                // 新用户创建成功 → 插入 public.users 资料
                userId = newAuth.user.id;
                username = email.split('@')[0];
                avatarUrl = `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(username)}`;
                const { error: dbErr } = await supabaseAdmin
                    .from('users')
                    .insert({ id: userId, username, email, avatar_url: avatarUrl });

                if (dbErr) {
                    await supabaseAdmin.auth.admin.deleteUser(userId);
                    console.error('[login-register] profile error:', dbErr.message);
                    return res.status(500).json({ error: '创建用户资料失败' });
                }
            }

            // 3. 用真实密码登录获取 session
            const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (signInErr) {
                console.error('[login-register] signin error:', signInErr.message);
                return res.status(500).json({ error: '登录失败，请重试' });
            }

            return res.json({
                user: { id: userId, email, username, avatar_url: avatarUrl || null },
                session: {
                    access_token: signInData.session.access_token,
                    refresh_token: signInData.session.refresh_token,
                    expires_at: signInData.session.expires_at,
                },
                is_new_user: true,
            });
        } catch (err) {
            console.error('[login-register]', err.message);
            return res.status(500).json({ error: '注册失败' });
        }
    }

    // ===== 密码登录 =====
    if (password) {
        if (password.length < 6) {
            return res.status(400).json({ error: '密码长度至少 6 位' });
        }
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) {
                if (error.message.includes('Invalid login credentials')) {
                    return res.status(401).json({ error: '邮箱或密码错误' });
                }
                console.error('[login-password]', error.message);
                return res.status(500).json({ error: '登录失败，请稍后重试' });
            }

            // 查找用户资料
            const { data: profile } = await supabaseAdmin
                .from('users')
                .select('id, username, avatar_url')
                .eq('id', data.user.id)
                .single();

            return res.json({
                user: {
                    id: data.user.id,
                    email,
                    username: profile ? profile.username : email.split('@')[0],
                    avatar_url: profile ? profile.avatar_url : null,
                },
                session: {
                    access_token: data.session.access_token,
                    refresh_token: data.session.refresh_token,
                    expires_at: data.session.expires_at,
                },
                is_new_user: false,
            });
        } catch (err) {
            console.error('[login-password]', err.message);
            return res.status(500).json({ error: '登录失败' });
        }
    }

    // ===== 验证码登录 =====
    if (!code) {
        return res.status(400).json({ error: '请输入验证码或密码' });
    }

    try {
        // 1. 查找验证码（不限制过期时间，方便区分错误类型）
        const { data: vcRecord, error: vcError } = await supabaseAdmin
            .from('verification_codes')
            .select('*')
            .eq('email', email)
            .eq('code', code)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (vcError || !vcRecord) {
            return res.status(401).json({ error: '验证码错误' });
        }

        if (vcRecord.used) {
            return res.status(401).json({ error: '验证码已使用' });
        }

        const now = new Date();
        const expiresAt = new Date(vcRecord.expires_at);
        if (now > expiresAt) {
            console.log('[login] code expired:', {
                email,
                expires_at: vcRecord.expires_at,
                now: now.toISOString(),
                age_seconds: Math.round((now - new Date(vcRecord.created_at)) / 1000),
            });
            return res.status(401).json({ error: '验证码已过期，请重新发送' });
        }

        // 2. 标记验证码已使用
        await supabaseAdmin
            .from('verification_codes')
            .update({ used: true })
            .eq('id', vcRecord.id);

        // 3. 完成登录（查找或创建用户 + 签发 session）
        await completeLogin(email, res);
    } catch (err) {
        console.error('[login]', err.message);
        res.status(500).json({ error: '登录失败' });
    }
});

/** 签发 session token（access + refresh） */
function issueSession(userId, email) {
    const now = Math.floor(Date.now() / 1000);
    const access_token = signJWT({
        sub: userId,
        email,
        role: 'authenticated',
        aud: 'authenticated',
        iss: 'supabase',
        iat: now,
        exp: now + 3600,          // 1 小时
    });
    const refresh_token = signJWT({
        sub: userId,
        email,
        role: 'authenticated',
        aud: 'authenticated',
        iss: 'supabase',
        iat: now,
        exp: now + 86400 * 7,     // 7 天
    });
    return { access_token, refresh_token, expires_at: now + 3600 };
}

/** 共享函数：给定 email，查找或创建用户，签出 session 返回给前端 */
async function completeLogin(email, res) {
    // 检查 public.users 是否存在
    const { data: existingProfile } = await supabaseAdmin
        .from('users')
        .select('id, username, avatar_url')
        .eq('email', email)
        .single();

    // ---------- 已有用户：不修改密码，直接签发自定义 JWT ----------
    if (existingProfile) {
        const session = issueSession(existingProfile.id, email);
        return res.json({
            user: {
                id: existingProfile.id,
                email,
                username: existingProfile.username,
                avatar_url: existingProfile.avatar_url || null,
            },
            session,
            is_new_user: false,
        });
    }

    // ---------- 新用户：创建 Auth 用户 + public.users 资料 ----------
    const tempPass = 'temp_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    let userId, username, avatarUrl;

    const { data: newAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPass,
        email_confirm: true,
    });

    if (createErr) {
        // Auth 中已存在但 public.users 中没有（边缘情况）：直接用自定义 JWT
        if (createErr.message && createErr.message.includes('already')) {
            console.log('[login] auth user already exists (no profile), looking up...');
            const { data: existingAuth } = await supabaseAdmin.auth.admin.listUsers();
            const found = existingAuth?.users?.find(u => u.email === email);
            if (found) {
                userId = found.id;
                username = email.split('@')[0];
                avatarUrl = `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(username)}`;
                // 补建 public.users 资料
                await supabaseAdmin
                    .from('users')
                    .insert({ id: userId, username, email, avatar_url: avatarUrl });
                const session = issueSession(userId, email);
                return res.json({
                    user: { id: userId, email, username, avatar_url: avatarUrl || null },
                    session,
                    is_new_user: true,
                });
            }
            console.error('[login] create auth user error:', createErr.message);
            return res.status(500).json({ error: '创建用户失败' });
        }
        console.error('[login] create auth user error:', createErr.message);
        return res.status(500).json({ error: '创建用户失败' });
    }

    // 新用户创建成功：插入 public.users 资料 + 用临时密码登录获取 session
    userId = newAuth.user.id;
    username = email.split('@')[0];
    avatarUrl = `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(username)}`;
    const { error: dbErr } = await supabaseAdmin
        .from('users')
        .insert({ id: userId, username, email, avatar_url: avatarUrl });

    if (dbErr) {
        await supabaseAdmin.auth.admin.deleteUser(userId);
        console.error('[login] create profile error:', dbErr.message);
        return res.status(500).json({ error: '创建用户资料失败' });
    }

    // 用临时密码登录获取 session（最多重试 3 次，应对 Supabase 密码同步延迟）
    let signInData, signInErr;
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await supabase.auth.signInWithPassword({
            email,
            password: tempPass,
        });
        signInData = result.data;
        signInErr = result.error;
        if (!signInErr) break;
        if (attempt < 2) {
            console.log(`[login] signin retry ${attempt + 1}/3:`, signInErr.message);
            await new Promise(r => setTimeout(r, 800));
        }
    }

    if (signInErr) {
        console.error('[login] signin error:', signInErr.message);
        return res.status(500).json({ error: '登录失败，请重试' });
    }

    res.json({
        user: { id: userId, email, username, avatar_url: avatarUrl || null },
        session: {
            access_token: signInData.session.access_token,
            refresh_token: signInData.session.refresh_token,
            expires_at: signInData.session.expires_at,
        },
        is_new_user: true,
    });
}

/** POST /api/auth/set-password — 设置/修改密码（首次注册或忘记密码后） */
app.post('/api/auth/set-password', authMiddleware, async (req, res) => {
    const { password } = req.body;

    if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: '请输入密码' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: '密码长度至少 6 位' });
    }
    if (password.length > 72) {
        return res.status(400).json({ error: '密码长度不能超过 72 位' });
    }

    try {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
            password,
            email_confirm: true,
        });

        if (error) {
            console.error('[set-password]', error.message);
            return res.status(500).json({ error: '设置密码失败' });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[set-password]', err.message);
        res.status(500).json({ error: '设置密码失败' });
    }
});

/** POST /api/auth/logout — 登出 */
app.post('/api/auth/logout', authMiddleware, async (req, res) => {
    // JWT 是无状态的，真正的"登出"由前端清除 localStorage 完成
    res.json({ ok: true });
});

/** GET /api/auth/me — 获取当前用户信息 */
app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        const { data: profile, error } = await supabaseAdmin
            .from('users')
            .select('username, avatar_url')
            .eq('id', req.user.id)
            .single();

        if (error) {
            return res.status(404).json({ error: '用户不存在' });
        }

        res.json({
            user: {
                id: req.user.id,
                email: req.user.email,
                username: profile.username,
                avatar_url: profile.avatar_url || null,
            },
        });
    } catch (err) {
        console.error('[me]', err.message);
        res.status(500).json({ error: '获取用户信息失败' });
    }
});

/** PATCH /api/auth/profile — 修改用户名 */
app.patch('/api/auth/profile', authMiddleware, async (req, res) => {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
        return res.status(400).json({ error: '请输入用户名' });
    }
    const trimmed = username.trim();
    if (trimmed.length < 1 || trimmed.length > 30) {
        return res.status(400).json({ error: '用户名长度 1-30 个字符' });
    }
    if (!/^[\w一-鿿぀-ゟ゠-ヿ가-힯\-_\s]+$/.test(trimmed)) {
        return res.status(400).json({ error: '用户名包含无效字符' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('users')
            .update({ username: trimmed })
            .eq('id', req.user.id)
            .select('username, avatar_url')
            .single();

        if (error) {
            if (error.message.includes('duplicate key')) {
                return res.status(409).json({ error: '用户名已被占用' });
            }
            console.error('[profile] update error:', error.message);
            return res.status(500).json({ error: '修改失败' });
        }

        res.json({
            user: {
                id: req.user.id,
                email: req.user.email,
                username: data.username,
                avatar_url: data.avatar_url || null,
            },
        });
    } catch (err) {
        console.error('[profile]', err.message);
        res.status(500).json({ error: '修改失败' });
    }
});

/** POST /api/auth/avatar — 上传头像（base64） */
app.post('/api/auth/avatar', authMiddleware, async (req, res) => {
    const { avatar_base64 } = req.body;

    if (!avatar_base64 || typeof avatar_base64 !== 'string') {
        return res.status(400).json({ error: '请提供头像图片' });
    }

    // 解析 base64 data URL
    const m = avatar_base64.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
    if (!m) {
        return res.status(400).json({ error: '图片格式不支持，请使用 PNG/JPEG/WebP' });
    }
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const buf = Buffer.from(m[2], 'base64');

    // 限制 2MB
    if (buf.length > 2 * 1024 * 1024) {
        return res.status(400).json({ error: '图片大小不能超过 2MB' });
    }

    try {
        const filePath = `${req.user.id}/avatar.${ext}`;

        // 上传到 Supabase Storage（覆盖）
        const { error: uploadErr } = await supabaseAdmin
            .storage
            .from('avatars')
            .upload(filePath, buf, {
                contentType: `image/${ext}`,
                upsert: true,
            });

        if (uploadErr) {
            console.error('[avatar] upload error:', uploadErr.message);
            return res.status(500).json({ error: '头像上传失败' });
        }

        // 获取公开 URL
        const { data: urlData } = supabaseAdmin
            .storage
            .from('avatars')
            .getPublicUrl(filePath);

        const avatarUrl = urlData.publicUrl;

        // 更新 public.users
        const { error: updateErr } = await supabaseAdmin
            .from('users')
            .update({ avatar_url: avatarUrl })
            .eq('id', req.user.id);

        if (updateErr) {
            console.error('[avatar] update error:', updateErr.message);
            return res.status(500).json({ error: '头像信息保存失败' });
        }

        res.json({ avatar_url: avatarUrl });
    } catch (err) {
        console.error('[avatar]', err.message);
        res.status(500).json({ error: '头像上传失败' });
    }
});

// ========== 收藏端点 ==========

/** GET /api/favorites — 获取用户收藏列表（含歌曲详情） */
app.get('/api/favorites', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('favorites')
            .select('song_id, created_at, songs(id, title, singer, bvid, page, start_seconds, end_seconds, duration_seconds, cover_url, bilibili_url)')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[favorites]', error.message);
            return res.status(500).json({ error: '获取收藏列表失败' });
        }

        // 展平结果: 从 { song_id, songs: {...} } 提取为歌曲数组
        const songs = (data || [])
            .map(row => row.songs)
            .filter(Boolean)
            .map(formatSong)
            .filter(Boolean);

        res.json(songs);
    } catch (err) {
        console.error('[favorites]', err.message);
        res.status(500).json({ error: '获取收藏列表失败' });
    }
});

/** POST /api/favorites/:songId — 添加收藏 */
app.post('/api/favorites/:songId', authMiddleware, async (req, res) => {
    const songId = parseInt(req.params.songId);
    if (!songId || songId < 1) {
        return res.status(400).json({ error: '无效的歌曲 ID' });
    }

    try {
        // 检查歌曲是否存在
        const { data: song } = await supabaseAdmin
            .from('songs')
            .select('id')
            .eq('id', songId)
            .single();

        if (!song) {
            return res.status(404).json({ error: '歌曲不存在' });
        }

        const { error } = await supabaseAdmin
            .from('favorites')
            .upsert({ user_id: req.user.id, song_id: songId }, { onConflict: 'user_id,song_id' });

        if (error) {
            console.error('[favorites add]', error.message);
            return res.status(500).json({ error: '收藏失败' });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[favorites add]', err.message);
        res.status(500).json({ error: '收藏失败' });
    }
});

/** DELETE /api/favorites/:songId — 取消收藏 */
app.delete('/api/favorites/:songId', authMiddleware, async (req, res) => {
    const songId = parseInt(req.params.songId);

    try {
        const { error } = await supabaseAdmin
            .from('favorites')
            .delete()
            .eq('user_id', req.user.id)
            .eq('song_id', songId);

        if (error) {
            console.error('[favorites remove]', error.message);
            return res.status(500).json({ error: '取消收藏失败' });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[favorites remove]', err.message);
        res.status(500).json({ error: '取消收藏失败' });
    }
});

// ========== 歌单端点 ==========

/** GET /api/playlists — 获取用户歌单列表 */
app.get('/api/playlists', authMiddleware, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('playlists')
            .select('id, name, description, cover_url, is_public, created_at')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[playlists]', error.message);
            return res.status(500).json({ error: '获取歌单列表失败' });
        }

        const pls = data || [];

        // 单次批量查询所有歌单的歌曲数量（避免 N+1）
        let countMap = {};
        if (pls.length > 0) {
            const plIds = pls.map(pl => pl.id);
            const { data: songRows, error: countErr } = await supabaseAdmin
                .from('playlist_songs')
                .select('playlist_id')
                .in('playlist_id', plIds);

            if (!countErr && songRows) {
                for (const row of songRows) {
                    countMap[row.playlist_id] = (countMap[row.playlist_id] || 0) + 1;
                }
            }
        }

        const playlists = pls.map(pl => ({
            ...pl,
            song_count: countMap[pl.id] || 0,
        }));

        res.json(playlists);
    } catch (err) {
        console.error('[playlists]', err.message);
        res.status(500).json({ error: '获取歌单列表失败' });
    }
});

/** POST /api/playlists — 创建歌单 */
app.post('/api/playlists', authMiddleware, async (req, res) => {
    const name = (req.body.name || '').trim();
    if (!name || name.length > 30) {
        return res.status(400).json({ error: '歌单名称无效（1-30个字符）' });
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('playlists')
            .insert({ user_id: req.user.id, name })
            .select('id, name, description, cover_url, is_public, created_at')
            .single();

        if (error) {
            if (error.message.includes('duplicate key')) {
                return res.status(409).json({ error: '已存在同名歌单' });
            }
            console.error('[playlists create]', error.message);
            return res.status(500).json({ error: '创建歌单失败' });
        }

        res.json({ ...data, song_count: 0 });
    } catch (err) {
        console.error('[playlists create]', err.message);
        res.status(500).json({ error: '创建歌单失败' });
    }
});

/** DELETE /api/playlists/:id — 删除歌单 */
app.delete('/api/playlists/:id', authMiddleware, async (req, res) => {
    const plId = parseInt(req.params.id);

    try {
        // 验证歌单属于当前用户
        const { data: pl } = await supabaseAdmin
            .from('playlists')
            .select('id, user_id')
            .eq('id', plId)
            .single();

        if (!pl) {
            return res.status(404).json({ error: '歌单不存在' });
        }
        if (pl.user_id !== req.user.id) {
            return res.status(403).json({ error: '无权删除此歌单' });
        }

        const { error } = await supabaseAdmin
            .from('playlists')
            .delete()
            .eq('id', plId);

        if (error) {
            console.error('[playlists delete]', error.message);
            return res.status(500).json({ error: '删除歌单失败' });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[playlists delete]', err.message);
        res.status(500).json({ error: '删除歌单失败' });
    }
});

/** PATCH /api/playlists/:id — 重命名歌单 */
app.patch('/api/playlists/:id', authMiddleware, async (req, res) => {
    const plId = parseInt(req.params.id);
    const name = (req.body.name || '').trim();

    if (!name || name.length > 100) {
        return res.status(400).json({ error: '歌单名称无效（1-100个字符）' });
    }

    try {
        // 验证歌单属于当前用户
        const { data: pl } = await supabaseAdmin
            .from('playlists')
            .select('id, user_id')
            .eq('id', plId)
            .single();

        if (!pl) {
            return res.status(404).json({ error: '歌单不存在' });
        }
        if (pl.user_id !== req.user.id) {
            return res.status(403).json({ error: '无权操作此歌单' });
        }

        // 检查同一用户下是否已有同名歌单
        const { data: dup } = await supabaseAdmin
            .from('playlists')
            .select('id')
            .eq('user_id', req.user.id)
            .eq('name', name)
            .neq('id', plId)
            .limit(1);

        if (dup && dup.length > 0) {
            return res.status(409).json({ error: '已存在同名歌单' });
        }

        const { data, error } = await supabaseAdmin
            .from('playlists')
            .update({ name, updated_at: new Date().toISOString() })
            .eq('id', plId)
            .select('id, name, updated_at')
            .single();

        if (error) {
            console.error('[playlists rename]', error.message);
            return res.status(500).json({ error: '重命名失败' });
        }

        res.json(data);
    } catch (err) {
        console.error('[playlists rename]', err.message);
        res.status(500).json({ error: '重命名失败' });
    }
});

/** GET /api/playlists/:id/songs — 获取歌单内歌曲 */
app.get('/api/playlists/:id/songs', authMiddleware, async (req, res) => {
    const plId = parseInt(req.params.id);

    try {
        // 验证歌单所有权
        const { data: pl } = await supabaseAdmin
            .from('playlists')
            .select('id, user_id')
            .eq('id', plId)
            .single();

        if (!pl) {
            return res.status(404).json({ error: '歌单不存在' });
        }
        if (pl.user_id !== req.user.id) {
            return res.status(403).json({ error: '无权查看此歌单' });
        }

        const { data, error } = await supabaseAdmin
            .from('playlist_songs')
            .select('sort_order, songs(id, title, singer, bvid, page, start_seconds, end_seconds, duration_seconds, cover_url, bilibili_url)')
            .eq('playlist_id', plId)
            .order('sort_order', { ascending: true });

        if (error) {
            console.error('[playlist songs]', error.message);
            return res.status(500).json({ error: '获取歌单歌曲失败' });
        }

        const songs = (data || [])
            .map(row => row.songs)
            .filter(Boolean)
            .map(formatSong)
            .filter(Boolean);

        res.json(songs);
    } catch (err) {
        console.error('[playlist songs]', err.message);
        res.status(500).json({ error: '获取歌单歌曲失败' });
    }
});

/** POST /api/playlists/:id/songs — 添加歌曲到歌单 */
app.post('/api/playlists/:id/songs', authMiddleware, async (req, res) => {
    const plId = parseInt(req.params.id);
    const songId = parseInt(req.body.song_id);

    if (!songId) {
        return res.status(400).json({ error: '缺少 song_id' });
    }

    try {
        // 验证歌单所有权
        const { data: pl } = await supabaseAdmin
            .from('playlists')
            .select('id, user_id')
            .eq('id', plId)
            .single();

        if (!pl) {
            return res.status(404).json({ error: '歌单不存在' });
        }
        if (pl.user_id !== req.user.id) {
            return res.status(403).json({ error: '无权操作此歌单' });
        }

        // 获取当前最大 sort_order
        const { data: lastItem } = await supabaseAdmin
            .from('playlist_songs')
            .select('sort_order')
            .eq('playlist_id', plId)
            .order('sort_order', { ascending: false })
            .limit(1);

        const nextOrder = (lastItem && lastItem.length > 0) ? lastItem[0].sort_order + 1 : 0;

        const { error } = await supabaseAdmin
            .from('playlist_songs')
            .upsert(
                { playlist_id: plId, song_id: songId, sort_order: nextOrder },
                { onConflict: 'playlist_id,song_id' }
            );

        if (error) {
            console.error('[playlist add song]', error.message);
            return res.status(500).json({ error: '添加歌曲失败' });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[playlist add song]', err.message);
        res.status(500).json({ error: '添加歌曲失败' });
    }
});

/** DELETE /api/playlists/:id/songs/:songId — 从歌单移除歌曲 */
app.delete('/api/playlists/:id/songs/:songId', authMiddleware, async (req, res) => {
    const plId = parseInt(req.params.id);
    const songId = parseInt(req.params.songId);

    try {
        // 验证歌单所有权
        const { data: pl } = await supabaseAdmin
            .from('playlists')
            .select('id, user_id')
            .eq('id', plId)
            .single();

        if (!pl) {
            return res.status(404).json({ error: '歌单不存在' });
        }
        if (pl.user_id !== req.user.id) {
            return res.status(403).json({ error: '无权操作此歌单' });
        }

        const { error } = await supabaseAdmin
            .from('playlist_songs')
            .delete()
            .eq('playlist_id', plId)
            .eq('song_id', songId);

        if (error) {
            console.error('[playlist remove song]', error.message);
            return res.status(500).json({ error: '移除歌曲失败' });
        }

        res.json({ ok: true });
    } catch (err) {
        console.error('[playlist remove song]', err.message);
        res.status(500).json({ error: '移除歌曲失败' });
    }
});

// ========== 意见反馈 ==========

/** POST /api/feedback — 用户意见反馈（无需登录） */
app.post('/api/feedback', async (req, res) => {
    const { content, contact } = req.body;

    if (!content || typeof content !== 'string' || content.trim().length < 2) {
        return res.status(400).json({ error: '请输入至少 2 个字符的反馈内容' });
    }
    if (content.length > 2000) {
        return res.status(400).json({ error: '反馈内容不能超过 2000 字' });
    }

    try {
        const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        const contactInfo = contact ? `\n联系方式：${contact}` : '';

        await mailTransporter.sendMail({
            from: '"青春旋律反馈" <lexiaode@163.com>',
            to: 'lexiaode@163.com',
            subject: `[青春旋律反馈] 来自用户的意见 (${timeStr})`,
            text: `反馈时间：${timeStr}\n\n反馈内容：\n${content.trim()}${contactInfo}\n\n—— 青春旋律音乐播放器`,
            html: `<div style="max-width:480px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;background:#0B0E0C;color:#EDF0EE;border-radius:12px">
                <h2 style="color:#4DB88D">💬 用户反馈</h2>
                <p style="font-size:12px;color:#5D6B62">反馈时间：${timeStr}</p>
                <div style="background:#1C2320;padding:16px;border-radius:8px;margin:16px 0;font-size:15px;line-height:1.6;white-space:pre-wrap">${content.trim()}</div>
                ${contact ? `<p style="font-size:13px;color:#9BA89F">联系方式：${contact}</p>` : ''}
                <hr style="border-color:rgba(255,255,255,0.05);margin:20px 0">
                <p style="font-size:12px;color:#5D6B62">—— 青春旋律音乐播放器</p>
            </div>`,
        });

        res.json({ ok: true });
    } catch (err) {
        console.error('[feedback]', err.message);
        res.status(500).json({ error: '发送失败，请稍后重试' });
    }
});

app.listen(PORT, () => {
    console.log(`🎵 音乐播放器后端已启动 → http://localhost:${PORT}`);
    console.log(`   歌曲列表: http://localhost:${PORT}/api/songs`);
    console.log(`   搜索接口: http://localhost:${PORT}/api/search?q=离别`);
    console.log(`   前端页面: http://localhost:${PORT}`);
});
