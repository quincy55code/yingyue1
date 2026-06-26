/**
 * playlist.js — 歌单与收藏管理 (API 驱动)
 * =========================================
 * 登录后通过后端 API 读写，未登录返回空数据。
 * 搜索历史仍使用 localStorage。
 */
const PlaylistStore = (() => {
    const KEYS = {
        searchHistory: 'music_player_search_history',
    };

    let _listeners = [];
    let _favoritesCache = [];    // 歌曲对象数组 [{id, title, ...}]
    let _playlistsCache = [];    // 歌单对象数组 [{id, name, song_count, ...}]

    function notify() {
        _listeners.forEach(fn => fn());
    }

    function onChange(fn) {
        _listeners.push(fn);
        return () => { _listeners = _listeners.filter(f => f !== fn); };
    }

    function authHeaders() {
        return Auth.getAuthHeaders();
    }

    function isLoggedIn() {
        return Auth.isLoggedIn();
    }

    // ========== 收藏 ==========

    async function refreshFavorites() {
        if (!isLoggedIn()) {
            _favoritesCache = [];
            return;
        }
        try {
            const resp = await fetch('/api/favorites', { headers: authHeaders() });
            if (resp.ok) {
                _favoritesCache = await resp.json();
            }
        } catch (e) {
            console.error('[playlist] refreshFavorites:', e);
        }
    }

    function getFavorites() {
        return _favoritesCache;
    }

    function isFavorite(songId) {
        return _favoritesCache.some(f => String(f.id) === String(songId));
    }

    /** 从全局歌曲缓存中查找歌曲对象 */
    function lookupSong(songId) {
        if (songId == null) return { id: songId };
        const cache = window._songCache || {};
        // _songCache 是 { id: song } 对象，直接用 key 查找
        if (cache[songId]) return cache[songId];
        // Fallback：遍历查找（兼容 id 类型不一致的情况）
        const found = Object.values(cache).find(s => String(s.id) === String(songId));
        return found || { id: songId };
    }

    async function addFavorite(songId) {
        if (!isLoggedIn()) return;
        // 乐观更新：立即加入缓存
        const song = lookupSong(songId);
        if (!_favoritesCache.some(f => String(f.id) === String(songId))) {
            _favoritesCache = [song, ..._favoritesCache];
        }
        notify();  // 立即通知 UI 刷新（读取缓存，无网络请求）

        try {
            const resp = await fetch('/api/favorites/' + songId, {
                method: 'POST',
                headers: authHeaders(),
            });
            if (!resp.ok) {
                // 失败 → 回滚 + 重新加载
                await refreshFavorites();
                notify();
            }
        } catch (e) {
            console.error('[playlist] addFavorite:', e);
            await refreshFavorites();
            notify();
        }
    }

    async function removeFavorite(songId) {
        if (!isLoggedIn()) return;
        // 乐观更新：立即从缓存移除
        _favoritesCache = _favoritesCache.filter(f => String(f.id) !== String(songId));
        notify();  // 立即通知 UI 刷新

        try {
            const resp = await fetch('/api/favorites/' + songId, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            if (!resp.ok) {
                await refreshFavorites();
                notify();
            }
        } catch (e) {
            console.error('[playlist] removeFavorite:', e);
            await refreshFavorites();
            notify();
        }
    }

    let _toggleLock = false;

    async function toggleFavorite(songId) {
        if (!isLoggedIn()) return false;
        if (_toggleLock) return isFavorite(songId);
        _toggleLock = true;
        try {
            if (isFavorite(songId)) {
                await removeFavorite(songId);
                return false;
            } else {
                await addFavorite(songId);
                return true;
            }
        } finally {
            _toggleLock = false;
        }
    }

    // ========== 自定义歌单 ==========

    async function refreshPlaylists() {
        if (!isLoggedIn()) {
            _playlistsCache = [];
            return;
        }
        try {
            const resp = await fetch('/api/playlists', { headers: authHeaders() });
            if (resp.ok) {
                _playlistsCache = await resp.json();
            }
        } catch (e) {
            console.error('[playlist] refreshPlaylists:', e);
        }
    }

    function getPlaylists() {
        return _playlistsCache;
    }

    function getPlaylistByName(name) {
        return _playlistsCache.find(pl => pl.name === name);
    }

    function getPlaylist(id) {
        return _playlistsCache.find(pl => String(pl.id) === String(id));
    }

    async function createPlaylist(name) {
        if (!isLoggedIn()) return null;
        const trimmed = name.trim();
        if (!trimmed) return null;
        try {
            const resp = await fetch('/api/playlists', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ name: trimmed }),
            });
            if (resp.ok) {
                const newPl = await resp.json();
                _playlistsCache = [newPl, ..._playlistsCache];
                notify();
                return newPl;
            }
            const data = await resp.json();
            if (data.error) {
                alert(data.error);
            }
        } catch (e) {
            console.error('[playlist] createPlaylist:', e);
        }
        return null;
    }

    async function deletePlaylist(plId) {
        if (!isLoggedIn()) return;
        // 乐观更新：立即从缓存移除
        _playlistsCache = _playlistsCache.filter(pl => String(pl.id) !== String(plId));
        notify();  // 立即通知 UI 刷新

        try {
            const resp = await fetch('/api/playlists/' + plId, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            if (!resp.ok) {
                await refreshPlaylists();
                notify();
            }
        } catch (e) {
            console.error('[playlist] deletePlaylist:', e);
            await refreshPlaylists();
            notify();
        }
    }

    async function renamePlaylist(plId, newName) {
        if (!isLoggedIn()) return;
        const trimmed = newName.trim();
        if (!trimmed || trimmed.length > 100) return;

        // 乐观更新：立即更新缓存中的名字
        const old = _playlistsCache.find(p => String(p.id) === String(plId));
        const oldName = old ? old.name : null;
        if (old) {
            old.name = trimmed;
            old._optimistic = true;
        }
        notify();

        try {
            const resp = await fetch('/api/playlists/' + plId, {
                method: 'PATCH',
                headers: authHeaders(),
                body: JSON.stringify({ name: trimmed }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || '重命名失败');
            }
            const updated = await resp.json();
            // 用服务器返回值更新缓存
            const idx = _playlistsCache.findIndex(p => String(p.id) === String(plId));
            if (idx >= 0) {
                _playlistsCache[idx] = { ..._playlistsCache[idx], ...updated, _optimistic: false };
            }
            notify();
        } catch (e) {
            // 回滚
            if (old) old.name = oldName;
            notify();
            throw e;
        }
    }

    async function addToPlaylist(plId, songId) {
        if (!isLoggedIn()) return;
        // 乐观更新：递增对应歌单的 song_count
        const pl = _playlistsCache.find(p => String(p.id) === String(plId));
        if (pl) pl.song_count = (pl.song_count || 0) + 1;
        notify();  // 立即通知 UI 刷新

        try {
            const resp = await fetch('/api/playlists/' + plId + '/songs', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ song_id: parseInt(songId) }),
            });
            if (!resp.ok) {
                await refreshPlaylists();
                notify();
            }
        } catch (e) {
            console.error('[playlist] addToPlaylist:', e);
            await refreshPlaylists();
            notify();
        }
    }

    async function removeFromPlaylist(plId, songId) {
        if (!isLoggedIn()) return;
        // 乐观更新：递减对应歌单的 song_count
        const pl = _playlistsCache.find(p => String(p.id) === String(plId));
        if (pl && pl.song_count > 0) pl.song_count -= 1;
        notify();  // 立即通知 UI 刷新

        try {
            const resp = await fetch('/api/playlists/' + plId + '/songs/' + songId, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            if (!resp.ok) {
                await refreshPlaylists();
                notify();
            }
        } catch (e) {
            console.error('[playlist] removeFromPlaylist:', e);
            await refreshPlaylists();
            notify();
        }
    }

    /** 获取歌单内歌曲（含详情） */
    async function getPlaylistSongs(plId) {
        if (!isLoggedIn()) return [];
        try {
            const resp = await fetch('/api/playlists/' + plId + '/songs', {
                headers: authHeaders(),
            });
            if (resp.ok) {
                return await resp.json();
            }
        } catch (e) {
            console.error('[playlist] getPlaylistSongs:', e);
        }
        return [];
    }

    /** 登录后初始化：拉取服务器数据 */
    async function loadFromServer() {
        await Promise.all([refreshFavorites(), refreshPlaylists()]);
        notify();
    }

    /** 登出后清空 */
    function clearAll() {
        _favoritesCache = [];
        _playlistsCache = [];
        notify();
    }

    // ========== 搜索历史（仍用 localStorage） ==========

    const MAX_HISTORY = 10;

    function getSearchHistory() {
        try {
            const raw = localStorage.getItem(KEYS.searchHistory);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    function addSearchHistory(query) {
        const trimmed = query.trim();
        if (!trimmed) return;
        let history = getSearchHistory();
        history = history.filter(h => h !== trimmed);
        history.unshift(trimmed);
        if (history.length > MAX_HISTORY) {
            history = history.slice(0, MAX_HISTORY);
        }
        localStorage.setItem(KEYS.searchHistory, JSON.stringify(history));
        notify();
    }

    function clearSearchHistory() {
        localStorage.removeItem(KEYS.searchHistory);
        notify();
    }

    return {
        onChange,

        getFavorites,
        isFavorite,
        addFavorite,
        removeFavorite,
        toggleFavorite,

        getPlaylists,
        getPlaylistByName,
        getPlaylist,
        getPlaylistSongs,
        createPlaylist,
        deletePlaylist,
        renamePlaylist,
        addToPlaylist,
        removeFromPlaylist,

        loadFromServer,
        clearAll,

        getSearchHistory,
        addSearchHistory,
        clearSearchHistory,
    };
})();
