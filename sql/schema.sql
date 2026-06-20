-- ============================================================================
-- 🎵 青春旋律音乐播放器 — Supabase/PostgreSQL 数据库建表语句
-- ============================================================================
-- 使用方法：
--   1. 打开 Supabase Dashboard → SQL Editor
--   2. 粘贴本文件全部内容
--   3. 点击 Run 执行
-- ============================================================================

-- ============================================================================
-- 1. users（用户表）
-- ============================================================================
-- 存储用户基本信息，与 Supabase Auth (auth.users) 通过 id 关联。
-- Supabase Auth 自动管理 auth.users，本表用于扩展存储用户资料。
-- ============================================================================
CREATE TABLE users (
    id          UUID        PRIMARY KEY,              -- 与 auth.users.id 保持一致
    username    TEXT        NOT NULL UNIQUE,          -- 用户名（唯一）
    email       TEXT        NOT NULL UNIQUE,          -- 邮箱（唯一，与 auth.users.email 同步）
    avatar_url  TEXT        DEFAULT NULL,             -- 头像图片地址
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()    -- 注册时间
);

-- 索引：按邮箱查找用户（登录验证）
CREATE INDEX idx_users_email ON users (email);

-- 索引：按用户名查找用户（搜索）
CREATE INDEX idx_users_username ON users (username);

COMMENT ON TABLE users IS '用户表 — 存储用户资料，与 Supabase Auth 的 auth.users 关联';
COMMENT ON COLUMN users.id IS '主键，与 auth.users.id 保持一致';
COMMENT ON COLUMN users.username IS '用户名（唯一）';
COMMENT ON COLUMN users.email IS '邮箱（唯一）';
COMMENT ON COLUMN users.avatar_url IS '头像图片 URL';
COMMENT ON COLUMN users.created_at IS '注册时间';


-- ============================================================================
-- 2. songs（歌曲表）
-- ============================================================================
-- 存储歌曲元数据。bvid / page 字段用于 B站 DASH API 流媒体代理。
-- 非 B站 来源的歌曲可留空。
-- ============================================================================
CREATE TABLE songs (
    id               SERIAL       PRIMARY KEY,           -- 自增主键（数字 ID，与前端兼容）
    title            TEXT         NOT NULL,               -- 歌曲名称
    singer           TEXT         DEFAULT NULL,           -- 歌手名称
    bilibili_url     TEXT         DEFAULT NULL,           -- B站视频完整链接
    bvid             TEXT         DEFAULT NULL,           -- B站视频 BV 号（用于 API 调用）
    page             INTEGER      DEFAULT NULL,           -- B站多 P 视频的分 P 编号（从 1 开始）
    start_seconds    DOUBLE PRECISION DEFAULT NULL,       -- 歌曲片段起始时间（秒），NULL 表示从头开始
    end_seconds      DOUBLE PRECISION DEFAULT NULL,       -- 歌曲片段结束时间（秒），NULL 表示播放到结尾
    cover_url        TEXT         DEFAULT NULL,           -- 封面图片地址
    duration_seconds DOUBLE PRECISION DEFAULT NULL,       -- 歌曲时长（秒），优先取 end_seconds - start_seconds，其次取 page_duration
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()  -- 收录时间
);

-- 索引：按歌名搜索
CREATE INDEX idx_songs_title ON songs (title);

-- 索引：按 BV 号查找（流媒体代理需要）
CREATE INDEX idx_songs_bvid ON songs (bvid);

