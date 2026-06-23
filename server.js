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
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
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

/** GET /api/songs — 查询歌曲（支持按标签筛选 + 可选返回数量） */
app.get('/api/songs', async (req, res) => {
    try {
        const tagName = (req.query.tag || '').trim();
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);

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
            .order('id', { ascending: true })
            .limit(limit);

        // 如果有标签筛选，添加 in 过滤
        if (songIds) {
            // Supabase 的 `.in()` 最多 300 个值，这里分批处理
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

        res.json({
            results: songsWithTags,
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

/** POST /api/auth/signup — 邮箱注册 */
app.post('/api/auth/signup', async (req, res) => {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
        return res.status(400).json({ error: '请填写所有字段' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: '密码至少需要6位' });
    }
    if (username.length > 30) {
        return res.status(400).json({ error: '用户名最多30个字符' });
    }

    try {
        // 1. 在 Supabase Auth 创建用户（admin API 自动确认邮箱）
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
        });

        if (authError) {
            if (authError.message.includes('already been registered')) {
                return res.status(409).json({ error: '该邮箱已注册' });
            }
            console.error('[signup] auth error:', authError.message);
            return res.status(400).json({ error: '注册失败: ' + authError.message });
        }

        const userId = authData.user.id;

        // 2. 在 public.users 中插入用户资料
        const { error: dbError } = await supabaseAdmin
            .from('users')
            .insert({ id: userId, username, email });

        if (dbError) {
            // 回滚: 删除 auth 用户
            await supabaseAdmin.auth.admin.deleteUser(userId);
            if (dbError.message.includes('duplicate key')) {
                return res.status(409).json({ error: '用户名已存在' });
            }
            console.error('[signup] db error:', dbError.message);
            return res.status(400).json({ error: '注册失败: ' + dbError.message });
        }

        // 3. 登录获取 session
        const { data: sessionData, error: signInError } = await supabase.auth.signInWithPassword({
            email, password,
        });

        if (signInError) {
            console.error('[signup] signin error:', signInError.message);
            return res.status(400).json({ error: '注册成功但登录失败，请手动登录' });
        }

        res.json({
            user: { id: userId, email, username },
            session: {
                access_token: sessionData.session.access_token,
                refresh_token: sessionData.session.refresh_token,
                expires_at: sessionData.session.expires_at,
            },
        });
    } catch (err) {
        console.error('[signup]', err.message);
        res.status(500).json({ error: '注册失败' });
    }
});

/** POST /api/auth/login — 邮箱登录 */
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: '请输入邮箱和密码' });
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
            return res.status(401).json({ error: '邮箱或密码错误' });
        }

        // 从 public.users 获取用户名
        const { data: profile } = await supabaseAdmin
            .from('users')
            .select('username')
            .eq('id', data.user.id)
            .single();

        res.json({
            user: {
                id: data.user.id,
                email: data.user.email,
                username: profile ? profile.username : email.split('@')[0],
            },
            session: {
                access_token: data.session.access_token,
                refresh_token: data.session.refresh_token,
                expires_at: data.session.expires_at,
            },
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
            .select('username')
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
