# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the server (Node.js v24 at /d/softwa/nodejs/node)
/d/softwa/nodejs/node server.js

# Kill lingering server process (Windows — pkill doesn't work)
taskkill //F //PID <pid>

# Find process on port 8765
netstat -ano | grep 8765

# ---- Data import & maintenance scripts ----

# Batch import new songs from B站 compilations (reads scripts/video_list.json)
/d/softwa/nodejs/node scripts/import_songs.js

# Run lyrics auto-matching script (fetches LRC from lrclib.net)
/d/softwa/nodejs/node scripts/fetch_lyrics.js

# Setup tags tables + initial data (needs DB password, direct pg connection)
/d/softwa/nodejs/node scripts/setup_tags.js <DB_PASSWORD>

# Setup verification_codes table + avatar_url column (reads password from .superpowers/db_pass.txt)
/d/softwa/nodejs/node scripts/setup_verification_codes.js

# Setup collections tables + seed data (reads password from .superpowers/db_pass.txt)
/d/softwa/nodejs/node scripts/setup_collections.js

# Batch map songs to tags (uses Supabase REST API, service_role key)
/d/softwa/nodejs/node scripts/map_tags.js

# ---- Cover image scripts ----

# Refresh B站 CDN cover URLs (fetches fresh pic from B站 API, batched by bvid)
/d/softwa/nodejs/node scripts/fetch_bilibili_covers.js

# Replace B站 CDN covers with iTunes high-res (600x600) artwork
/d/softwa/nodejs/node scripts/fetch_covers.js

# Download Unsplash background images for tag category cards → public/images/tags/
/d/softwa/nodejs/node scripts/download_tag_bg.js

# ---- Data repair scripts ----

# Fill empty singer fields using known mappings + database matching
/d/softwa/nodejs/node scripts/fill_singers.js [--dry-run]

# Fix swapped title/singer (B站合集格式不一致导致) — 智能检测 + 逐首修复
/d/softwa/nodejs/node scripts/fix_swapped_songs.js --verify    # 仅验证
/d/softwa/nodejs/node scripts/fix_swapped_songs.js --dry-run   # 预览
/d/softwa/nodejs/node scripts/fix_swapped_songs.js             # 执行修复

# npx supabase CLI (for DB migrations; needs linked project or --db-url + password)
npx supabase --version
```

**Supabase REST API (DML only — SELECT/INSERT/UPDATE/DELETE):**
```bash
SERVICE_KEY="<SUPABASE_SERVICE_ROLE_KEY>"
# Query
curl -s "https://orphftlwdwuvoscizndx.supabase.co/rest/v1/songs?select=*&limit=5" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY"
# Insert
curl -s -X POST "https://orphftlwdwuvoscizndx.supabase.co/rest/v1/songs" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"title":"...","bvid":"...",...}'
# PATCH (update)
curl -s -X PATCH "https://orphftlwdwuvoscizndx.supabase.co/rest/v1/songs?id=eq.1" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=minimal" \
  -d '{"lrc_text":"[00:00.00]..."}'
