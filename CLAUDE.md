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

# Direct Supabase database access via REST API (pg module password auth doesn't work)
# Use curl with the SUPABASE_SERVICE_ROLE_KEY from .env:
SERVICE_KEY="<SUPABASE_SERVICE_ROLE_KEY>"
curl -s "https://orphftlwdwuvoscizndx.supabase.co/rest/v1/songs?select=*&limit=5" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY"

# Insert via REST API (use -d @file.json for JSON with special chars):
curl -s -X POST "https://orphftlwdwuvoscizndx.supabase.co/rest/v1/songs" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"title":"...","bvid":"...",...}'
```

No build step, no linter, no test suite. Dependencies are already installed (`node_modules/`).

## Architecture

**Stack:** Node.js Express backend (port 8765) + vanilla HTML/CSS/JS frontend (no framework). Database is Supabase PostgreSQL (`orphftlwdwuvoscizndx.supabase.co`). The Python `app.py` is a legacy backup — the active backend is `server.js`.

**Data flow:**
```
Browser <audio src="/api/stream/:id">  →  Express server  →  B站 API (view + playurl)  →  B站 CDN (audio/mp4)
Browser fetch('/api/songs' | '/api/search')  →  Express  →  @supabase/supabase-js  →  Supabase PostgreSQL
Browser fetch('/api/favorites' | '/api/playlists/...')  →  Express (authMiddleware)  →  supabaseAdmin  →  Supabase PostgreSQL
```

### Backend (`server.js`)

Two Supabase clients:
- `supabase` (anon key) — public read endpoints: `/api/songs`, `/api/search`
- `supabaseAdmin` (service_role key) — auth-protected endpoints: favorites CRUD, playlists CRUD, auth endpoints. Bypasses RLS.

Auth endpoints:
- `POST /api/auth/signup` — creates user in Supabase Auth (auto-confirms email) + inserts into `public.users`, returns session
- `POST /api/auth/login` — Supabase Auth sign-in, fetches username from `public.users`
- `POST /api/auth/logout` — no-op (JWT is stateless, frontend clears localStorage)
- `GET /api/auth/me` — validates JWT + returns user profile

Song endpoints:
- `GET /api/songs` — queries `songs` table via Supabase, returns top 10 ordered by id. Uses `formatSong()` to normalize DB rows to frontend format (maps `start_seconds`/`end_seconds` → `start_time`/`end_time`, computes `duration`).
- `GET /api/search?q=` — fuzzy search `title` and `singer` via `ilike` (PostgREST `.or()` filter), limit 20.
- `POST /api/search-log` — inserts `{ query, searched_at }` into `search_logs` table with 5-minute dedup. Called silently by frontend when search yields no results.
- `GET /api/stream/:songId` — proxies B站 DASH audio. Looks up song metadata from Supabase by id, then fetches fresh DASH URL per request (no caching — URLs expire). Uses `fnval=16` for DASH format, sorts audio by bandwidth descending. CID is cached in-memory per `bvid:page` (static value, never expires).

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

Credentials load from `.env` via a manual parser (no `dotenv` dependency). `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are required at startup.

**Critical: Range/CORS is handled inline without extra dependencies.** The server forwards `req.headers.range` to B站 CDN so seeking works. It also forwards `Content-Length` from upstream — without it, browsers can't map time→byte offsets and `audio.currentTime = X` silently fails.

### Frontend (vanilla JS IIFE modules)

Four JS files loaded in order: `js/auth.js` → `js/playlist.js` → `js/player.js` → `js/ui.js`. Each is an IIFE returning a singleton object (`Auth`, `PlaylistStore`, `Player`, `UI`). `index.html` bootstraps by fetching `/api/songs` then calling `UI.init(songs)`.

| Module | Responsibility |
|--------|---------------|
| `js/auth.js` | JWT-based auth. Manages session (`localStorage` keys: `music_player_session`, `music_player_user`). Validates token expiry on init via `GET /api/auth/me`. Observer pattern via `onChange()`. Provides `getAuthHeaders()` used by PlaylistStore for all API calls. |
| `js/playlist.js` | API-driven favorites + playlist management with **optimistic local cache**. `getFavorites()`/`getPlaylists()` are **synchronous** (return `_favoritesCache`/`_playlistsCache`). Mutation methods update cache instantly + `notify()` → UI refreshes immediately, then send the network request in background. On failure, they rollback cache by re-fetching from server. Search history still uses localStorage (`music_player_search_history`). |
| `js/player.js` | `<audio>` element lifecycle, play/pause/seek/mode logic. Emits events: `timeupdate`, `duration`, `playState`, `modeChange`, `ended`, `loading`, `error`. `seek()` adds `startTime` offset for segmented songs. `load()` sets `audio.src = /api/stream/:id`. Fallback seek: fast-forwards at 8x muted if Range not supported by CDN. |
| `js/ui.js` | All DOM rendering and event delegation. Renders song cards from server data. Search: 300ms debounced input → `/api/search` → renders results or empty state + silent `/api/search-log`. `_defaultSongs` caches initial top-10 for restore on search clear. Global `[data-action]` event delegation pattern. |