COMMENT ON TABLE songs IS '歌曲表 — 存储 B站 及其他来源的歌曲元数据';
COMMENT ON COLUMN songs.id IS '自增主键，数字 ID（保持与前端兼容）';
COMMENT ON COLUMN songs.title IS '歌曲名称';
COMMENT ON COLUMN songs.singer IS '歌手名称';
COMMENT ON COLUMN songs.bilibili_url IS 'B站视频完整链接，如 https://www.bilibili.com/video/BV1pY5q6jECZ/?p=1';
COMMENT ON COLUMN songs.bvid IS 'B站视频 BV 号，用于构造 DASH API 请求';
COMMENT ON COLUMN songs.page IS 'B站多 P 视频的分 P 编号（从 1 开始），用于构造 DASH API 请求';
COMMENT ON COLUMN songs.start_seconds IS '歌曲片段在视频中的起始秒数，NULL = 从头播放';
COMMENT ON COLUMN songs.end_seconds IS '歌曲片段在视频中的结束秒数，NULL = 播放到结尾';
COMMENT ON COLUMN songs.cover_url IS '歌曲封面图片 URL';
COMMENT ON COLUMN songs.duration_seconds IS '歌曲可播放时长（秒）';
COMMENT ON COLUMN songs.created_at IS '歌曲收录时间';


-- ============================================================================
-- 3. favorites（收藏表）
-- ============================================================================
-- 用户收藏歌曲的关联表。
-- 一个用户可以收藏多首歌曲，一首歌曲可以被多个用户收藏（多对多）。
-- ============================================================================
CREATE TABLE favorites (
    id         SERIAL       PRIMARY KEY,              -- 自增主键
    user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 用户
    song_id    INTEGER      NOT NULL REFERENCES songs(id) ON DELETE CASCADE,  -- 歌曲
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),   -- 收藏时间

    -- 同一用户不能重复收藏同一首歌曲
    UNIQUE (user_id, song_id)
);

-- 索引：查询某用户的所有收藏
CREATE INDEX idx_favorites_user_id ON favorites (user_id);

-- 索引：查询某歌曲被哪些用户收藏
CREATE INDEX idx_favorites_song_id ON favorites (song_id);

COMMENT ON TABLE favorites IS '收藏表 — 用户与歌曲的多对多关联';
COMMENT ON COLUMN favorites.id IS '自增主键';
COMMENT ON COLUMN favorites.user_id IS '外键 → users.id，级联删除';
COMMENT ON COLUMN favorites.song_id IS '外键 → songs.id，级联删除';
COMMENT ON COLUMN favorites.created_at IS '收藏时间';


-- ============================================================================
-- 4. playlists（歌单表）
-- ============================================================================
-- 用户创建的歌单。
-- 一个用户可以创建多个歌单（一对多）。
-- ============================================================================
CREATE TABLE playlists (
    id          SERIAL       PRIMARY KEY,               -- 自增主键
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 创建者
    name        TEXT         NOT NULL,                  -- 歌单名称
    description TEXT         DEFAULT NULL,              -- 歌单描述
    cover_url   TEXT         DEFAULT NULL,              -- 歌单封面图片地址
    is_public   BOOLEAN      NOT NULL DEFAULT TRUE,     -- 是否公开（默认公开）
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),    -- 创建时间

    -- 同一用户的歌单名称不能重复
    UNIQUE (user_id, name)
);

-- 索引：查询某用户的所有歌单
CREATE INDEX idx_playlists_user_id ON playlists (user_id);

-- 索引：查询公开歌单（探索/发现功能）
CREATE INDEX idx_playlists_is_public ON playlists (is_public) WHERE is_public = TRUE;

COMMENT ON TABLE playlists IS '歌单表 — 用户创建的歌单';
COMMENT ON COLUMN playlists.id IS '自增主键';
COMMENT ON COLUMN playlists.user_id IS '外键 → users.id，级联删除';
COMMENT ON COLUMN playlists.name IS '歌单名称（同一用户下唯一）';
COMMENT ON COLUMN playlists.description IS '歌单描述';
COMMENT ON COLUMN playlists.cover_url IS '歌单封面图片 URL';
COMMENT ON COLUMN playlists.is_public IS '是否公开，默认 true';
COMMENT ON COLUMN playlists.created_at IS '创建时间';