```

**DDL (ALTER TABLE, CREATE TABLE, etc.) requires Supabase SQL Editor.** PostgREST only does DML. Management API needs a PAT (Personal Access Token), not the service_role key. The `npx supabase db push` approach needs the database password. Simplest path: open https://supabase.com/dashboard/project/orphftlwdwuvoscizndx/sql/new and paste the SQL.

No build step, no linter, no test suite. Dependencies are already installed (`node_modules/`).

## Architecture

**Stack:** Node.js Express backend (port 8765) + vanilla HTML/CSS/JS frontend (no framework). Database is Supabase PostgreSQL (`orphftlwdwuvoscizndx.supabase.co`). The Python `app.py` is a legacy backup — the active backend is `server.js`.

**Static assets:** `express.static(__dirname)` serves the entire project root. Tag card background images are in `public/images/tags/` (downloaded by `download_tag_bg.js` from Unsplash). The directory must exist before running that script.

**Data flow:**
```
Browser <audio src="/api/stream/:id">  →  Express server  →  B站 API (view + playurl)  →  B站 CDN (audio/mp4)
Browser fetch('/api/songs' | '/api/search')  →  Express  →  @supabase/supabase-js  →  Supabase PostgreSQL
Browser fetch('/api/favorites' | '/api/playlists/...')  →  Express (authMiddleware)  →  supabaseAdmin  →  Supabase PostgreSQL
Browser fetch('/api/lyrics/:songId')  →  Express  →  supabase  →  Supabase PostgreSQL
Lyrics popup (lyrics.html) ⬌ BroadcastChannel('music_player_lyrics') ⬌ Main window (player.js + ui.js)
Embedded lyrics panel ← Player.on() timeupdate/loading events ← Main window (ui.js → direct DOM sync, no BroadcastChannel)
```

### Backend (`server.js`)

Two Supabase clients:
- `supabase` (anon key) — public read endpoints: `/api/songs`, `/api/search`, `/api/tags`
- `supabaseAdmin` (service_role key) — auth-protected endpoints: favorites CRUD, playlists CRUD, auth endpoints. Bypasses RLS.

**Key server-side functions:**
- `formatSong(s)` — normalizes DB snake_case → frontend camelCase (`start_seconds` → `start_time`, `end_seconds` → `end_time`, `duration_seconds` → `page_duration`). For segmented songs, `duration` = `end_seconds - start_seconds`. **MUST use `??` (not `||`) for numeric fields like `duration_seconds`** — `0` is a valid duration but `0 || null` returns `null`, causing frontend to show "0:00".
- `attachTags(songs)` — batch-attaches tag names to song objects. Collects all `song_id`s, bulk-queries `song_tags` + `tags` tables (2 queries total, not N+1), returns songs with a `tags: ["标签1", "标签2"]` array added.

Auth endpoints:
- `POST /api/auth/send-code` — generates 6-digit verification code, inserts into `verification_codes` table (2min TTL), sends email via 163 SMTP. Rate-limited: 60s between requests per email.
- `POST /api/auth/check-email` — email-first flow: checks if email exists in `public.users`. Returns `{ exists: boolean }`. Used by frontend to decide whether to show password or register screen.
- `POST /api/auth/login` — three-mode login. `mode: "register"` (email + code + password → create user + profile + sign in), password login (email + password → `signInWithPassword`), verification code login (email + code → `completeLogin()` with custom JWT for existing users). Password login only works if user has previously set a password.
- `POST /api/auth/reset-password` — forgot-password flow. Accepts `{ email, code, password }`, verifies code, finds auth user via `listUsers()`, calls `updateUserById` to set new password. No auth required.
- `POST /api/auth/set-password` — (auth required) sets/updates user's password via `supabaseAdmin.auth.admin.updateUserById`. Accepts `{ password }` (min 6 chars). Returns `{ ok: true }`.
- `POST /api/auth/logout` — no-op (JWT is stateless, frontend clears localStorage)
- `GET /api/auth/me` — validates JWT + returns user profile (`username`, `avatar_url`)
- `PATCH /api/auth/profile` — update username (1-30 chars, unique). Returns updated user.
- `POST /api/auth/avatar` — upload avatar as base64 data URL (PNG/JPEG/WebP, ≤2MB). Uploads to Supabase Storage `avatars` bucket, updates `public.users.avatar_url`. Returns `{ avatar_url }`.

**Custom JWT signing:** `signJWT(payload)` uses Node.js built-in `crypto` to issue HS256 JWTs signed with `SUPABASE_JWT_SECRET`. `issueSession(userId, email)` generates access_token (1h) + refresh_token (7d). Used by `completeLogin()` for existing users so their password is never overwritten by a verification code login.

Song & tag endpoints:
- `GET /api/songs?tag=&bvid=&limit=` — returns songs ordered by id. Optional `?tag=标签名` filters by tag (via `song_tags` join), `?bvid=BVxxx` filters by BV号 and orders by `page` (used by collections feature). `?limit=N` (default 10, max 300). Response includes `tags` array per song via `attachTags()`.
- `GET /api/search?q=` — fuzzy search `title` and `singer` via `ilike` (PostgREST `.or()` filter), limit 20. Response: `{ results: [...songs with tags], query }`.
- `POST /api/search-log` — inserts `{ query, searched_at }` into `search_logs` table with 5-minute dedup. Called silently by frontend when search yields no results.
- `GET /api/tags` — returns tag tree: top-level tags with `children` arrays (for star sub-tags like 明星→周杰伦) and `song_count` per tag. No auth required.
- `GET /api/collections` — returns song collections tree: 12 top-level categories each with `items[]` (sub-tags with `bvid` and `song_count`). Song counts computed via single batch `GROUP BY bvid` query. Used by frontend "歌曲汇总" sidebar feature. No auth required.
- `GET /api/stream/:songId` — proxies B站 DASH audio. Looks up song metadata from Supabase by id, then fetches fresh DASH URL per request (no caching — URLs expire). Uses `fnval=16` for DASH format, sorts audio by bandwidth descending. CID is cached in-memory per `bvid:page` (static value, never expires).
- `GET /api/lyrics/:songId` — returns `{ songId, title, singer, lrc_text }` from the `songs` table. Returns `lrc_text: null` if no lyrics exist for the song. No auth required.
- `POST /api/feedback` — sends user feedback email to `lexiaode@163.com` via 163 SMTP. Accepts `{ content, contact }`. No auth required.

Favorites & Playlists endpoints — all behind `authMiddleware` (JWT token validation):
- `GET /api/favorites` — user's favorites with joined song details
- `POST /api/favorites/:songId` — add favorite (upsert, checks song exists first)
- `DELETE /api/favorites/:songId` — remove favorite
- `GET /api/playlists` — user's playlists with song counts (single batch query, not N+1)
- `POST /api/playlists` — create playlist (name unique per user)
- `DELETE /api/playlists/:id` — verify ownership, delete
- `GET /api/playlists/:id/songs` — songs within a playlist (joined details)
- `POST /api/playlists/:id/songs` — add song to playlist (auto sort_order, upsert)
- `DELETE /api/playlists/:id/songs/:songId` — remove song from playlist

Credentials load from `.env` via a manual parser (no `dotenv` dependency). `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` (from Supabase Dashboard → Settings → API → JWT Settings), and `EMAIL_SMTP_PASS` (163 mailbox SMTP authorization code) are all required at startup. Template at `.env.example`.

**Critical: Range/CORS is handled inline without extra dependencies.** The server forwards `req.headers.range` to B站 CDN so seeking works. It also forwards `Content-Length` from upstream — without it, browsers can't map time→byte offsets and `audio.currentTime = X` silently fails.

### Frontend (vanilla JS IIFE modules)

Five JS files loaded in order in `index.html`: `js/auth.js` → `js/playlist.js` → `js/player.js` → `js/ui.js`. Each is an IIFE returning a singleton object (`Auth`, `PlaylistStore`, `Player`, `UI`). `index.html` bootstraps by fetching `/api/songs` + `/api/tags` in parallel, then calling `UI.init(songs, tags)`.

**HTML layout is a CSS Grid:** `.app-layout` (sidebar 240px | content 1fr) stacked on top of `.player-bar` (72px). The four zones:
- `nav.sidebar` — 240px frosted-glass sidebar with nav items, tag shortcuts, and user area
- `header.top-bar` — 48px bar with centered search input (capsule-shaped, max 480px)
- `main.content-area` — scrollable content area hosting tag grids, cover grids, song lists
- `footer.player-bar` — 72px frosted-glass bar: cover thumbnail (48px) | meta | controls + progress | volume popup
- `.now-playing-overlay` — full-screen immersive view (triggered by clicking the player bar cover), 280px cover art with blurred backdrop, large controls, fav/add-to-playlist actions
- `.lyrics-panel` — **embedded lyrics panel** (`position: fixed`, `z-index: 25`, direct child of `.app-layout`). Slides in from right (380px, `translateX(105%)` → `translateX(0)` via `.open` class). Click 🎤 to toggle, ✕ to close, ↗ to pop out standalone `lyrics.html` window. Syncs via `Player.on()` directly (not BroadcastChannel). Must stay at `.app-layout` root — if moved inside `.content-wrapper`, it gets covered by content area.

`lyrics.html` is a standalone page that can be opened as a popup window (via ↗ button in the embedded lyrics panel, or via `openLyricsWindow()`). It loads its own `js/lyrics.js` (also IIFE → `Lyrics` singleton) and `css/lyrics.css`. It communicates with the main window via `BroadcastChannel('music_player_lyrics')`. The embedded lyrics panel in the main page is an entirely separate implementation in `ui.js` — the two do not share code.

| Module | Responsibility |
|--------|---------------|
| `js/auth.js` | JWT-based auth + email verification code + password login. Manages session (`localStorage` keys: `music_player_session`, `music_player_user`). Methods: `sendCode(email)`, `verifyCode(email, code)`, `loginWithPassword(email, password)`, `checkEmail(email)` → `{ exists }`, `register(email, code, password)` → one-step signup, `resetPassword(email, code, newPassword)` → forgot-password flow, `setPassword(password)`, `updateProfile({ username })`, `uploadAvatar(file)` (reads as base64). Validates token expiry on init via `GET /api/auth/me`. Observer pattern via `onChange()`. Provides `getAuthHeaders()` used by PlaylistStore for all API calls. |
| `js/playlist.js` | API-driven favorites + playlist management with **optimistic local cache**. `getFavorites()`/`getPlaylists()` are **synchronous** (return `_favoritesCache`/`_playlistsCache`). Mutation methods update cache instantly + `notify()` → UI refreshes immediately, then send the network request in background. On failure, they rollback cache by re-fetching from server. Search history still uses localStorage (`music_player_search_history`). |
| `js/player.js` | `<audio>` element lifecycle, play/pause/seek/mode logic. `setVolume(v)` / `getVolume()` for volume control (audio created via `new Audio()`, not in DOM). Emits events: `timeupdate`, `duration`, `playState`, `modeChange`, `ended`, `loading`, `error`. `seek()` adds `startTime` offset for segmented songs. `load()` sets `audio.src = /api/stream/:id`. Fallback seek: fast-forwards at 8x muted if Range not supported by CDN. **Also pushes `time-update` and `song-change` messages to the `music_player_lyrics` BroadcastChannel** for lyrics sync. |
| `js/ui.js` | All DOM rendering and event delegation. **Sidebar-based navigation**: sidebar nav buttons (`data-nav`) switch between home (cover grid of songs), tags (tag grid), collections, favorites, and playlists. `_currentView` tracks `'home'` → `'tags'` → `'tag'` → `'star'` → `'collection'` → `'collection-items'` → `'collection-songs'` → `'favorites'` → `'playlists'` → `'search'`. **Two rendering modes**: `renderCoverGrid()` for tag/song views (large cover cards with hover play overlay, `cover_url` images with gradient fallback), `renderSongList()` for search results (compact list rows with thumbnail). **Auth modal**: Email-first 3-state flow — `email` (enter email → "继续" → checks `/api/auth/check-email`) → `password` (existing account: password login with "用验证码登录" + "忘记密码？" links) / `register` (new account: code + password → one-step signup). Also a `resetPassword` state for forgot-password (code + new password → reset → back to password). No more `showSetPasswordModal` — password setup is baked into the register flow. **User area**: circular avatar (photo or username initial), dropdown menu (修改用户名, 更换头像, 退出登录). **Feedback**: modal with textarea → `POST /api/feedback`. **Mode/volume icons**: inline SVGs replacing emoji; volume icon changes with level (high/medium/low/mute). **Collections**: `navigateToCollection()` fetches `/api/collections`, caches tree in `_collectionTree`, renders 12 category cards with hardcoded `COLLECTION_ICONS` and gradient backgrounds. `navigateToCollectionItems(collId)` renders sub-tags — items WITH `bvid` are clickable (regardless of `song_count`), items with `bvid=null` (主题歌单 placeholders) get `tag-card--empty` class and are non-clickable. Sub-tag cards use gradient backgrounds (no external images). `navigateToCollectionSongs(bvid, title)` calls `/api/songs?bvid=...&limit=300`. **Immersive Now Playing**: `openNowPlaying()` / `closeNowPlaying()` manage a full-screen overlay with 280px cover art, blurred backdrop, large controls, and fav/playlist actions. **Player bar** includes a 48px cover thumbnail (clickable → opens immersive view), song title/singer, center controls + progress, and right-side volume popup. **Embedded lyrics**: `parseLRCEmbedded()` / `fetchLyricsEmbedded()` / `renderLyricsEmbedded()` / `syncLyricsEmbedded()` / `toggleLyricsPanel()` — LRC parsing + binary-search sync, rendered in `.lyrics-panel` (fixed overlay). Opened via 🎤 button, synced directly via `Player.on()` events. **Search**: Debounced (300ms) with history dropdown, silent `/api/search-log` on empty results. Global `[data-action]` event delegation. `sidebarTags` rendered from top 6 tags with colored dots. Tablet: FAB-triggered bottom drawer for favorites/playlists. Skeleton shimmer animation on load. `_songCache` merges from all API responses. |
| `js/lyrics.js` | Runs in the `lyrics.html` standalone popup only (NOT the embedded panel). Parses LRC text (`parseLRC()` → `[{time, text}]`), syncs current line via **binary search** (`syncTime()`), renders in two modes: **vertical** (≈10 lines, scrolls) and **horizontal** (2 lines centered, side-by-side prev/next). Title bar is draggable. Listens on BroadcastChannel for `time-update`, `song-change`, `lyrics-open`. Posts `{ type: 'lyrics-closed' }` and `{ type: 'mode-change' }` (objects, not strings) back to main window. The embedded panel in `ui.js` has its own independent LRC parser (`parseLRCEmbedded()`) and sync logic — the two systems share no code. |

**Event flow for mutations (critical):**
```
User clicks fav → PlaylistStore.toggleFavorite(sid)
  → optimistic cache update → notify() → onChange callback → refreshAll()
  → background: fetch POST/DELETE → if failed → rollback cache + notify()
