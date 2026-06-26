### Task 3: Inline Edit UI for Playlist Names

**Status:** Complete

**Changes:**
- `js/ui.js` — Added `startRename()` function (lines 444-481) that replaces the `.pl-name` span with an `<input>` when clicked
- `js/ui.js` — Updated `renderPlaylists()` (line 496) to add `data-action="rename-playlist"` and `title="点击改名"` to `.pl-name` spans
- `js/ui.js` — Added `rename-playlist` action handler in global delegation (lines 1199-1203) with `e.stopPropagation()` to prevent triggering `open-playlist`
- `css/style.css` — Added `.pl-name-input` styles (lines 2123-2134) for the inline edit input (transparent bg, accent underline, matching font)

**How it works:**
1. User clicks a playlist name in the sidebar playlists view
2. The `.pl-name` span is replaced by an `<input class="pl-name-input">` with the current name pre-filled
3. Enter/Blur commits the rename via `PlaylistStore.renamePlaylist()` (Task 2)
4. Escape reverts to the old name
5. Empty or unchanged input restores the original span without making an API call
6. `PlaylistStore.onChange` triggers `refreshAll` which re-renders the playlists list
