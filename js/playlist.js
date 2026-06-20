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

    async function getFavorites() {
        await refreshFavorites();
        return _favoritesCache;
    }

    function isFavorite(songId) {
        return _favoritesCache.some(f => String(f.id) === String(songId));
    }

    async function addFavorite(songId) {
        if (!isLoggedIn()) return;
        try {
            const resp = await fetch('/api/favorites/' + songId, {
                method: 'POST',
                headers: authHeaders(),
            });
            if (resp.ok) {
                await refreshFavorites();
                notify();
            }
        } catch (e) {
            console.error('[playlist] addFavorite:', e);
        }
    }

    async function removeFavorite(songId) {
        if (!isLoggedIn()) return;
        try {
            const resp = await fetch('/api/favorites/' + songId, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            if (resp.ok) {
                await refreshFavorites();
                notify();
            }
        } catch (e) {
            console.error('[playlist] removeFavorite:', e);
        }
    }

    async function toggleFavorite(songId) {
        if (!isLoggedIn()) return false;
        if (isFavorite(songId)) {
            await removeFavorite(songId);
            return false;
        } else {
            await addFavorite(songId);
            return true;
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

    async function getPlaylists() {
        await refreshPlaylists();
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
                await refreshPlaylists();
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
        try {
            const resp = await fetch('/api/playlists/' + plId, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            if (resp.ok) {
                await refreshPlaylists();
                notify();
            }
        } catch (e) {
            console.error('[playlist] deletePlaylist:', e);
        }
    }

    async function addToPlaylist(plId, songId) {
        if (!isLoggedIn()) return;
        try {
            const resp = await fetch('/api/playlists/' + plId + '/songs', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ song_id: parseInt(songId) }),
            });
            if (resp.ok) {
                await refreshPlaylists();
                notify();
            }
        } catch (e) {
            console.error('[playlist] addToPlaylist:', e);
        }
    }

    async function removeFromPlaylist(plId, songId) {
        if (!isLoggedIn()) return;
        try {
            const resp = await fetch('/api/playlists/' + plId + '/songs/' + songId, {
                method: 'DELETE',
                headers: authHeaders(),
            });
            if (resp.ok) {
                await refreshPlaylists();
                notify();
            }
        } catch (e) {
            console.error('[playlist] removeFromPlaylist:', e);
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
        addToPlaylist,
        removeFromPlaylist,

        loadFromServer,
        clearAll,

        getSearchHistory,
        addSearchHistory,
        clearSearchHistory,
    };
})();