```
**Do NOT call `refreshAll()` explicitly after mutation methods** — the `onChange` callback already triggers it. Doing so causes a redundant (and potentially conflicting) second render.

**Global `window._songCache`** — shared between UI and PlaylistStore. **It is an OBJECT `{id: song}`, NOT an array.** UI populates it via `mergeToCache()` (sets `_songCache[s.id] = s`). PlaylistStore's `lookupSong()` reads it via `cache[songId]` with `Object.values(cache).find()` fallback — do NOT call `.find()` directly on it (this crashes with `TypeError: cache.find is not a function`).

### CSS

- `css/style.css` — Spotify × Apple Music fusion dark theme. **Design tokens** in `:root`: dark green background hierarchy (`--bg-root: #0B0E0C` → `--bg-elevated: #1C2320`), warm green accent (`--accent: #4DB88D`), frosted glass via `backdrop-filter: blur()` on sidebar and player bar. **Layout**: CSS Grid `.app-layout` (sidebar | content-wrapper) + `content-wrapper` flex column (top-bar | content-area). `.content-wrapper` MUST have `overflow: hidden` (not visible). **Components**: `.cover-card` (140px cover image + title/singer + hover play overlay + corner fav button), `.song-list-item` (44px thumbnail row for search), `.tag-card` (emoji icon + name + count), `.sidebar` (240px frosted, 3px green active indicator), `.player-bar` (72px frosted, 48px cover, center controls+progress, right volume popup), `.now-playing-overlay` (full-screen, 280px cover, blurred backdrop), `.lyrics-panel` (`position: fixed; z-index: 25; right: 0; width: 380px` — slide-in via `translateX(105%)` → `translateX(0)` on `.open`). **Responsive breakpoints**: ≥1024px (full sidebar), 768-1023px (hide sidebar, show hamburger + FAB + bottom drawer, lyrics panel full-width), <768px (compact player bar, lyrics panel full-width, progress bar still visible). **Animations**: staggered card entry (`cardEnter` keyframe), skeleton shimmer, `glowPulse` for playing card, `heartPop` for fav toggle, `npoContentIn` for immersive view entrance. `prefers-reduced-motion` respected.
- `css/lyrics.css` — Lyrics popup window styles. Shares the same CSS variable naming as the main app (dark green theme). Vertical mode: line-by-line scroll with active line in accent color; horizontal mode: two large lines centered side-by-side. Frosted glass container background.

