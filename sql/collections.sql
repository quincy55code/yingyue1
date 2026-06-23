-- sql/collections.sql
-- 歌曲汇总：一级分类 + 子标签表
-- 在 Supabase SQL Editor 中执行：https://supabase.com/dashboard/project/orphftlwdwuvoscizndx/sql/new

CREATE TABLE collections (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    slug        TEXT NOT NULL UNIQUE,
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE collection_items (
    id             SERIAL PRIMARY KEY,
    collection_id  INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    bvid           TEXT DEFAULT NULL,
    sort_order     INTEGER DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_collection_items_collection_id ON collection_items(collection_id);
CREATE INDEX idx_collection_items_bvid ON collection_items(bvid) WHERE bvid IS NOT NULL;

COMMENT ON TABLE collections IS '歌曲汇总一级分类';
COMMENT ON TABLE collection_items IS '歌曲汇总子标签（BV视频入口）';
COMMENT ON COLUMN collection_items.bvid IS 'B站BV号，主题歌单类为NULL表示占位无歌曲';