**Event flow for mutations (critical):**
```
User clicks fav → PlaylistStore.toggleFavorite(sid)
  → optimistic cache update → notify() → onChange callback → refreshAll()
  → background: fetch POST/DELETE → if failed → rollback cache + notify()
```
**Do NOT call `refreshAll()` explicitly after mutation methods** — the `onChange` callback already triggers it. Doing so causes a redundant (and potentially conflicting) second render.

**Global `window._songCache`** — shared between UI and PlaylistStore. UI populates it via `mergeToCache()` from search results and initial load. PlaylistStore's `lookupSong()` reads it to get full song metadata for optimistic favorite updates.

### CSS (`css/style.css`)

Design system via CSS variables: warm peach `--bg-primary: #F5E6D3`, coral accent `--accent: #E8917B`. Frosted glass player bar (`backdrop-filter: blur`). Per-song color variables (`--song-1` through `--song-4`). Responsive: right panel collapses below 768px. Search box styles at end of file (`.search-wrap`, `.search-input`, `.search-clear`, `.search-empty`).

### Database (`sql/`)

`schema.sql` — six tables with indexes and comments. Entity relationships:
```
users ──┬── favorites ──── songs
        │   (多对多)
        └── playlists ── playlist_songs ──┘
            (一对多)        (多对多)
```

`insert_songs.sql` — 100-song bulk insert from B站 compilation BV1pr6aYiE97 (华语女声合集). Each song is a separate page (p=1..100) within that video. These populate IDs 1-100.

DDL (CREATE TABLE, ALTER, etc.) requires Supabase SQL Editor. DML can use either the Supabase REST API with service_role key (for scripts) or the Express server endpoints (for the app).

## Adding a Song

1. **If it's a standalone B站 video timeline segment:**
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

3. **The server queries only top 10 by ID ascending** (`/api/songs`). New songs with higher IDs are discoverable via search but won't appear on the homepage.

## Key Gotchas

1. **Seek requires Content-Length.** If the browser doesn't get `Content-Length` in the initial 200 response, it can't derive byte ranges for time positions. Always ensure `server.js` forwards upstream `content-length`. Songs with time segments work around this because the initial `audio.currentTime = startTime` triggers an abort+retry with Range before data streams.

2. **`audio.duration` is Infinity for streamed MP4.** The player uses `duration_seconds` from Supabase as fallback (`pageDuration`). When adding new songs, ensure `duration_seconds` is populated.

3. **B站 DASH audio URLs are temporary.** Never cache them — fetch fresh per request. Use `fnval=16` for DASH format, sort audio streams by bandwidth descending for best quality.

4. **Windows environment.** Node.js is at `/d/softwa/nodejs/node` (not in PATH as `node`). Use `taskkill //F //PID <pid>` to kill processes (not Unix `pkill`). Chinese directory names break `npm init` — write `package.json` manually. Bash is Git Bash (POSIX sh), not cmd.exe — use forward slashes.

5. **`express.static(__dirname)` serves the frontend.** The server doubles as a static file server — no separate web server needed.

6. **Supabase `.env` is required.** Server exits on startup if `SUPABASE_URL` or `SUPABASE_ANON_KEY` are missing. Template at `.env.example`. The `.env` contains only these keys plus `SUPABASE_SERVICE_ROLE_KEY` — no DATABASE_URL or postgres password for direct `pg` connections.

7. **PostgREST DML-only.** `@supabase/supabase-js` uses PostgREST which only supports SELECT/INSERT/UPDATE/DELETE. DDL requires Supabase SQL Editor. The service_role key bypasses RLS but still goes through PostgREST — it cannot execute DDL. For direct DB access use the Supabase REST API with service_role key (see Commands section above).

8. **Column name: `bilibili_url` (underscore).** Not `"bilibili url"` with space. Supabase queries must use the underscore form.

9. **Frontend mutation methods fire `notify()` synchronously.** PlaylistStore's optimistic cache update calls `notify()` before the network request completes. Event handlers in ui.js must NOT call `refreshAll()` after mutation methods — the `onChange` → `refreshAll` callback already handles UI refresh. Calling it again causes double-render.

10. **`formatSong()` maps DB columns.** `start_seconds` → `start_time`, `end_seconds` → `end_time`, `duration_seconds` → `page_duration`. For segmented songs, `duration` = `end_seconds - start_seconds`. Frontend code uses the camelCase names.