### Database (`sql/`)

- `schema.sql` — Six tables with indexes and comments. Entity relationships:
```
users ──┬── favorites ──── songs ──── song_tags ──── tags
        │   (多对多)                    (多对多)
        └── playlists ── playlist_songs ──┘
            (一对多)        (多对多)
```
- `collections.sql` — Two additional tables for the "歌曲汇总" feature: `collections` (12 top-level categories) and `collection_items` (sub-tags with `bvid` FK'd to `collections.id`). `collection_items.bvid` is an implicit reference to `songs.bvid` (no FK constraint).
- `seed_collections.sql` — 12 collection INSERTs + ~53 collection_item INSERTs. 主题歌单 items have `bvid=NULL`. Must be executed after `collections.sql` DDL.
- `tags.sql` — Tags system: `tags` table (self-referencing `parent_id` for `明星→周杰伦` hierarchy) + `song_tags` many-to-many join table + 15 top-level tag seeds + 8 star sub-tags. Must be executed in Supabase SQL Editor (DDL), or via `scripts/setup_tags.js` (direct pg connection).
- `insert_songs.sql` — 100-song bulk insert from B站 compilation BV1pr6aYiE97 (华语女声合集). Each song is a separate page (p=1..100) within that video. These populate IDs 1-100.
- `alter_lyrics.sql` — Adds `lrc_text TEXT DEFAULT NULL` column to `songs` table. Must be executed in Supabase SQL Editor (DDL).
- `verification_codes.sql` — Creates `verification_codes` table for email verification code storage (5-min TTL). Also adds `avatar_url TEXT` column to `public.users`. Executed by `scripts/setup_verification_codes.js`.
- `gen_csv.js` / `songs_100.csv` — Utility to generate CSV from B站 API for bulk import.

### Scripts (`scripts/`)

**Data import & maintenance:**
- `import_songs.js` — Batch-imports songs from B站 compilations. Reads BV号 list from `scripts/video_list.json`, queries B站 API for each video's pagelist, parses `NN.歌名 - 歌手` format, deduplicates against existing `bvid+page` in DB, and inserts new songs. Outputs suggested next steps (`map_tags.js` + `fetch_lyrics.js`).
- `fetch_lyrics.js` — Fetches LRC lyrics from lrclib.net API for all songs missing lyrics. Queries `lrc_text=is.null`, calls lrclib search + direct get APIs, validates (≥5 timestamp lines), PATCHes back via Supabase REST API. 1.5s rate limit between requests.
- `setup_tags.js` — Connects directly to Supabase PostgreSQL (pg module, port 5432) to execute `sql/tags.sql` DDL + seed data. Requires DB password as CLI argument. Used because PostgREST can't do DDL.
- `setup_collections.js` — Connects directly to Supabase PostgreSQL to execute `sql/collections.sql` DDL + `sql/seed_collections.sql` seed data. Reads password from `.superpowers/db_pass.txt` (no CLI arg needed). Skips DDL if tables exist, skips seed if collections already have rows. **Known pitfall**: the `executeSQL()` function strips `--` comment lines from split SQL statements — DDL files MUST NOT have `--` comment lines before the first statement, or that statement gets filtered out (fixed by regex-stripping comment lines before filtering).
- `map_tags.js` — Batch-associates songs to tags via Supabase REST API. Uses hardcoded `SINGER_TAGS` (singer→tag mapping) and `TITLE_KEYWORDS` (title keyword→tag mapping) rules, then POSTs to `song_tags` table. Idempotent (skips 409 duplicates).

**Cover images:**
- `fetch_bilibili_covers.js` — Refreshes B站 CDN cover URLs. Finds distinct bvids with `hdslb.com` covers, fetches fresh `pic` from B站 view API, batch-PATCHes all songs sharing that bvid. Fast (~500ms delay between bvids).
- `fetch_covers.js` — Replaces B站 CDN covers with iTunes album artwork. Searches iTunes API (CN store → title-only CN → US store), matches by singer similarity, upgrades to 600×600 resolution. 1.5s rate limit per song. Handles 1000+ songs.
- `download_tag_bg.js` — Downloads Unsplash background images for each tag category (15 hardcoded tag→keyword mappings) to `public/images/tags/`. Sized 600×400, skips existing valid files. 2s rate limit.

**Data repair:**
- `fill_singers.js` — Fills empty singer fields. Uses 4 strategies: ① extract `【歌手】歌名` bracket format, ② 400+ entry `KNOWN_SINGERS` hardcoded map, ③ match same-title songs in DB by frequency, ④ fuzzy normalized title matching. Supports `--dry-run`.
- `fix_song_titles.js`, `fix_song_data.js`, `fix_english_songs.js`, `fix_foreign_swaps.js`, `fix_bv1xh68YvEij.js`, `check_foreign_swaps.js`, `undo_bv.js`, `retry_lyrics.js`, `fix_wrong_lyrics.js` — One-off data repair scripts for specific cleanup tasks. Not expected to be run regularly.

**⚠️ 重要:** `fix_swapped_songs.js` **不是一次性脚本** — 它是通用的 title/singer 互换修复工具（v3 智能检测 + 硬编码 200+ 歌手名单）。**每次 `import_songs.js` 导入新 BV 后都应运行 `--verify` 检查。**见 Key Gotchas #35。

**Config files:**
- `scripts/video_list.json` — JSON array of BVID strings used by `import_songs.js`. Edit to add new compilation BV号s before importing.

## Adding a Song

**Preferred: Use `import_songs.js` for batch imports from B站 compilations.**
1. Add the BV号 to `scripts/video_list.json` (JSON array of strings)
2. Run `/d/softwa/nodejs/node scripts/import_songs.js` — it parses `NN.歌名 - 歌手` format, deduplicates, and inserts
3. Run `node scripts/fix_swapped_songs.js --verify` to check for title/singer swap (B站格式不一致)
4. If swaps detected, run `node scripts/fix_swapped_songs.js` to fix
5. Then run `map_tags.js` and `fetch_lyrics.js` in sequence

**Manual single-song insert via REST API:**

1. **If it's a standalone B站 video:**
   ```bash
   # Fetch video info to get cid, cover, full duration
   curl -s "https://api.bilibili.com/x/web-interface/view?bvid=<BVID>" \
     -H "User-Agent: Mozilla/5.0..." -H "Referer: https://www.bilibili.com/"
   
   # Then insert via Supabase REST API
   SERVICE_KEY="<from .env>"
   printf '{"title":"<歌名>","singer":"<歌手>","bvid":"<BVID>","page":1,"start_seconds":<start>,"end_seconds":<end>,"duration_seconds":<full_dur>,"cover_url":"<cover>","bilibili_url":"https://www.bilibili.com/video/<BVID>/"}' > /tmp/song.json
   curl -s -X POST "https://orphftlwdwuvoscizndx.supabase.co/rest/v1/songs" \
     -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
     -H "Content-Type: application/json" -H "Prefer: return=representation" \
     -d @/tmp/song.json
   ```

2. **If the song is a page within a multi-page B站 compilation:**
   - `page` = the page number, `start_seconds`/`end_seconds` = NULL (the whole page is the song)
   - `duration_seconds` = the page duration from B站 API

3. **The server defaults to top 10 by ID ascending** (`/api/songs`). Pass `?limit=300` (max) to get more. New songs with higher IDs are discoverable via search or tag filtering even if they don't appear in the default top-10.

## Key Gotchas

1. **Seek requires Content-Length.** If the browser doesn't get `Content-Length` in the initial 200 response, it can't derive byte ranges for time positions. Always ensure `server.js` forwards upstream `content-length`. Songs with time segments work around this because the initial `audio.currentTime = startTime` triggers an abort+retry with Range before data streams.

2. **`audio.duration` is Infinity for streamed MP4.** The player uses `duration_seconds` from Supabase as fallback (`pageDuration`). When adding new songs, ensure `duration_seconds` is populated.

3. **B站 DASH audio URLs are temporary.** Never cache them — fetch fresh per request. Use `fnval=16` for DASH format, sort audio streams by bandwidth descending for best quality.

4. **Windows environment.** Node.js is at `/d/softwa/nodejs/node` (not in PATH as `node`). Use `taskkill //F //PID <pid>` to kill processes (not Unix `pkill`). Chinese directory names break `npm init` — write `package.json` manually. Bash is Git Bash (POSIX sh), not cmd.exe — use forward slashes.

5. **`express.static(__dirname)` serves the frontend.** The server doubles as a static file server — no separate web server needed.

6. **Supabase `.env` is required.** Server exits on startup if any of `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, or `EMAIL_SMTP_PASS` are missing. Template at `.env.example`. `SUPABASE_JWT_SECRET` is obtained from Supabase Dashboard → Settings → API → JWT Settings. No DATABASE_URL or postgres password — direct `pg` connections use `db.orphftlwdwuvoscizndx.supabase.co` with password from `.superpowers/db_pass.txt`.

7. **Supabase Storage `avatars` bucket** — must be created manually in Supabase Dashboard (Storage → New Bucket → `avatars` → Public). Stores user avatar images at path `{userId}/avatar.{ext}`. Upload is done server-side via `supabaseAdmin.storage.from('avatars').upload()` with upsert.

8. **PostgREST DML-only.** `@supabase/supabase-js` uses PostgREST which only supports SELECT/INSERT/UPDATE/DELETE. DDL requires Supabase SQL Editor. The service_role key bypasses RLS but still goes through PostgREST — it cannot execute DDL. For direct DB access use the Supabase REST API with service_role key (see Commands section above).

9. **Column name: `bilibili_url` (underscore).** Not `"bilibili url"` with space. Supabase queries must use the underscore form.

10. **Frontend mutation methods fire `notify()` synchronously.** PlaylistStore's optimistic cache update calls `notify()` before the network request completes. Event handlers in ui.js must NOT call `refreshAll()` after mutation methods — the `onChange` → `refreshAll` callback already handles UI refresh. Calling it again causes double-render.

11. **`formatSong()` maps DB columns.** `start_seconds` → `start_time`, `end_seconds` → `end_time`, `duration_seconds` → `page_duration`. For segmented songs, `duration` = `end_seconds - start_seconds`. Frontend code uses the camelCase names.

12. **Lyrics channel name is `music_player_lyrics`.** Both `js/player.js` (main window) and `js/lyrics.js` (popup) must use the exact same `BroadcastChannel` name. Message types: `time-update` (main→lyrics, carries `currentTime` in seconds), `song-change` (main→lyrics, carries `id`), `lyrics-open` (main→lyrics). **Messages from popup are objects, not strings**: `{ type: 'lyrics-closed' }` and `{ type: 'mode-change' }`. When checking for closed popup, use `e.data && e.data.type === 'lyrics-closed'`, not `e.data === 'lyrics-closed'`. The embedded lyrics panel in `ui.js` does NOT use BroadcastChannel — it syncs directly via `Player.on()` events.

13. **`currentTime` in lyrics messages is display time (offset from song start).** For segmented songs, `player.js` subtracts `startTime` before pushing to the lyrics channel. The lyrics parser's `syncTime()` uses this display time directly for line matching.

14. **Lyrics can be viewed two ways: embedded panel OR standalone popup.** Clicking 🎤 toggles the embedded `.lyrics-panel` (a `position: fixed` overlay at the `.app-layout` root level, NOT inside `.content-wrapper`). Clicking ↗ in the panel header pops out the standalone `lyrics.html` window. The embedded panel syncs via `Player.on()` directly — no BroadcastChannel involved. The popup still uses BroadcastChannel for time-update / song-change / lyrics-open messages from the main window, and sends `{ type: 'lyrics-closed' }` / `{ type: 'mode-change' }` back.

15. **`Player.on()` `timeupdate` event uses `displayDuration`, not `totalDuration`.** The emitted object is `{ displayCurrent, displayDuration, progress, ... }`. When calling `updateProgress()`, map `data.displayCurrent` → `currentTime` and `data.displayDuration` → `duration`. Using `totalDuration` (which doesn't exist) → `undefined` → progress bar fill never updates.

16. **`.content-wrapper` MUST have `overflow: hidden`.** If set to `visible`, the content area overflows its grid row and covers the `.player-bar` (progress bar, controls become invisible). This was briefly changed to `visible` when the lyrics panel lived inside `.content-wrapper` — but after moving the panel to `position: fixed` at the root, `overflow: hidden` must be restored.

17. **`.lyrics-panel` must stay at `.app-layout` root as `position: fixed`.** If moved inside `.content-wrapper`, it will be covered by the content area's rendered layer and only flash briefly during view transitions. Current CSS: `position: fixed; top: var(--topbar-height); bottom: var(--player-height); right: 0; z-index: 25;`.

18. **`window.open()` for lyrics popout must NOT use `noopener`.** With `noopener`, the browser ignores the window name (`'music_player_lyrics'`) and opens a new window on every click. Without it, the browser reuses the existing window. Same-origin (localhost:8765), so `noopener` is unnecessary.

19. **BroadcastChannel `lyrics-closed` is an object, not a string.** `lyrics.js` sends `{ type: 'lyrics-closed' }`. `ui.js` checks `e.data && e.data.type === 'lyrics-closed'`. Comparing `e.data === 'lyrics-closed'` (string equality) never matches, so `lyricsWindow` is never nulled — though this doesn't cause multiple popups since the window-name dedup handles that.

20. **Mobile progress bar is always visible.** The `display: none` on `.player-progress` at ≤767px was removed — the progress bar now stays visible at all screen sizes. Only `.player-right` (volume) remains hidden on mobile and shows on player-bar expand.

21. **Home view ≠ Tags view.** `navigateHome()` → `renderCoverGrid(_defaultSongs)` (song covers under "🎵 推荐歌曲" heading). `navigateToTags()` → `renderTagGrid(_tags)` (tag cards under "🎵 音乐分类" heading). They are separate views with separate `_currentView` values (`'home'` vs `'tags'`).

22. **163 SMTP uses direct IP to bypass DNS hijacking.** The user's network resolves `smtp.163.com` to a bogus IP (`198.18.0.4`). `server.js` connects to the real IP `117.135.214.13` with `tls: { servername: 'smtp.163.com' }` for TLS SNI. If SMTP fails in the future, the IP may have changed — check with `nslookup smtp.163.com` from a clean network and update the host.

23. **`verification_codes` table stores email verification codes.** Created by `scripts/setup_verification_codes.js` (direct pg connection, reads DB password from `.superpowers/db_pass.txt`). Columns: `id, email, code, expires_at (2min TTL), used, created_at`. Also adds `avatar_url TEXT` column to `public.users`.

24. **Collection item clickability is based on `bvid`, not `song_count`.**
25. **Verification code login no longer overwrites passwords.** `completeLogin()` uses `issueSession()` (custom JWT) for existing users instead of `updateUserById({ password: tempPass })`. This means a user's password survives verification code logins.
26. **`SUPABASE_JWT_SECRET` is mandatory.** The server exits on startup if it's missing. Get it from Supabase Dashboard → Settings → API → JWT Settings. It's used by `signJWT()` to issue custom tokens for verification code login and session management.
27. **Search input uses `type="search"` wrapped in `<form autocomplete="off">` with a hidden email trap input.** Chrome ignores `autocomplete="off"` on individual inputs and autofills saved emails into any text field. Three-layer defense: (1) `<form autocomplete="off">` around the search area, (2) hidden `<input type="email" autocomplete="email">` before the real search input to trap Chrome's autofill, (3) `type="search"` on the real input. All `<button>` elements inside the form MUST have `type="button"` — without it they default to `type="submit"` and cause page reload on click.
28. **Auth modal uses email-first flow, not tabs.** States: `email` → `password` / `register` / `resetPassword`. No more `showSetPasswordModal`. Password setup happens in the register state. The old tab-based `showAuthModal` was fully replaced. `renderCollectionItemsGrid()` uses `hasBvid = !!it.bvid` to determine whether a sub-tag card is clickable, has a background image, and gets the `tag-card--empty` class. Items with valid `bvid` but `song_count=0` (songs not yet imported) are still clickable. Only `bvid=NULL` items (主题歌单 placeholders) are non-clickable. Do NOT revert this to checking `song_count > 0` — that breaks navigation for any BV whose songs haven't been imported yet.
29. **`formatTime(sec)` must handle `0` as valid.** The check is `sec == null || !isFinite(sec)`, NOT `!sec`. `0` is a valid song duration but `!0` is `true`, which would show "0:00" for songs that legitimately have 0-second duration segments (rare but valid).
30. **`window._songCache` is an object `{id: song}`, NOT an array.** `mergeToCache()` populates it as `_songCache[s.id] = s`. Any code that reads it (like `playlist.js:lookupSong()`) must use `cache[id]` or `Object.values(cache).find()`, never `.find()` directly on the cache object — that throws `TypeError: cache.find is not a function` and silently breaks favorite toggling.
31. **Cover cards have two corner buttons**: `.cover-card-fav` (top-right, ♡/❤️ toggle favorite) and `.cover-card-add-pl` (bottom-right, `+` add to playlist). Both use `z-index: 2` and `position: absolute`. The `+` button matches singer text color (`var(--text-secondary)`) with `font-weight: 300`.
32. **Toast notification system**: `showToast(msg)` creates a centered toast with `toastBounce` animation, auto-removed via `setTimeout` after 2s. Do NOT use `animationend` event for cleanup — it fires at each animation phase and causes premature removal. Toast has `pointer-events: none; z-index: 200`.
33. **Playlist rename is double-click (not single-click).** The global `dblclick` event delegation catches `[data-action="rename-playlist"]` and calls `startRename()`. The click handler for the same action only calls `e.stopPropagation()` to prevent triggering `open-playlist` on the parent row. `.pl-name-input` has NO underline (`border: none`).
34. **Add-to-playlist modal buttons**: Each playlist row has a frosted-glass "添加" button (`.btn-add-to-pl`) with `data-action="do-add-to-pl"`. On click, it gets `.loading` class (CSS spinner via `::after` pseudo-element), disables itself, calls the API, then closes modal + shows toast.
35. **B站合集格式不一致 → title/singer 互换。** `import_songs.js` 的 `parseTitle()` 始终假设 `歌名 - 歌手` 格式（即分隔符左边是歌名、右边是歌手）。但部分 B站合集使用 `歌手 - 歌名` 格式，导入后 `title` 存的是歌手名、`singer` 存的是歌名。**每次 `import_songs.js` 导入后，必须运行 `node scripts/fix_swapped_songs.js --verify` 检查**，如有互换则运行修复。已确认受影响的 BV 合集有 18 个（百首粤语经典、100首经典老歌、00后KTV必点 等），2026-06-26 已修复 1776 首。[[title-singer-swap-fix]]
