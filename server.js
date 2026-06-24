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

// ========== Nodemailer 邮件服务 ==========
const nodemailer = require('nodemailer');
const mailTransporter = nodemailer.createTransport({
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    auth: {
        user: 'lexiaode@163.com',
        pass: process.env.EMAIL_SMTP_PASS || '',
    },
});

// 启动时验证邮件配置
mailTransporter.verify((err) => {
    if (err) console.error('[mail] SMTP 配置错误:', err.message);
    else console.log('[mail] SMTP 就绪 (lexiaode@163.com)');
});

const app = express();
app.use(express.json());   // 解析 POST JSON body
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

// 提供静态文件（index.html, css, js）
app.use(express.static(__dirname));

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
        const songsWithTags = await attachTags(songs);

        res.json(songsWithTags);
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

        // 存入数据库（5 分钟有效）
        const { error: insertErr } = await supabaseAdmin
            .from('verification_codes')
            .insert({
                email,
                code,
                expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
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
            text: `您的验证码是：${code}\n\n有效期 5 分钟，请勿将验证码泄露给他人。\n\n—— 青春旋律音乐播放器`,
            html: `<div style="max-width:480px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;background:#0B0E0C;color:#EDF0EE;border-radius:12px">
                <h2 style="color:#4DB88D">🎵 青春旋律</h2>
                <p style="font-size:16px;margin:20px 0">您的登录验证码是：</p>
                <div style="background:#1C2320;padding:16px 24px;border-radius:8px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#4DB88D">${code}</div>
                <p style="font-size:13px;color:#9BA89F;margin-top:20px">有效期 5 分钟，请勿将验证码泄露给他人。</p>
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

/** POST /api/auth/login — 邮箱验证码登录（新用户自动注册） */
app.post('/api/auth/login', async (req, res) => {
    const { email, code } = req.body;

    if (!email || !code) {
        return res.status(400).json({ error: '请输入邮箱和验证码' });
    }

    try {
        // 1. 查找有效验证码
        const { data: vcRecord, error: vcError } = await supabaseAdmin
            .from('verification_codes')
            .select('*')
            .eq('email', email)
            .eq('code', code)
            .eq('used', false)
            .gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (vcError || !vcRecord) {
            return res.status(401).json({ error: '验证码错误或已过期' });
        }

        // 2. 标记验证码已使用
        await supabaseAdmin
            .from('verification_codes')
            .update({ used: true })
            .eq('id', vcRecord.id);

        // 3. 检查 public.users 是否存在
        const { data: existingProfile } = await supabaseAdmin
            .from('users')
            .select('id, username, avatar_url')
            .eq('email', email)
            .single();

        const tempPass = 'temp_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        let userId, username, avatarUrl;
        let isNewUser = false;

        if (existingProfile) {
            // 已有用户：重置密码后登录
            userId = existingProfile.id;
            username = existingProfile.username;
            avatarUrl = existingProfile.avatar_url;
            await supabaseAdmin.auth.admin.updateUserById(userId, {
                password: tempPass,
                email_confirm: true,
            });
        } else {
            // 新用户：在 Supabase Auth 创建 + public.users 插入
            isNewUser = true;
            const { data: newAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
                email,
                password: tempPass,
                email_confirm: true,
            });

            if (createErr) {
                console.error('[login] create auth user error:', createErr.message);
                return res.status(500).json({ error: '创建用户失败' });
            }

            userId = newAuth.user.id;
            username = email.split('@')[0];

            const { error: dbErr } = await supabaseAdmin
                .from('users')
                .insert({ id: userId, username, email });

            if (dbErr) {
                // 回滚 auth 用户
                await supabaseAdmin.auth.admin.deleteUser(userId);
                console.error('[login] create profile error:', dbErr.message);
                return res.status(500).json({ error: '创建用户资料失败' });
            }
        }

        // 4. 用临时密码登录获取 session
        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
            email,
            password: tempPass,
        });

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
            is_new_user: isNewUser,
        });
    } catch (err) {
        console.error('[login]', err.message);
        res.status(500).json({ error: '登录失败' });
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

app.listen(PORT, () => {
    console.log(`🎵 音乐播放器后端已启动 → http://localhost:${PORT}`);
    console.log(`   歌曲列表: http://localhost:${PORT}/api/songs`);
    console.log(`   搜索接口: http://localhost:${PORT}/api/search?q=离别`);
    console.log(`   前端页面: http://localhost:${PORT}`);
});