-- ============================================================================
-- 5. playlist_songs（歌单歌曲关联表）
-- ============================================================================
-- 歌单与歌曲的关联表。
-- 一个歌单包含多首歌曲，一首歌曲可以属于多个歌单（多对多）。
-- ============================================================================
CREATE TABLE playlist_songs (
    id          SERIAL       PRIMARY KEY,               -- 自增主键
    playlist_id INTEGER      NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,  -- 歌单
    song_id     INTEGER      NOT NULL REFERENCES songs(id) ON DELETE CASCADE,      -- 歌曲
    sort_order  INTEGER      NOT NULL DEFAULT 0,        -- 在歌单中的排序序号（数字越小越靠前）
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),    -- 添加时间

    -- 同一歌单中不能重复添加同一首歌曲
    UNIQUE (playlist_id, song_id)
);

-- 索引：查询某歌单中的所有歌曲（按排序）
CREATE INDEX idx_playlist_songs_playlist_id ON playlist_songs (playlist_id, sort_order);

-- 索引：查询某歌曲属于哪些歌单
CREATE INDEX idx_playlist_songs_song_id ON playlist_songs (song_id);

COMMENT ON TABLE playlist_songs IS '歌单歌曲关联表 — 歌单与歌曲的多对多关联';
COMMENT ON COLUMN playlist_songs.id IS '自增主键';
COMMENT ON COLUMN playlist_songs.playlist_id IS '外键 → playlists.id，级联删除';
COMMENT ON COLUMN playlist_songs.song_id IS '外键 → songs.id，级联删除';
COMMENT ON COLUMN playlist_songs.sort_order IS '歌曲在歌单中的排序序号（0 = 最前）';
COMMENT ON COLUMN playlist_songs.created_at IS '歌曲被添加到歌单的时间';


-- ============================================================================
-- 6. search_logs（搜索日志表）
-- ============================================================================
-- 记录用户在搜索框中搜索但未找到匹配结果的搜索词。
-- 用于统计用户需求、发现缺失歌曲。
-- ============================================================================
CREATE TABLE IF NOT EXISTS search_logs (
    id          BIGSERIAL    PRIMARY KEY,              -- 自增主键
    query       TEXT         NOT NULL,                  -- 用户输入的搜索词
    searched_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()     -- 搜索时间
);

-- 索引：按时间倒序查询最近搜索记录
CREATE INDEX idx_search_logs_searched_at ON search_logs (searched_at DESC);

COMMENT ON TABLE search_logs IS '搜索日志表 — 记录未找到匹配结果的搜索词';
COMMENT ON COLUMN search_logs.id IS '自增主键';
COMMENT ON COLUMN search_logs.query IS '用户输入的搜索词';
COMMENT ON COLUMN search_logs.searched_at IS '搜索时间（默认当前时间）';


-- ============================================================================
-- 表关系说明
-- ============================================================================
--
--   users ──┬── favorites ──── songs
--           │   (多对多)         │
--           │                    │
--           └── playlists ── playlist_songs ──┘
--               (一对多)        (多对多)
--
-- 关系详解：
--
--   users 1 ──── * favorites
--   一个用户可以收藏多首歌曲
--
--   songs 1 ──── * favorites
--   一首歌曲可以被多个用户收藏
--   → favorites 是 users 和 songs 的 多对多 中间表
--
--   users 1 ──── * playlists
--   一个用户可以创建多个歌单
--
--   playlists 1 ──── * playlist_songs
--   一个歌单包含多首歌曲
--
--   songs 1 ──── * playlist_songs
--   一首歌曲可以属于多个歌单
--   → playlist_songs 是 playlists 和 songs 的 多对多 中间表
--
-- 级联删除行为：
--   - 删除用户 → 自动删除其所有收藏、歌单，以及歌单中的歌曲关联
--   - 删除歌曲 → 自动删除所有对该歌曲的收藏，以及歌单中该歌曲的关联
--   - 删除歌单 → 自动删除歌单中的所有歌曲关联
-- ============================================================================
