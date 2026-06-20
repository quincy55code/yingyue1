# Task 5 Report — 歌单 API 端点

## Completed

Added 6 playlist CRUD endpoints to `server.js` after the favorites section (after `// ========== 收藏端点 ==========`), before `app.listen(...)`:

| Endpoint | Purpose |
|---|---|
| `GET /api/playlists` | Fetch user's playlists with song counts via `Promise.all` |
| `POST /api/playlists` | Create playlist (name validation 1-30 chars, duplicate key check → 409) |
| `DELETE /api/playlists/:id` | Delete playlist (ownership verification → 403 on mismatch) |
| `GET /api/playlists/:id/songs` | Get songs in playlist (joins through `playlist_songs`, formats via `formatSong`) |
| `POST /api/playlists/:id/songs` | Add song to playlist (ownership check, auto sort_order via max+1, upsert) |
| `DELETE /api/playlists/:id/songs/:songId` | Remove song from playlist |

All endpoints use `authMiddleware` + `supabaseAdmin` (service_role). Section labeled with `// ========== 歌单端点 ==========` comment.
