# Cover Card "Add to Playlist" Button — Design

**Date:** 2026-06-24
**Status:** approved

## Problem

The cover grid (`renderCoverGrid`) — used for home, tag, collection, favorites, and playlist song views — has a favorite (❤️/♡) button on each card but **no "add to playlist" button**. The song list view (`renderSongList`) and Now Playing overlay already have this button. Users can't add a song to their playlist from cover grid views without first clicking into the song.

## Solution

Add a `+` button to the top-left corner of every cover card, mirroring the existing favorite button at top-right. Clicking it opens the existing "添加到歌单" modal (`showAddToPlaylistModal`).

```
┌──────────────────────┐
│  +           ♡ │
│                    │
│    ┌──────────┐    │
│    │  专辑封面  │    │
│    │    ▶     │    │
│    └──────────┘    │
│                    │
│    歌曲名称         │
│    歌手名          │
└──────────────────────┘
```

## Changes

### 1. `js/ui.js` — `renderCoverGrid()` (line ~195)

Add one `<button>` element before the existing `cover-card-fav` button:

```html
<button class="cover-card-add-pl" data-action="show-add-to-playlist" data-song-id="${song.id}">+</button>
```

- `data-action="show-add-to-playlist"` — already handled by the global event delegation (line 1243)
- `data-song-id` — already read by the handler
- No new JavaScript logic needed

### 2. `css/style.css` — New `.cover-card-add-pl` class

Mirror `.cover-card-fav` styling with `left` instead of `right`:

```css
.cover-card-add-pl {
    position: absolute;
    top: var(--space-sm);
    left: var(--space-sm);
    width: 32px;
    height: 32px;
    border: none;
    background: rgba(0,0,0,0.4);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    cursor: pointer;
    font-size: 16px;
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-primary);
    transition: transform var(--duration-micro) var(--ease-spring),
                color var(--duration-micro) var(--ease-out);
    z-index: 2;
}

.cover-card-add-pl:hover { transform: scale(1.15); }
.cover-card-add-pl:active { transform: scale(0.85); }
```

### 3. No changes to

- Event handling — `show-add-to-playlist` action already wired (ui.js:1243)
- Modal — `showAddToPlaylistModal()` already exists (ui.js:1861)
- API — `PlaylistStore.addToPlaylist()` already exists (playlist.js:247)
- Auth gating — handler already checks `Auth.isLoggedIn()` before showing modal

## Affected views

All views rendered by `renderCoverGrid()`:
- Home (推荐歌曲)
- Tag filter (标签分类)
- Star sub-tag (明星子标签)
- Collection songs (歌曲汇总 → BV songs)
- Favorites list (收藏)
- Playlist songs (歌单内歌曲)

## Design decisions

- **Icon `+`**: Consistent with `.btn-add` in song list rows (ui.js:226). The `📋` clipboard emoji used in the Now Playing overlay felt out of place on the smaller card button.
- **Top-left position**: Symmetrical with fav at top-right. Two frosted-glass circles balanced at the top corners of the cover image.
- **No hover-text/tooltip**: Keeps it minimal — the `+` is universally understood and the existing song-list button uses the same convention.
