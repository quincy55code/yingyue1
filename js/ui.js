/**
 * ui.js — DOM 渲染与用户交互
 * ===========================
 * Spotify × Apple Music 融合设计：侧边栏导航 + 封面网格 + 沉浸式 Now Playing
 */
const UI = (() => {
    let lyricsWindow = null;
    let _currentView = 'home';
    let _defaultSongs = [];
    let _songCache = {};
    let _searchTimer = null;

    // 歌曲汇总（Collections）状态
    let _currentCollectionData = null;  // 当前查看的 collection 对象（用于 goBack）
    let _collectionTree = null;         // /api/collections 返回的完整树缓存

    // 嵌入式歌词状态
    let _embeddedLyricsOpen = false;
    let _embeddedLyricsLines = [];
    let _embeddedLyricsIdx = -1;

    // ========== DOM 引用 ==========
    let $ = {};

    function cacheDom() {
        // 侧边栏
        $.sidebar = document.getElementById('sidebar');
        $.sidebarNav = document.getElementById('sidebarNav');
        $.sidebarTags = document.getElementById('sidebarTags');
        $.sidebarFavCount = document.getElementById('sidebarFavCount');
        $.sidebarUser = document.getElementById('sidebarUser');
        $.btnLogin = document.getElementById('btnLogin');
        $.userMenuWrap = document.getElementById('userMenuWrap');
        $.btnUserAvatar = document.getElementById('btnUserAvatar');
        $.sidebarAvatarImg = document.getElementById('sidebarAvatarImg');
        $.sidebarAvatarPH = document.getElementById('sidebarAvatarPH');
        $.btnUserLabel = document.getElementById('btnUserLabel');
        $.userDropdown = document.getElementById('userDropdown');

        // 顶部栏
        $.btnMenu = document.getElementById('btnMenu');
        $.topBar = document.getElementById('topBar');
        $.searchInput = document.getElementById('searchInput');
        $.searchClear = document.getElementById('searchClear');
        $.searchDropdown = document.getElementById('searchDropdown');

        // 内容区
        $.contentArea = document.getElementById('contentArea');
        $.viewHeader = document.getElementById('viewHeader');
        $.viewTitle = document.getElementById('viewTitle');
        $.btnBack = document.getElementById('btnBack');
        $.sectionHeader = document.getElementById('sectionHeader');
        $.viewContainer = document.getElementById('viewContainer');

        // 沉浸式 Now Playing
        $.npoOverlay = document.getElementById('nowPlayingOverlay');
        $.npoBackdrop = document.getElementById('npoBackdrop');
        $.npoCover = document.getElementById('npoCover');
        $.npoTitle = document.getElementById('npoTitle');
        $.npoSinger = document.getElementById('npoSinger');
        $.npoTimeCurrent = document.getElementById('npoTimeCurrent');
        $.npoTimeTotal = document.getElementById('npoTimeTotal');
        $.npoProgressWrap = document.getElementById('npoProgressWrap');
        $.npoProgressFill = document.getElementById('npoProgressFill');
        $.npoBtnPlay = document.getElementById('npoBtnPlay');
        $.npoBtnFav = document.getElementById('npoBtnFav');
        $.npoBtnAddPl = document.getElementById('npoBtnAddPl');

        // 播放栏
        $.playerBar = document.getElementById('playerBar');
        $.playerCover = document.getElementById('playerCover');
        $.playerCoverPH = document.getElementById('playerCoverPH');
        $.nowPlayingTitle = document.getElementById('nowPlayingTitle');
        $.nowPlayingSinger = document.getElementById('nowPlayingSinger');
        $.btnPlay = document.getElementById('btnPlay');
        $.btnMode = document.getElementById('btnMode');
        $.btnLyrics = document.getElementById('btnLyrics');
        $.timeCurrent = document.getElementById('timeCurrent');
        $.timeTotal = document.getElementById('timeTotal');
        $.progressWrap = document.getElementById('progressWrap');
        $.progressFill = document.getElementById('progressFill');

        // 音量
        $.btnVolume = document.getElementById('btnVolume');
        $.volumePopup = document.getElementById('volumePopup');
        $.volumeSlider = document.getElementById('volumeSlider');

        // 抽屉（平板）
        $.drawerOverlay = document.getElementById('drawerOverlay');
        $.drawerSheet = document.getElementById('drawerSheet');
        $.drawerContent = document.getElementById('drawerContent');
        $.drawerFav = document.getElementById('drawerFav');
        $.drawerPl = document.getElementById('drawerPl');
        $.fabDrawer = document.getElementById('fabDrawer');

        // 嵌入式歌词面板
        $.lyricsPanel = document.getElementById('lyricsPanel');
        $.lyricsPanelBody = document.getElementById('lyricsPanelBody');
        $.embeddedLyricsTitle = document.getElementById('embeddedLyricsTitle');
        $.embeddedLyricsSinger = document.getElementById('embeddedLyricsSinger');
        $.btnLyricsClose = document.getElementById('btnLyricsClose');
        $.btnLyricsPopout = document.getElementById('btnLyricsPopout');

        // Modal
        $.modalOverlay = document.getElementById('modalOverlay');
        $.modalTitle = document.getElementById('modalTitle');
        $.modalBody = document.getElementById('modalBody');
        $.modalActions = document.getElementById('modalActions');
    }

    // ========== 工具函数 ==========
    function formatTime(sec) {
        if (!sec || !isFinite(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function h(html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstChild;
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    function mergeToCache(songs) {
        (songs || []).forEach(s => { _songCache[s.id] = s; });
    }

    // ========== 嵌入式歌词：LRC 解析 ==========

    function parseLRCEmbedded(lrcText) {
        if (!lrcText) return [];
        const result = [];
        const lines = lrcText.split('\n');
        const timeRe = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
        for (const line of lines) {
            const m = line.match(timeRe);
            if (!m) continue;
            const minutes = parseInt(m[1], 10);
            const seconds = parseInt(m[2], 10);
            const ms = parseInt(m[3].padEnd(3, '0'), 10);
            const time = minutes * 60 + seconds + ms / 1000;
            const text = m[4].trim();
            if (text) {
                result.push({ time, text });
            }
        }
        result.sort((a, b) => a.time - b.time);
        return result;
    }

    // ========== 封面图辅助 ==========
    function getCoverUrl(song) {
        return song.cover_url || '';
    }

    function getCoverFallbackColor(index) {
        const colors = ['var(--song-1)', 'var(--song-2)', 'var(--song-3)', 'var(--song-4)'];
        return colors[(index || 0) % colors.length];
    }

    // ========== 封面卡片网格 ==========
    function renderCoverGrid(songs) {
        if (!songs || !songs.length) {
            return '<div class="empty-state"><span class="empty-icon">🎵</span>暂无歌曲</div>';
        }
        mergeToCache(songs);

        let html = '<div class="cover-grid">';
        songs.forEach((song, i) => {
            const cover = getCoverUrl(song);
            const coverHTML = cover
                ? `<img class="cover-card-img" src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
                : '';
            const phHTML = cover
                ? `<div class="cover-card-placeholder" style="display:none;background:${getCoverFallbackColor(i)}">🎵</div>`
                : `<div class="cover-card-placeholder" style="background:${getCoverFallbackColor(i)}">🎵</div>`;

            html += `
            <div class="cover-card ${song.playing ? 'playing' : ''}" data-song-index="${i}" style="--stagger-index:${Math.min(i, 19)}">
                <div class="cover-card-img-wrap">
                    ${coverHTML}${phHTML}
                    <div class="cover-card-play-overlay">
                        <div class="play-icon-circle">▶</div>
                    </div>
                </div>
                <div class="cover-card-title">${escapeHtml(song.title)}</div>
                <div class="cover-card-singer">${escapeHtml(song.singer || '')}</div>
                <button class="cover-card-fav ${(song._fav || song.is_favorite) ? 'favorited' : ''}" data-action="toggle-fav" data-song-id="${song.id}">${(song._fav || song.is_favorite) ? '❤️' : '♡'}</button>
            </div>`;
        });
        html += '</div>';
        return html;
    }

    // ========== 歌曲列表（搜索/收藏/歌单用） ==========
    function renderSongList(songs) {
        if (!songs || !songs.length) {
            return '<div class="empty-state"><span class="empty-icon">🎵</span>暂无歌曲</div>';
        }
        mergeToCache(songs);

        let html = '<div class="song-list">';
        songs.forEach((song, i) => {
            const cover = getCoverUrl(song);
            const isFav = song._fav || song.is_favorite;
            html += `
            <div class="song-list-item ${song.playing ? 'playing' : ''}" data-song-index="${i}" style="--stagger-index:${Math.min(i, 19)}">
                ${cover
                    ? `<img class="song-list-cover" src="${escapeHtml(cover)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
                    : ''}
                <div class="song-list-placeholder" style="${cover ? 'display:none' : ''};background:${getCoverFallbackColor(i)}">🎵</div>
                <div class="song-list-index">${i + 1}</div>
                <div class="song-list-info">
                    <div class="song-list-title">${escapeHtml(song.title)}</div>
                    <div class="song-list-meta">${escapeHtml(song.singer || '')} · ${formatTime(song.duration)}</div>
                </div>
                <div class="song-list-actions">
                    <button class="btn-fav ${isFav ? 'favorited' : ''}" data-action="toggle-fav" data-song-id="${song.id}">${isFav ? '❤️' : '♡'}</button>
                    <button class="btn-add" data-action="show-add-to-playlist" data-song-id="${song.id}">+</button>
                </div>
            </div>`;
        });
        html += '</div>';
        return html;
    }

    // ========== 歌曲汇总：分类卡片渲染 ==========
    const COLLECTION_ICONS = {
        '热歌榜单': '🔥', 'KTV必点': '🎤', '华语流行': '🎵', '欧美音乐': '🌍',
        '粤语经典': '🇭🇰', '古风国风': '🏮', '民谣': '🪕', '纯音乐': '🎹',
        '经典怀旧': '📻', '网络神曲': '🌐', '歌手专区': '🎙️', '主题歌单': '📋',
    };

    function getCollectionBgStyle(name, seed) {
        const typeMap = {
            '热歌榜单': 0, 'KTV必点': 8, '华语流行': 3, '欧美音乐': 10,
            '粤语经典': 5, '古风国风': 4, '民谣': 7, '纯音乐': 14,
            '经典怀旧': 2, '网络神曲': 12, '歌手专区': 6, '主题歌单': 1,
        };
        const type = typeMap[name] !== undefined ? typeMap[name] : 0;
        return `background-image: url('https://www.yumus.cn/api/?target=img&brand=360&type=${type}&_=${seed}')`;
    }

    // ========== 骨架屏 HTML 生成器 ==========
    function renderSkeletonCollectionGrid() {
        let html = '<div class="tag-grid">';
        for (let i = 0; i < 12; i++) {
            html += `<div class="skeleton skeleton-card" style="--stagger-index:${i};animation-delay:${i * 0.03}s"></div>`;
        }
        html += '</div>';
        return html;
    }

    function renderSkeletonCoverGrid(count) {
        let html = '<div class="cover-grid">';
        for (let i = 0; i < Math.min(count || 6, 20); i++) {
            html += `<div class="skeleton skeleton-cover-card" style="--stagger-index:${i};animation-delay:${i * 0.03}s"></div>`;
        }
        html += '</div>';
        return html;
    }

    function renderCollectionGrid(collections) {
        if (!collections || !collections.length) {
            return '<div class="empty-state"><span class="empty-icon">📊</span>暂无分类</div>';
        }
        let html = '<div class="tag-grid">';
        collections.forEach((c, i) => {
            const icon = COLLECTION_ICONS[c.name] || '🎵';
            const bgStyle = getCollectionBgStyle(c.name, i * 47 + 13);
            html += `
            <div class="tag-card tag-card--image" style="--tag-color:${getCoverFallbackColor(i)};--stagger-index:${Math.min(i, 19)};${bgStyle};background-size:cover;background-position:center" data-action="navigate-collection-item" data-collection-id="${c.id}">
                <div class="tag-card-name">${icon} ${escapeHtml(c.name)}</div>
            </div>`;
        });
        html += '</div>';
        return html;
    }

    function renderCollectionItemsGrid(items, collectionName) {
        if (!items || !items.length) {
            return `<div class="empty-state"><span class="empty-icon">📋</span>${escapeHtml(collectionName)}暂无子分类</div>`;
        }
        let html = '<div class="tag-grid">';
        items.forEach((it, i) => {
            const songCount = (it.song_count || 0) > 0 ? ` · ${it.song_count}首` : '';
            const hasBvid = !!it.bvid;
            const hasSongs = it.song_count > 0;
            const action = hasBvid ? 'navigate-collection-songs' : '';
            const bgColor = getCoverFallbackColor(i);
            const bgStyle = hasBvid
                ? `background-image:url('https://www.yumus.cn/api/?target=img&brand=360&type=${i % 15}&_=${i * 37 + 7}');background-size:cover;background-position:center`
                : '';
            html += `
            <div class="tag-card tag-card--image ${!hasBvid ? 'tag-card--empty' : ''}" style="--tag-color:${bgColor};--stagger-index:${Math.min(i, 19)};${bgStyle}" data-action="${action}" data-bvid="${escapeHtml(it.bvid || '')}" data-item-title="${escapeHtml(it.title)}">
                <div class="tag-card-name">${escapeHtml(it.title)}${songCount}</div>
            </div>`;
        });
        html += '</div>';
        return html;
    }

    // ========== 视图导航 ==========
    function updateViewHeader(show, title) {
        $.viewHeader.style.display = show ? 'flex' : 'none';
        $.viewTitle.textContent = title || '';
        $.sectionHeader.style.display = show ? 'none' : '';
    }

    function goBack() {
        if (_currentView === 'collection-songs') {
            if (_currentCollectionData) {
                navigateToCollectionItems(_currentCollectionData.id);
            } else {
                navigateToCollection();
            }
        } else if (_currentView === 'collection-items') {
            navigateToCollection();
        } else if (_currentView === 'collection') {
            navigateHome();
        } else if (_currentView === 'search') {
            $.searchInput.value = '';
            $.searchClear.style.display = 'none';
            navigateHome();
        } else if (_currentView === 'favorites') {
            navigateHome();
        } else if (_currentView === 'playlists') {
            navigateHome();
        }
    }

    function navigateHome() {
        _currentView = 'home';
        _currentCollectionData = null;
        updateViewHeader(false, '');
        $.sectionHeader.style.display = '';
        $.sectionHeader.textContent = '🎵 推荐歌曲';
        $.viewContainer.innerHTML = renderCoverGrid(_defaultSongs);
        bindCardClicks();
        setActiveSidebarNav('home');
        window._currentSongs = _defaultSongs;
        window._currentPlaylist = null;
    }

    // ========== 歌曲汇总导航 ==========
    async function navigateToCollection() {
        _currentView = 'collection';
        _currentCollectionData = null;
        updateViewHeader(false, '');
        $.sectionHeader.style.display = '';
        $.sectionHeader.textContent = '📊 歌曲汇总';
        setActiveSidebarNav('collection');
        $.viewContainer.innerHTML = renderSkeletonCollectionGrid();

        try {
            const resp = await fetch('/api/collections');
            if (!resp.ok) throw new Error('加载失败');
            const data = await resp.json();
            _collectionTree = data.collections || [];
            $.viewContainer.innerHTML = renderCollectionGrid(_collectionTree);
        } catch (e) {
            $.viewContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span>加载失败<br><small>${escapeHtml(e.message)}</small></div>`;
        }
    }

    function navigateToCollectionItems(collId) {
        if (!_collectionTree) return;
        const coll = _collectionTree.find(c => c.id === collId);
        if (!coll) return;

        _currentView = 'collection-items';
        _currentCollectionData = coll;
        updateViewHeader(true, coll.name);
        $.viewContainer.innerHTML = renderCollectionItemsGrid(coll.items, coll.name);
    }

    async function navigateToCollectionSongs(bvid, title) {
        if (!bvid) return;

        _currentView = 'collection-songs';
        updateViewHeader(true, title);

        $.viewContainer.innerHTML = renderSkeletonCoverGrid(6);

        try {
            const resp = await fetch(`/api/songs?bvid=${encodeURIComponent(bvid)}&limit=300`);
            if (!resp.ok) throw new Error('加载失败');
            const songs = await resp.json();
            if (!songs || !songs.length) {
                $.viewContainer.innerHTML = '<div class="empty-state"><span class="empty-icon">🎵</span>暂无歌曲</div>';
                return;
            }
            window._currentSongs = songs;
            window._currentPlaylist = null;
            $.viewContainer.innerHTML = renderCoverGrid(songs);
            bindCardClicks();
        } catch (e) {
            $.viewContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span>加载失败<br><small>${escapeHtml(e.message)}</small></div>`;
        }
    }

    // ========== 事件委托: collection 快捷导航 ==========
    async function navigateToCollectionBySlug(slug) {
        // 确保 collection tree 已加载
        if (!_collectionTree) {
            try {
                const resp = await fetch('/api/collections');
                if (!resp.ok) throw new Error('加载失败');
                const data = await resp.json();
                _collectionTree = data.collections || [];
            } catch (e) {
                console.error('[collection shortcut]', e.message);
                return;
            }
        }
        const coll = _collectionTree.find(c => c.slug === slug);
        if (coll) {
            navigateToCollectionItems(coll.id);
        }
    }

    function setActiveSidebarNav(navId) {
        document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
        const active = document.querySelector(`.sidebar-item[data-nav="${navId}"]`);
        if (active) active.classList.add('active');
    }

    // ========== 侧边栏收藏/歌单视图 ==========
    function renderFavoritesInContent() {
        _currentView = 'favorites';
        updateViewHeader(true, '⭐ 我的收藏');
        setActiveSidebarNav('favorites');

        const favs = PlaylistStore.getFavorites();
        if (!favs || !favs.length) {
            $.viewContainer.innerHTML = '<div class="empty-state"><span class="empty-icon">⭐</span>还没有收藏歌曲<br><small>点击歌曲旁的 ♡ 按钮添加</small></div>';
            return;
        }
        const songs = favs.map((f, i) => ({ ...f, _fav: true }));
        window._currentSongs = songs;
        window._currentPlaylist = null;

        let html = '<button class="btn-play-all" data-action="play-all-favs">▶ 播放全部收藏</button>';
        html += renderSongList(songs);
        $.viewContainer.innerHTML = html;
        bindCardClicks();
    }

    function renderPlaylistsInContent() {
        _currentView = 'playlists';
        updateViewHeader(true, '📋 我的歌单');
        setActiveSidebarNav('playlists');
        renderPlaylists();
    }

    function startRename(plId) {
        // 防止重复打开
        if (document.querySelector('.pl-name-input')) return;

        const nameEl = document.querySelector(`.pl-name[data-pl-id="${plId}"]`);
        if (!nameEl) return;

        const oldName = nameEl.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'pl-name-input';
        input.value = oldName;
        input.maxLength = 100;
        nameEl.replaceWith(input);
        input.focus();
        input.select();

        const commit = async () => {
            const newName = input.value.trim();
            if (!newName || newName === oldName) {
                // 恢复原样
                input.replaceWith(nameEl);
                return;
            }
            try {
                await PlaylistStore.renamePlaylist(plId, newName);
            } catch (e) {
                alert(e.message);
                // PlaylistStore.onChange 会触发 refreshAll → renderPlaylistsInContent
            }
        };

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.value = oldName; input.blur(); }
        });
        input.addEventListener('blur', commit);
    }

    function renderPlaylists() {
        const pls = PlaylistStore.getPlaylists();
        if (!pls || !pls.length) {
            $.viewContainer.innerHTML = `
                <div class="empty-state"><span class="empty-icon">📋</span>还没有歌单<br><small>点击下方按钮创建第一个歌单</small></div>
                <button class="btn-new-pl" data-action="new-playlist">+ 新建歌单</button>`;
            return;
        }
        let html = '<div class="song-list">';
        pls.forEach(pl => {
            html += `
            <div class="playlist-item" data-action="open-playlist" data-pl-id="${pl.id}">
                <span style="font-size:20px">📋</span>
                <span class="pl-name" data-action="rename-playlist" data-pl-id="${pl.id}" title="点击改名">${escapeHtml(pl.name)}</span>
                <span class="pl-count">${pl.song_count || 0} 首</span>
                <button class="btn-delete" data-action="delete-playlist" data-pl-id="${pl.id}">🗑</button>
            </div>`;
        });
        html += '</div>';
        html += '<button class="btn-new-pl" data-action="new-playlist">+ 新建歌单</button>';
        $.viewContainer.innerHTML = html;
    }

    // ========== 播放栏 ==========
    function updatePlayBar(song) {
        if (!song) {
            $.nowPlayingTitle.textContent = '未在播放';
            $.nowPlayingSinger.textContent = '';
            $.playerCover.style.display = 'none';
            $.playerCoverPH.style.display = 'flex';
            $.playerCoverPH.textContent = '🎵';
            return;
        }
        $.nowPlayingTitle.textContent = song.title;
        $.nowPlayingSinger.textContent = song.singer || '';

        const cover = getCoverUrl(song);
        if (cover) {
            $.playerCover.src = cover;
            $.playerCover.style.display = '';
            $.playerCoverPH.style.display = 'none';
        } else {
            $.playerCover.style.display = 'none';
            $.playerCoverPH.style.display = 'flex';
            $.playerCoverPH.textContent = '🎵';
        }
    }

    function updateProgress(data) {
        if (data.duration > 0) {
            const pct = (data.currentTime / data.duration) * 100;
            $.progressFill.style.width = pct + '%';
            $.npoProgressFill.style.width = pct + '%';
        }
        $.timeCurrent.textContent = formatTime(data.currentTime);
        $.npoTimeCurrent.textContent = formatTime(data.currentTime);
    }

    function updateDuration(dur) {
        $.timeTotal.textContent = formatTime(dur);
        $.npoTimeTotal.textContent = formatTime(dur);
    }

    const MODE_ICONS = {
        'loop-all': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2 7 7 2 12 7"/><path d="M7 22V2"/><polyline points="22 17 17 22 12 17"/><path d="M17 2v20"/></svg>`,
        'loop-single': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12C2 6.5 6.5 2 12 2s10 4.5 10 10-4.5 10-10 10"/><polyline points="2 8 2 12 6 12"/><text x="18" y="13" text-anchor="middle" font-size="8" fill="currentColor" stroke="none" font-weight="700">1</text></svg>`,
        'shuffle': `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,
    };

    const VOLUME_ICONS = {
        high: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`,
        medium: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
        low: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/></svg>`,
        mute: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`,
    };

    function updateModeDisplay() {
        const mode = Player.getMode();
        $.btnMode.innerHTML = MODE_ICONS[mode] || MODE_ICONS['loop-all'];
        $.btnMode.className = 'btn-ctrl btn-mode';
        if (mode === 'loop-all') { $.btnMode.classList.add('loop-all'); $.btnMode.title = '列表循环'; }
        if (mode === 'loop-single') { $.btnMode.classList.add('loop-single'); $.btnMode.title = '单曲循环'; }
        if (mode === 'shuffle') { $.btnMode.classList.add('shuffle'); $.btnMode.title = '随机播放'; }
    }

    function updateVolumeIcon() {
        const v = Player.getVolume();
        let icon;
        if (v === 0) icon = VOLUME_ICONS.mute;
        else if (v < 0.3) icon = VOLUME_ICONS.low;
        else if (v < 0.6) icon = VOLUME_ICONS.medium;
        else icon = VOLUME_ICONS.high;
        $.btnVolume.innerHTML = icon;
    }

    function updatePlayButton(playing) {
        $.btnPlay.textContent = playing ? '⏸' : '▶';
        $.npoBtnPlay.textContent = playing ? '⏸' : '▶';
    }

    // ========== 沉浸式 Now Playing ==========
    function openNowPlaying() {
        const song = Player.getCurrentSong();
        if (!song) return;

        $.npoTitle.textContent = song.title;
        $.npoSinger.textContent = song.singer || '';

        const cover = getCoverUrl(song);
        if (cover) {
            $.npoCover.src = cover;
            // 用封面主色设置背景渐变
            $.npoBackdrop.style.background = `radial-gradient(ellipse at center, rgba(77,184,141,0.08) 0%, rgba(0,0,0,0.55) 70%)`;
        } else {
            $.npoCover.src = '';
            $.npoBackdrop.style.background = `radial-gradient(ellipse at center, rgba(77,184,141,0.06) 0%, rgba(0,0,0,0.55) 70%)`;
        }

        const isFav = PlaylistStore.isFavorite(song.id);
        $.npoBtnFav.textContent = isFav ? '❤️ 已收藏' : '♡ 收藏';
        $.npoBtnFav.dataset.songId = song.id;
        $.npoBtnAddPl.dataset.songId = song.id;

        $.npoOverlay.style.display = 'flex';
        updatePlayButton(Player.getIsPlaying());
    }

    function closeNowPlaying() {
        $.npoOverlay.style.display = 'none';
    }

    function updateNowPlayingFav(songId) {
        if ($.npoOverlay.style.display === 'flex') {
            const isFav = PlaylistStore.isFavorite(songId);
            $.npoBtnFav.textContent = isFav ? '❤️ 已收藏' : '♡ 收藏';
        }
    }

    // ========== 刷新 ==========
    function refreshAll() {
        // 更新侧边栏收藏计数
        if (Auth.isLoggedIn()) {
            const favs = PlaylistStore.getFavorites();
            if ($.sidebarFavCount) {
                $.sidebarFavCount.textContent = favs.length;
                $.sidebarFavCount.style.display = favs.length > 0 ? '' : 'none';
            }
        }

        // 更新封面卡片中的 fav 状态
        document.querySelectorAll('.cover-card-fav').forEach(btn => {
            const sid = parseInt(btn.dataset.songId);
            if (sid) {
                const isFav = PlaylistStore.isFavorite(sid);
                btn.classList.toggle('favorited', isFav);
                btn.textContent = isFav ? '❤️' : '♡';
            }
        });

        // 更新列表中的 fav 按钮
        document.querySelectorAll('.song-list-actions .btn-fav').forEach(btn => {
            const sid = parseInt(btn.dataset.songId);
            if (sid) {
                const isFav = PlaylistStore.isFavorite(sid);
                btn.classList.toggle('favorited', isFav);
                btn.textContent = isFav ? '❤️' : '♡';
            }
        });

        // 更新沉浸式视图
        const currentSong = Player.getCurrentSong();
        if (currentSong) updateNowPlayingFav(currentSong.id);

        updateAuthUI();
    }

    // ========== Auth UI ==========
    function updateAuthUI() {
        if (Auth.isLoggedIn()) {
            const user = Auth.getUser();
            $.btnLogin.style.display = 'none';
            $.userMenuWrap.style.display = '';
            $.btnUserLabel.textContent = user.username || '用户';

            // 头像
            if (user.avatar_url) {
                $.sidebarAvatarImg.src = user.avatar_url;
                $.sidebarAvatarImg.style.display = '';
                $.sidebarAvatarPH.style.display = 'none';
            } else {
                $.sidebarAvatarImg.style.display = 'none';
                $.sidebarAvatarPH.style.display = '';
                $.sidebarAvatarPH.textContent = (user.username || '用')[0];
            }

            if ($.sidebarFavCount) {
                const favs = PlaylistStore.getFavorites();
                $.sidebarFavCount.textContent = favs.length;
                $.sidebarFavCount.style.display = favs.length > 0 ? '' : 'none';
            }
        } else {
            $.btnLogin.style.display = '';
            $.userMenuWrap.style.display = 'none';
            if ($.sidebarFavCount) $.sidebarFavCount.style.display = 'none';
        }
    }

    // ========== Modal ==========
    function showModal(title, bodyHTML, actionsHTML) {
        $.modalTitle.textContent = title;
        $.modalBody.innerHTML = bodyHTML;
        $.modalActions.innerHTML = actionsHTML;
        $.modalOverlay.classList.add('show');
    }

    function hideModal() {
        $.modalOverlay.classList.remove('show');
    }

    // ========== 搜索 ==========
    function setupSearch() {
        // 输入时仅更新 UI（显示/隐藏清除按钮、搜索历史下拉），不自动搜索
        $.searchInput.addEventListener('input', () => {
            const q = $.searchInput.value.trim();
            $.searchClear.style.display = q ? '' : 'none';

            if (!q) {
                $.searchDropdown.style.display = 'none';
                // 恢复默认视图
                if (_currentView === 'search') navigateHome();
                return;
            }

            // 搜索历史下拉
            const history = PlaylistStore.getSearchHistory();
            if (history.length && document.activeElement === $.searchInput) {
                renderSearchDropdown(history);
            }
        });

        // Enter 键触发搜索
        $.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const q = $.searchInput.value.trim();
                if (q) {
                    $.searchDropdown.style.display = 'none';
                    doSearch(q);
                }
            }
        });

        $.searchInput.addEventListener('focus', () => {
            const q = $.searchInput.value.trim();
            const history = PlaylistStore.getSearchHistory();
            if (!q && history.length) renderSearchDropdown(history);
        });

        $.searchInput.addEventListener('blur', () => {
            setTimeout(() => { $.searchDropdown.style.display = 'none'; }, 200);
        });

        $.searchClear.addEventListener('click', () => {
            $.searchInput.value = '';
            $.searchClear.style.display = 'none';
            $.searchDropdown.style.display = 'none';
            if (_currentView === 'search') navigateHome();
        });

        // 确认按钮触发搜索
        const confirmBtn = document.getElementById('searchConfirm');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                const q = $.searchInput.value.trim();
                if (q) {
                    $.searchDropdown.style.display = 'none';
                    doSearch(q);
                }
            });
        }
    }

    function renderSearchDropdown(history) {
        if (!history.length) { $.searchDropdown.style.display = 'none'; return; }
        $.searchDropdown.innerHTML = `
            <div class="shd-header">
                <span>最近搜索</span>
                <button class="shd-clear" data-action="clear-search-history">清除</button>
            </div>
            ${history.slice(0, 8).map(q => `
                <div class="shd-item" data-action="search-history" data-query="${escapeHtml(q)}">
                    <span style="color:var(--text-tertiary)">🕐</span>
                    <span class="shd-query">${escapeHtml(q)}</span>
                </div>
            `).join('')}
        `;
        $.searchDropdown.style.display = '';
    }

    async function doSearch(q) {
        _currentView = 'search';
        updateViewHeader(true, '🔍 搜索: ' + q);
        setActiveSidebarNav('');

        try {
            const resp = await fetch('/api/search?q=' + encodeURIComponent(q));
            if (!resp.ok) throw new Error('搜索失败');
            const data = await resp.json();
            const results = data.results || [];

            PlaylistStore.addSearchHistory(q);

            if (!results.length) {
                // 无结果 — 记录搜索日志
                fetch('/api/search-log', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: q, searched_at: new Date().toISOString() }),
                }).catch(() => {});
                $.viewContainer.innerHTML = `
                    <div class="empty-state search-empty">
                        <span class="empty-icon">🔍</span>
                        没有找到 "<strong>${escapeHtml(q)}</strong>" 的相关歌曲
                    </div>`;
                return;
            }

            window._currentSongs = results;
            window._currentPlaylist = null;
            $.viewContainer.innerHTML = renderSongList(results);
            bindCardClicks();
        } catch (e) {
            $.viewContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span>搜索出错<br><small>${escapeHtml(e.message)}</small></div>`;
        }
    }

    // ========== 歌词窗口 ==========
    function openLyricsWindow() {
        const song = Player.getCurrentSong();
        if (!song || !song.id) return;
        if (lyricsWindow && !lyricsWindow.closed) {
            lyricsWindow.focus();
            return;
        }
        lyricsWindow = window.open(
            'lyrics.html?songId=' + song.id,
            'music_player_lyrics',
            'width=360,height=520'
        );
    }

    function closeLyricsWindow() {
        if (lyricsWindow && !lyricsWindow.closed) {
            lyricsWindow.close();
        }
        lyricsWindow = null;
    }

    // ========== 嵌入式歌词面板 ==========

    async function fetchLyricsEmbedded(songId) {
        try {
            const resp = await fetch(`/api/lyrics/${songId}`);
            if (!resp.ok) {
                _embeddedLyricsLines = [];
                _embeddedLyricsIdx = -1;
                renderLyricsEmbedded();
                return;
            }
            const data = await resp.json();
            if ($.embeddedLyricsTitle) {
                $.embeddedLyricsTitle.textContent = data.title || '歌词';
            }
            if ($.embeddedLyricsSinger) {
                $.embeddedLyricsSinger.textContent = data.singer || '';
            }
            _embeddedLyricsLines = parseLRCEmbedded(data.lrc_text);
            _embeddedLyricsIdx = -1;
            renderLyricsEmbedded();
        } catch (err) {
            console.error('[lyrics-embedded] 加载歌词失败:', err);
            _embeddedLyricsLines = [];
            _embeddedLyricsIdx = -1;
            renderLyricsEmbedded();
        }
    }

    function renderLyricsEmbedded() {
        const body = $.lyricsPanelBody;
        if (!body) return;

        if (_embeddedLyricsLines.length === 0) {
            body.innerHTML = `
                <div class="lyrics-empty">
                    <div class="empty-icon">🎵</div>
                    <div>暂无歌词</div>
                </div>`;
            return;
        }

        // 竖版模式：≈10 行，当前行居中
        const visibleCount = 10;
        const halfCount = Math.floor(visibleCount / 2);
        let startIdx = Math.max(0, _embeddedLyricsIdx - halfCount);
        let endIdx = Math.min(_embeddedLyricsLines.length, startIdx + visibleCount);
        if (endIdx - startIdx < visibleCount) {
            startIdx = Math.max(0, endIdx - visibleCount);
        }

        const visibleLines = _embeddedLyricsLines.slice(startIdx, endIdx);

        body.innerHTML = visibleLines.map((l, i) => {
            const globalIdx = startIdx + i;
            const cls = globalIdx === _embeddedLyricsIdx ? 'lyric-line active' : 'lyric-line';
            return `<div class="${cls}" data-idx="${globalIdx}">${escapeHtml(l.text)}</div>`;
        }).join('');

        autoResizeEmbeddedLyrics();
    }

    function syncLyricsEmbedded(currentSec) {
        if (_embeddedLyricsLines.length === 0) return;

        // 二分查找：最后一个 time <= currentSec 的行
        let lo = 0, hi = _embeddedLyricsLines.length - 1;
        let found = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (_embeddedLyricsLines[mid].time <= currentSec) {
                found = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        if (found !== _embeddedLyricsIdx) {
            _embeddedLyricsIdx = found;
            renderLyricsEmbedded();
        }
    }

    function autoResizeEmbeddedLyrics() {
        const body = $.lyricsPanelBody;
        if (!body) return;
        const h = body.clientHeight;
        const lineHeight = Math.max(28, Math.min(50, h / 10));
        const activeSize = Math.max(14, lineHeight * 0.52);
        const baseSize = Math.max(12, lineHeight * 0.38);
        body.style.setProperty('--v-active-size', Math.round(activeSize) + 'px');
        body.style.setProperty('--v-base-size', Math.round(baseSize) + 'px');
    }

    function openLyricsPanel() {
        if (!$.lyricsPanel) return;
        _embeddedLyricsOpen = true;
        $.lyricsPanel.classList.add('open');

        const song = Player.getCurrentSong();
        if (song && song.id) {
            fetchLyricsEmbedded(song.id);
        } else {
            $.lyricsPanelBody.innerHTML = `
                <div class="lyrics-empty">
                    <div class="empty-icon">🎵</div>
                    <div>等待播放...</div>
                </div>`;
        }
    }

    function closeLyricsPanel() {
        _embeddedLyricsOpen = false;
        if ($.lyricsPanel) $.lyricsPanel.classList.remove('open');
    }

    function toggleLyricsPanel() {
        if (_embeddedLyricsOpen) {
            closeLyricsPanel();
        } else {
            openLyricsPanel();
        }
    }

    function popoutLyricsEmbedded() {
        const song = Player.getCurrentSong();
        if (!song || !song.id) return;
        if (lyricsWindow && !lyricsWindow.closed) {
            lyricsWindow.focus();
            return;
        }
        lyricsWindow = window.open(
            'lyrics.html?songId=' + song.id,
            'music_player_lyrics',
            'width=360,height=520'
        );
    }

    // ========== 平板底部抽屉 ==========
    function openDrawer(tab = 'fav') {
        const source = tab === 'fav' ? document.getElementById('drawerFav') : document.getElementById('drawerPl');
        // 同步从侧边栏数据刷新
        if (tab === 'fav' && Auth.isLoggedIn()) {
            const favs = PlaylistStore.getFavorites();
            source.innerHTML = favs.length
                ? renderSongList(favs.map((f, i) => ({ ...f, _fav: true })))
                : '<div class="empty-state"><span class="empty-icon">⭐</span>还没有收藏</div>';
        }
        if (tab === 'pl' && Auth.isLoggedIn()) {
            source.innerHTML = renderPlaylistsInDrawer();
        }
        $.drawerContent.innerHTML = '';
        $.drawerContent.appendChild(source.cloneNode(true));

        // 更新 tab 样式
        document.querySelectorAll('.drawer-tab').forEach(t => t.classList.remove('active'));
        const activeTab = document.querySelector(`.drawer-tab[data-drawer-tab="${tab}"]`);
        if (activeTab) activeTab.classList.add('active');

        // 显示
        $.drawerOverlay.style.display = '';
        $.drawerSheet.style.display = '';
        requestAnimationFrame(() => {
            $.drawerOverlay.classList.add('show');
            $.drawerSheet.classList.add('show');
        });
    }

    function renderPlaylistsInDrawer() {
        const pls = PlaylistStore.getPlaylists();
        if (!pls || !pls.length) {
            return '<div class="empty-state"><span class="empty-icon">📋</span>还没有歌单</div>';
        }
        return pls.map(pl => `
            <div class="playlist-item" data-action="open-playlist" data-pl-id="${pl.id}">
                <span style="font-size:20px">📋</span>
                <span class="pl-name">${escapeHtml(pl.name)}</span>
                <span class="pl-count">${pl.song_count || 0} 首</span>
            </div>
        `).join('');
    }

    function closeDrawer() {
        $.drawerOverlay.classList.remove('show');
        $.drawerSheet.classList.remove('show');
        setTimeout(() => {
            $.drawerOverlay.style.display = '';
            $.drawerSheet.style.display = '';
        }, 400);
    }

    // ========== 卡片点击绑定 ==========
    function bindCardClicks() {
        // 封面卡片点击 → 播放
        document.querySelectorAll('.cover-card').forEach(card => {
            card.addEventListener('click', (e) => {
                // 不拦截按钮点击
                if (e.target.closest('button')) return;
                const idx = parseInt(card.dataset.songIndex);
                if (!isNaN(idx) && window._currentSongs) {
                    Player.playAll(window._currentSongs, idx);
                }
            });
        });

        // 列表行点击 → 播放
        document.querySelectorAll('.song-list-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                const idx = parseInt(item.dataset.songIndex);
                if (!isNaN(idx) && window._currentSongs) {
                    Player.playAll(window._currentSongs, idx);
                }
            });
        });
    }

    // ========== Event Delegation ==========
    function setupGlobalDelegation() {
        document.body.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;

            // === 导航 ===
            if (action === 'nav-home') {
                e.preventDefault();
                navigateHome();
                return;
            }
            if (action === 'nav-favorites') {
                e.preventDefault();
                if (!Auth.isLoggedIn()) { showAuthModal(); return; }
                renderFavoritesInContent();
                bindCardClicks();
                return;
            }
            if (action === 'nav-playlists') {
                e.preventDefault();
                if (!Auth.isLoggedIn()) { showAuthModal(); return; }
                renderPlaylistsInContent();
                return;
            }
            if (action === 'nav-collection') {
                e.preventDefault();
                await navigateToCollection();
                return;
            }
            if (action === 'nav-collection-hot') {
                e.preventDefault();
                await navigateToCollectionBySlug('hot-songs');
                return;
            }
            if (action === 'nav-collection-classic') {
                e.preventDefault();
                await navigateToCollectionBySlug('jing-dian-huai-jiu');
                return;
            }
            if (action === 'nav-collection-yueyu') {
                e.preventDefault();
                await navigateToCollectionBySlug('yue-yu-jing-dian');
                return;
            }
            if (action === 'nav-collection-ktv') {
                e.preventDefault();
                await navigateToCollectionBySlug('ktv-must-sing');
                return;
            }
            if (action === 'nav-collection-minyao') {
                e.preventDefault();
                await navigateToCollectionBySlug('min-yao');
                return;
            }
            if (action === 'navigate-collection-item') {
                const collId = parseInt(btn.dataset.collectionId);
                if (collId) navigateToCollectionItems(collId);
                return;
            }
            if (action === 'navigate-collection-songs') {
                const bvid = btn.dataset.bvid;
                const itemTitle = btn.dataset.itemTitle || '';
                if (bvid) await navigateToCollectionSongs(bvid, itemTitle);
                return;
            }
            if (action === 'nav-back') {
                goBack();
                return;
            }

            // === 播放器 ===
            if (action === 'toggle-play') {
                Player.togglePlay();
                return;
            }
            if (action === 'prev') {
                Player.prev();
                return;
            }
            if (action === 'next') {
                Player.next();
                return;
            }
            if (action === 'toggle-mode') {
                const modes = ['loop-all', 'loop-single', 'shuffle'];
                const current = Player.getMode();
                const idx = modes.indexOf(current);
                Player.setMode(modes[(idx + 1) % modes.length]);
                return;
            }
            if (action === 'open-lyrics') {
                toggleLyricsPanel();
                return;
            }
            if (action === 'open-now-playing') {
                openNowPlaying();
                return;
            }
            if (action === 'close-now-playing') {
                closeNowPlaying();
                return;
            }

            // === 收藏 ===
            if (action === 'toggle-fav') {
                e.stopPropagation();
                if (!Auth.isLoggedIn()) { showAuthModal(); return; }
                const sid = parseInt(btn.dataset.songId);
                await PlaylistStore.toggleFavorite(sid);
                // 更新当前视图中的按钮状态
                refreshAll();
                // 更新沉浸式视图
                if ($.npoOverlay.style.display === 'flex') {
                    const isFav = PlaylistStore.isFavorite(sid);
                    $.npoBtnFav.textContent = isFav ? '❤️ 已收藏' : '♡ 收藏';
                }
                return;
            }
            if (action === 'toggle-fav-npo') {
                if (!Auth.isLoggedIn()) { showAuthModal(); return; }
                const sid = parseInt(btn.dataset.songId);
                await PlaylistStore.toggleFavorite(sid);
                refreshAll();
                return;
            }

            // === 歌单 ===
            if (action === 'show-add-to-playlist') {
                e.stopPropagation();
                if (!Auth.isLoggedIn()) { showAuthModal(); return; }
                const sid = parseInt(btn.dataset.songId);
                showAddToPlaylistModal(sid);
                return;
            }
            if (action === 'new-playlist') {
                showCreatePlaylistModal();
                return;
            }
            if (action === 'rename-playlist') {
                e.stopPropagation();  // 防止触发 open-playlist
                const plId = parseInt(btn.dataset.plId);
                if (plId) startRename(plId);
                return;
            }
            if (action === 'open-playlist') {
                const plId = parseInt(btn.dataset.plId);
                openPlaylistModal(plId);
                return;
            }
            if (action === 'delete-playlist') {
                e.stopPropagation();
                const plId = parseInt(btn.dataset.plId);
                const pl = PlaylistStore.getPlaylist(plId);
                if (pl && confirm('确定删除歌单 "' + pl.name + '" 吗？')) {
                    await PlaylistStore.deletePlaylist(plId);
                }
                return;
            }

            // === 播放全部 ===
            if (action === 'play-all-favs') {
                const favs = PlaylistStore.getFavorites();
                if (favs.length) {
                    window._currentSongs = favs;
                    window._currentPlaylist = null;
                    Player.playAll(favs, 0);
                }
                return;
            }

            // === Auth ===
            if (action === 'show-feedback') {
                showFeedbackModal();
                return;
            }
            if (action === 'show-auth') {
                showAuthModal();
                return;
            }
            if (action === 'toggle-user-menu') {
                $.userDropdown.style.display = $.userDropdown.style.display === 'none' ? '' : 'none';
                return;
            }
            if (action === 'logout') {
                await Auth.logout();
                $.userDropdown.style.display = 'none';
                updateAuthUI();
                if (_currentView === 'favorites' || _currentView === 'playlists') navigateHome();
                return;
            }
            if (action === 'change-username') {
                $.userDropdown.style.display = 'none';
                showChangeUsernameModal();
                return;
            }
            if (action === 'change-avatar') {
                $.userDropdown.style.display = 'none';
                triggerAvatarUpload();
                return;
            }

            // === 搜索 ===
            if (action === 'search-history') {
                const q = btn.dataset.query;
                $.searchInput.value = q;
                $.searchClear.style.display = '';
                $.searchDropdown.style.display = 'none';
                doSearch(q);
                return;
            }
            if (action === 'clear-search-history') {
                PlaylistStore.clearSearchHistory();
                $.searchDropdown.style.display = 'none';
                return;
            }

            // === Modal ===
            if (action === 'close-modal') {
                hideModal();
                return;
            }
            if (action === 'do-add-to-pl') {
                const plId = parseInt(btn.dataset.plId);
                const sid = parseInt(btn.dataset.songId);
                await PlaylistStore.addToPlaylist(plId, sid);
                hideModal();
                return;
            }
            if (action === 'new-playlist-from-add') {
                const sid = parseInt(btn.dataset.songId);
                showCreatePlaylistModal(sid);
                return;
            }
        });

        // 进度条拖拽（支持 click + drag）
        function setupProgressDrag(wrap) {
            let dragging = false;

            function seekTo(clientX) {
                const rect = wrap.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                const time = pct * Player.getDuration();
                Player.seek(time);
            }

            wrap.addEventListener('mousedown', (e) => {
                dragging = true;
                seekTo(e.clientX);
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                seekTo(e.clientX);
            });

            document.addEventListener('mouseup', () => {
                dragging = false;
            });

            // 触摸支持
            wrap.addEventListener('touchstart', (e) => {
                dragging = true;
                seekTo(e.touches[0].clientX);
                e.preventDefault();
            }, { passive: false });

            document.addEventListener('touchmove', (e) => {
                if (!dragging) return;
                seekTo(e.touches[0].clientX);
            });

            document.addEventListener('touchend', () => {
                dragging = false;
            });
        }

        setupProgressDrag($.progressWrap);
        setupProgressDrag($.npoProgressWrap);

        // 音量 — 初始状态
        Player.setVolume(0.8);
        updateVolumeIcon();

        $.btnVolume.addEventListener('click', () => {
            $.volumePopup.style.display = $.volumePopup.style.display === 'none' ? '' : 'none';
        });
        $.volumeSlider.addEventListener('input', () => {
            Player.setVolume($.volumeSlider.value / 100);
            updateVolumeIcon();
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.player-right')) {
                $.volumePopup.style.display = 'none';
            }
        });

        // 用户下拉关闭
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.user-menu-wrap')) {
                $.userDropdown.style.display = 'none';
            }
        });

        // Modal 关闭
        $.modalOverlay.addEventListener('click', (e) => {
            if (e.target === $.modalOverlay) hideModal();
        });

        // 抽屉
        $.fabDrawer.addEventListener('click', () => openDrawer('fav'));
        $.drawerOverlay.addEventListener('click', () => closeDrawer());

        // 抽屉 tabs
        document.querySelectorAll('.drawer-tab').forEach(tab => {
            tab.addEventListener('click', () => openDrawer(tab.dataset.drawerTab));
        });

        // 滚动阴影
        $.contentArea.addEventListener('scroll', () => {
            $.topBar.classList.toggle('scrolled', $.contentArea.scrollTop > 0);
        });

        // 手机端点击 player-info 展开播放栏
        const playerNow = document.getElementById('playerNow');
        if (playerNow && $.playerBar) {
            playerNow.addEventListener('click', (e) => {
                // 不拦截封面点击
                if (e.target.closest('.player-cover-wrap')) return;
                if (window.innerWidth < 768) {
                    $.playerBar.classList.toggle('expanded');
                }
            });
        }

        // 歌词面板按钮
        if ($.btnLyricsClose) {
            $.btnLyricsClose.addEventListener('click', () => closeLyricsPanel());
        }
        if ($.btnLyricsPopout) {
            $.btnLyricsPopout.addEventListener('click', () => popoutLyricsEmbedded());
        }

        // 歌词面板：点击/拖拽歌词行跳转播放进度
        if ($.lyricsPanelBody) {
            let lyricsDragging = false;

            function seekLyricsByClientY(clientY) {
                const lineEl = document.elementFromPoint(
                    $.lyricsPanelBody.getBoundingClientRect().left + 20,
                    clientY
                )?.closest('.lyric-line');
                if (!lineEl) return;
                const idx = parseInt(lineEl.dataset.idx);
                if (!isNaN(idx) && _embeddedLyricsLines[idx]) {
                    Player.seek(_embeddedLyricsLines[idx].time);
                }
            }

            $.lyricsPanelBody.addEventListener('mousedown', (e) => {
                const line = e.target.closest('.lyric-line');
                if (!line) return;
                lyricsDragging = true;
                const idx = parseInt(line.dataset.idx);
                if (!isNaN(idx) && _embeddedLyricsLines[idx]) {
                    Player.seek(_embeddedLyricsLines[idx].time);
                }
                e.preventDefault();
            });

            document.addEventListener('mousemove', (e) => {
                if (!lyricsDragging) return;
                seekLyricsByClientY(e.clientY);
            });

            document.addEventListener('mouseup', () => {
                lyricsDragging = false;
            });

            // 触摸支持
            $.lyricsPanelBody.addEventListener('touchstart', (e) => {
                const line = e.target.closest('.lyric-line');
                if (!line) return;
                lyricsDragging = true;
                const idx = parseInt(line.dataset.idx);
                if (!isNaN(idx) && _embeddedLyricsLines[idx]) {
                    Player.seek(_embeddedLyricsLines[idx].time);
                }
                e.preventDefault();
            }, { passive: false });

            document.addEventListener('touchmove', (e) => {
                if (!lyricsDragging) return;
                seekLyricsByClientY(e.touches[0].clientY);
            });

            document.addEventListener('touchend', () => {
                lyricsDragging = false;
            });
        }

        // 窗口缩放时自适应歌词字号
        window.addEventListener('resize', () => {
            if (_embeddedLyricsOpen) {
                autoResizeEmbeddedLyrics();
            }
        });
    }

    // ========== Auth Modal ==========
    function showAuthModal() {
        let tab = 'code'; // 'code' | 'password'
        let step = 'email'; // 'email' | 'code' (only for code tab)
        let email = '';
        let countdown = 0;
        let cdTimer = null;

        function stopCountdown() {
            if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
        }

        function render() {
            const codeActive = tab === 'code' ? 'border-bottom:2px solid var(--accent);color:var(--accent)' : 'color:var(--text-tertiary);cursor:pointer';
            const pwdActive = tab === 'password' ? 'border-bottom:2px solid var(--accent);color:var(--accent)' : 'color:var(--text-tertiary);cursor:pointer';

            const tabsHtml = `<div style="display:flex;gap:0;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08)">
                <div data-action="auth-tab-code" style="flex:1;text-align:center;padding:10px 0;font-size:14px;font-weight:500;transition:all 0.2s;${codeActive}">验证码登录</div>
                <div data-action="auth-tab-password" style="flex:1;text-align:center;padding:10px 0;font-size:14px;font-weight:500;transition:all 0.2s;${pwdActive}">密码登录</div>
            </div>`;

            let fields;
            if (tab === 'password') {
                fields = `
                    <input class="modal-input" id="authEmail" type="email" placeholder="请输入邮箱" autocomplete="email" value="${escapeHtml(email)}">
                    <input class="modal-input" id="authPassword" type="password" placeholder="请输入密码" autocomplete="current-password" style="margin-top:8px">
                    <div class="auth-error" id="authError" style="display:none"></div>`;
            } else if (step === 'email') {
                fields = `
                    <input class="modal-input" id="authEmail" type="email" placeholder="请输入邮箱" autocomplete="email" value="${escapeHtml(email)}">
                    <div class="auth-error" id="authError" style="display:none"></div>`;
            } else {
                fields = `
                    <div class="auth-code-sent">验证码已发送至 <strong>${escapeHtml(email)}</strong></div>
                    <input class="modal-input auth-code-input" id="authCode" type="text" placeholder="请输入6位验证码" maxlength="6" autocomplete="one-time-code" inputmode="numeric">
                    <div class="auth-error" id="authError" style="display:none"></div>`;
            }
            const resendHtml = (tab === 'code' && step === 'code')
                ? `<div style="margin-top:10px;text-align:center">
                     <a id="btnResend" style="cursor:pointer;color:var(--accent);font-size:13px;${countdown > 0 ? 'opacity:0.5;pointer-events:none' : ''}">${countdown > 0 ? `重新发送 (${countdown}s)` : '重新发送'}</a>
                     &nbsp;&nbsp;
                     <a data-action="auth-back-email" style="cursor:pointer;color:var(--text-tertiary);font-size:13px">← 更换邮箱</a>
                   </div>`
                : '';

            let btnText;
            if (tab === 'password') {
                btnText = '登录';
            } else {
                btnText = step === 'email' ? '发送验证码' : '登录 / 注册';
            }

            showModal('👤 登录 / 注册',
                `<div class="auth-form">${tabsHtml}${fields}${resendHtml}</div>`,
                `<button class="btn btn-secondary" data-action="close-modal">取消</button>
                 <button class="btn btn-primary" id="btnAuthSubmit">${btnText}</button>`
            );

            const errEl = document.getElementById('authError');
            const submitBtn = document.getElementById('btnAuthSubmit');

            // Tab 切换事件
            const tabCodeEl = document.querySelector('[data-action="auth-tab-code"]');
            const tabPwdEl = document.querySelector('[data-action="auth-tab-password"]');
            if (tabCodeEl) {
                tabCodeEl.addEventListener('click', () => {
                    if (tab !== 'code') {
                        tab = 'code';
                        step = 'email';
                        email = '';
                        countdown = 0;
                        stopCountdown();
                        render();
                    }
                });
            }
            if (tabPwdEl) {
                tabPwdEl.addEventListener('click', () => {
                    if (tab !== 'password') {
                        tab = 'password';
                        step = 'email';
                        countdown = 0;
                        stopCountdown();
                        render();
                    }
                });
            }

            // 绑定重新发送链接 (code tab only)
            const resendBtn = document.getElementById('btnResend');
            if (resendBtn) {
                resendBtn.addEventListener('click', async (e) => {
                    e.preventDefault();
                    if (countdown > 0) return;
                    resendBtn.textContent = '发送中…';
                    resendBtn.style.pointerEvents = 'none';
                    try {
                        await Auth.sendCode(email);
                        countdown = 60;
                        resendBtn.textContent = `重新发送 (${countdown}s)`;
                        resendBtn.style.opacity = '0.5';
                        resendBtn.style.pointerEvents = 'none';
                        cdTimer = setInterval(() => {
                            countdown--;
                            const b = document.getElementById('btnResend');
                            if (b) {
                                if (countdown > 0) {
                                    b.textContent = `重新发送 (${countdown}s)`;
                                } else {
                                    b.textContent = '重新发送';
                                    b.style.opacity = '';
                                    b.style.pointerEvents = '';
                                    stopCountdown();
                                }
                            }
                        }, 1000);
                    } catch (e2) {
                        resendBtn.textContent = '重新发送';
                        resendBtn.style.opacity = '';
                        resendBtn.style.pointerEvents = '';
                        if (errEl) {
                            errEl.textContent = e2.message;
                            errEl.style.display = '';
                        }
                    }
                });
            }

            submitBtn.addEventListener('click', async () => {
                try {
                    if (tab === 'password') {
                        // ===== 密码登录 =====
                        email = document.getElementById('authEmail').value.trim();
                        if (!email || !email.includes('@')) {
                            throw new Error('请输入有效的邮箱地址');
                        }
                        const pwd = document.getElementById('authPassword').value;
                        if (!pwd) {
                            throw new Error('请输入密码');
                        }
                        submitBtn.disabled = true;
                        submitBtn.textContent = '登录中…';
                        await Auth.loginWithPassword(email, pwd);
                        hideModal();
                        updateAuthUI();
                        PlaylistStore.loadFromServer();
                    } else if (step === 'email') {
                        // ===== 验证码登录 - 发送验证码 =====
                        email = document.getElementById('authEmail').value.trim();
                        if (!email || !email.includes('@')) {
                            throw new Error('请输入有效的邮箱地址');
                        }
                        submitBtn.disabled = true;
                        submitBtn.textContent = '发送中…';
                        await Auth.sendCode(email);
                        // 进入验证码步骤，启动倒计时
                        step = 'code';
                        countdown = 60;
                        render();
                        cdTimer = setInterval(() => {
                            countdown--;
                            const b = document.getElementById('btnResend');
                            if (b) {
                                if (countdown > 0) {
                                    b.textContent = `重新发送 (${countdown}s)`;
                                } else {
                                    b.textContent = '重新发送';
                                    b.style.opacity = '';
                                    b.style.pointerEvents = '';
                                    stopCountdown();
                                }
                            }
                        }, 1000);
                    } else {
                        // ===== 验证码登录 - 验证 =====
                        const code = document.getElementById('authCode').value.trim();
                        if (code.length !== 6 || !/^\d{6}$/.test(code)) {
                            throw new Error('请输入6位数字验证码');
                        }
                        submitBtn.disabled = true;
                        submitBtn.textContent = '登录中…';
                        stopCountdown();
                        const result = await Auth.verifyCode(email, code);
                        hideModal();
                        updateAuthUI();
                        PlaylistStore.loadFromServer();
                        // 新用户 / 未设置密码 → 弹出设置密码界面
                        if (result.is_new_user) {
                            showSetPasswordModal();
                        }
                    }
                } catch (e) {
                    if (errEl) {
                        errEl.textContent = e.message;
                        errEl.style.display = '';
                    }
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        let btnTextFallback;
                        if (tab === 'password') {
                            btnTextFallback = '登录';
                        } else {
                            btnTextFallback = step === 'email' ? '发送验证码' : '登录 / 注册';
                        }
                        submitBtn.textContent = btnTextFallback;
                    }
                }
            });

            // 返回邮箱步骤 (code tab only)
            const backLink = document.querySelector('[data-action="auth-back-email"]');
            if (backLink) {
                backLink.addEventListener('click', () => {
                    stopCountdown();
                    step = 'email';
                    countdown = 0;
                    render();
                });
            }

            // 自动聚焦
            setTimeout(() => {
                if (tab === 'password') {
                    const el = document.getElementById('authEmail');
                    if (el) el.focus();
                } else {
                    const el = step === 'email'
                        ? document.getElementById('authEmail')
                        : document.getElementById('authCode');
                    if (el) el.focus();
                }
            }, 100);

            // Enter 键提交
            const onKeydown = (e) => {
                if (e.key === 'Enter' && submitBtn && !submitBtn.disabled) {
                    e.preventDefault();
                    submitBtn.click();
                }
            };
            if (tab === 'password') {
                const pwdEl = document.getElementById('authPassword');
                if (pwdEl) pwdEl.addEventListener('keydown', onKeydown);
            }
            const emailEl = document.getElementById('authEmail');
            if (emailEl) emailEl.addEventListener('keydown', onKeydown);
            const codeEl = document.getElementById('authCode');
            if (codeEl) codeEl.addEventListener('keydown', onKeydown);
        }

        render();
    }

    /** 设置密码（首次注册后弹出） */
    function showSetPasswordModal() {
        showModal('🔐 设置密码',
            `<p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">为了安全起见，请设置一个密码，以后可以直接用密码登录。</p>
             <input class="modal-input" id="newPassword" type="password" placeholder="请输入密码（至少6位）" autocomplete="new-password">
             <input class="modal-input" id="confirmPassword" type="password" placeholder="请再次输入密码" autocomplete="new-password" style="margin-top:8px">
             <div class="auth-error" id="setPwdError" style="display:none"></div>`,
            `<button class="btn btn-secondary" id="btnSkipPwd">暂不设置</button>
             <button class="btn btn-primary" id="btnSetPwd">设置密码</button>`
        );

        const errEl = document.getElementById('setPwdError');

        document.getElementById('btnSkipPwd').addEventListener('click', () => {
            hideModal();
        });

        document.getElementById('btnSetPwd').addEventListener('click', async () => {
            const pwd = document.getElementById('newPassword').value;
            const confirm = document.getElementById('confirmPassword').value;

            if (pwd.length < 6) {
                if (errEl) { errEl.textContent = '密码长度至少 6 位'; errEl.style.display = ''; }
                return;
            }
            if (pwd !== confirm) {
                if (errEl) { errEl.textContent = '两次输入的密码不一致'; errEl.style.display = ''; }
                return;
            }

            const btn = document.getElementById('btnSetPwd');
            btn.disabled = true;
            btn.textContent = '设置中…';

            try {
                await Auth.setPassword(pwd);
                hideModal();
            } catch (e) {
                if (errEl) { errEl.textContent = e.message; errEl.style.display = ''; }
                btn.disabled = false;
                btn.textContent = '设置密码';
            }
        });

        // Enter 键提交
        const confirmEl = document.getElementById('confirmPassword');
        if (confirmEl) {
            confirmEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    document.getElementById('btnSetPwd').click();
                }
            });
        }
    }

    // ========== Add to Playlist Modal ==========
    function showAddToPlaylistModal(songId) {
        const pls = PlaylistStore.getPlaylists();
        const song = _songCache[songId] || { title: '歌曲 #' + songId };
        const listItems = pls.length
            ? pls.map(pl => `<div class="playlist-item" style="cursor:pointer" data-action="do-add-to-pl" data-pl-id="${pl.id}" data-song-id="${songId}"><span style="font-size:18px">📋</span><span class="pl-name">${escapeHtml(pl.name)}</span><span class="pl-count">${pl.song_count || 0} 首</span></div>`).join('')
            : '<div style="padding:8px;color:var(--text-tertiary)">暂无歌单</div>';

        showModal('添加到歌单',
            `<p style="margin-bottom:12px;color:var(--text-secondary);font-size:14px">"${escapeHtml(song.title)}"</p>${listItems}`,
            `<button class="btn btn-secondary" data-action="close-modal">关闭</button><button class="btn btn-primary" data-action="new-playlist-from-add" data-song-id="${songId}">+ 新建歌单</button>`
        );
    }

    function showCreatePlaylistModal(pendingSongId) {
        showModal('新建歌单',
            `<input class="modal-input" id="newPlName" type="text" placeholder="歌单名称" autocomplete="off">`,
            `<button class="btn btn-secondary" data-action="close-modal">取消</button><button class="btn btn-primary" id="btnCreatePl">创建</button>`
        );
        document.getElementById('btnCreatePl').addEventListener('click', async () => {
            const name = document.getElementById('newPlName').value.trim();
            if (!name) return;
            try {
                const pl = await PlaylistStore.createPlaylist(name);
                hideModal();
                if (pendingSongId) {
                    await PlaylistStore.addToPlaylist(pl.id, pendingSongId);
                }
                if (_currentView === 'playlists') renderPlaylistsInContent();
            } catch (e) {
                alert(e.message);
            }
        });
    }

    // ========== 修改用户名 Modal ==========
    function showChangeUsernameModal() {
        const user = Auth.getUser();
        showModal('✏️ 修改用户名',
            `<input class="modal-input" id="newUsername" type="text" placeholder="新用户名" value="${escapeHtml(user.username || '')}" maxlength="30" autocomplete="off">`,
            `<button class="btn btn-secondary" data-action="close-modal">取消</button><button class="btn btn-primary" id="btnSaveUsername">保存</button>`
        );
        document.getElementById('btnSaveUsername').addEventListener('click', async () => {
            const username = document.getElementById('newUsername').value.trim();
            if (!username) return;
            try {
                await Auth.updateProfile({ username });
                hideModal();
                updateAuthUI();
            } catch (e) {
                alert(e.message);
            }
        });
    }

    // ========== 头像上传 ==========
    let _avatarFileInput = null;

    function triggerAvatarUpload() {
        if (!_avatarFileInput) {
            _avatarFileInput = document.createElement('input');
            _avatarFileInput.type = 'file';
            _avatarFileInput.accept = 'image/png,image/jpeg,image/webp';
            _avatarFileInput.addEventListener('change', async () => {
                const file = _avatarFileInput.files[0];
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) {
                    alert('图片不能超过 2MB');
                    return;
                }
                try {
                    await Auth.uploadAvatar(file);
                    updateAuthUI();
                } catch (e) {
                    alert('头像上传失败: ' + e.message);
                }
            });
        }
        _avatarFileInput.click();
    }

    // ========== 意见反馈 Modal ==========
    function showFeedbackModal() {
        showModal('💬 意见反馈',
            `<textarea class="modal-textarea" id="feedbackContent" placeholder="请告诉我们您的想法…" rows="5" maxlength="2000"></textarea>
             <input class="modal-input" id="feedbackContact" type="text" placeholder="联系方式（选填，方便我们回复）" style="margin-top:8px">`,
            `<button class="btn btn-secondary" data-action="close-modal">取消</button><button class="btn btn-primary" id="btnSendFeedback">发送反馈</button>`
        );
        document.getElementById('btnSendFeedback').addEventListener('click', async () => {
            const content = document.getElementById('feedbackContent').value.trim();
            const contact = document.getElementById('feedbackContact').value.trim();
            if (content.length < 2) { alert('请至少输入 2 个字符'); return; }
            const btn = document.getElementById('btnSendFeedback');
            btn.disabled = true;
            btn.textContent = '发送中…';
            try {
                const resp = await fetch('/api/feedback', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content, contact: contact || undefined }),
                });
                const data = await resp.json();
                if (!resp.ok) throw new Error(data.error);
                hideModal();
                alert('感谢反馈！');
            } catch (e) {
                alert('发送失败: ' + e.message);
                btn.disabled = false;
                btn.textContent = '发送反馈';
            }
        });
    }

    function openPlaylistModal(plId) {
        const pl = PlaylistStore.getPlaylist(plId);
        if (!pl) return;
        PlaylistStore.getPlaylistSongs(plId).then(songs => {
            const songList = songs.length
                ? songs.map((s, i) => `
                    <div class="pl-song-item" data-song-index="${i}">
                        <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(s.title)} - ${escapeHtml(s.singer || '')}</span>
                        <button class="btn-remove-song" data-action="remove-from-pl" data-pl-id="${plId}" data-song-id="${s.id}">✕</button>
                    </div>`).join('')
                : '<div class="empty-state" style="padding:20px"><span class="empty-icon">📋</span>歌单是空的</div>';

            showModal(pl.name,
                `<button class="btn-play-all" style="margin-bottom:12px" data-action="play-pl" data-pl-id="${plId}">▶ 播放全部</button>${songList}`,
                `<button class="btn btn-secondary" data-action="close-modal">关闭</button>`
            );

            // 绑定事件
            document.querySelectorAll('[data-action="play-pl"]').forEach(b => {
                b.addEventListener('click', async () => {
                    const pid = parseInt(b.dataset.plId);
                    const s = await PlaylistStore.getPlaylistSongs(pid);
                    if (s.length) {
                        window._currentSongs = s;
                        window._currentPlaylist = pid;
                        Player.playAll(s, 0);
                        hideModal();
                    }
                });
            });
            document.querySelectorAll('[data-action="remove-from-pl"]').forEach(b => {
                b.addEventListener('click', async () => {
                    const pid = parseInt(b.dataset.plId);
                    const sid = parseInt(b.dataset.songId);
                    await PlaylistStore.removeFromPlaylist(pid, sid);
                    openPlaylistModal(pid); // 刷新
                });
            });
            document.querySelectorAll('.pl-song-item').forEach((item, i) => {
                item.addEventListener('click', (e) => {
                    if (e.target.closest('button')) return;
                    const idx = parseInt(item.dataset.songIndex);
                    if (!isNaN(idx) && songs.length) {
                        window._currentSongs = songs;
                        window._currentPlaylist = plId;
                        Player.playAll(songs, idx);
                        hideModal();
                    }
                });
            });
        }).catch(() => {
            showModal('错误', '<p>加载歌单失败</p>', '<button class="btn btn-secondary" data-action="close-modal">关闭</button>');
        });
    }

    // ========== 播放器事件（Player.on 回调签名: fn(eventName, data)） ==========
    function setupPlayerEvents() {
        Player.on((eventName, data) => {
            switch (eventName) {
            case 'playState':
                updatePlayButton(data);
                break;
            case 'timeupdate':
                updateProgress({ currentTime: data.displayCurrent, duration: data.displayDuration });
                // 同步嵌入式歌词
                if (_embeddedLyricsOpen) {
                    syncLyricsEmbedded(data.displayCurrent);
                }
                break;
            case 'duration':
                updateDuration(data);
                break;
            case 'modeChange':
                updateModeDisplay();
                break;
            case 'loading':
                updatePlayBar(data);
                // 切换歌曲时刷新嵌入式歌词
                if (_embeddedLyricsOpen && data && data.id) {
                    fetchLyricsEmbedded(data.id);
                }
                // 更新卡片状态
                document.querySelectorAll('.cover-card.playing, .song-list-item.playing').forEach(el => el.classList.remove('playing'));
                break;
            }
        });
    }

    // ========== 初始化 ==========
    async function init(songs) {
        cacheDom();
        window._songCache = {};
        _defaultSongs = songs;
        mergeToCache(songs);

        // 后台预加载歌曲汇总数据（不阻塞首屏渲染）
        fetch('/api/collections')
            .then(r => r.json())
            .then(d => { _collectionTree = d.collections || []; })
            .catch(() => {});

        // 初始渲染：推荐歌曲封面网格
        $.viewContainer.innerHTML = renderCoverGrid(songs);
        bindCardClicks();
        setActiveSidebarNav('home');

        // 初始化播放器
        Player.init();

        // 恢复登录状态
        await Auth.init();
        updateAuthUI();

        // 如果已登录，加载服务器数据
        if (Auth.isLoggedIn()) {
            PlaylistStore.loadFromServer().then(() => {
                const favs = PlaylistStore.getFavorites();
                if ($.sidebarFavCount) {
                    $.sidebarFavCount.textContent = favs.length;
                    $.sidebarFavCount.style.display = favs.length > 0 ? '' : 'none';
                }
            });
        }

        // 设置事件
        setupSearch();
        setupGlobalDelegation();
        setupPlayerEvents();

        // 初始化模式按钮显示（修复刷新后仍显示 emoji 的问题）
        updateModeDisplay();

        // PlaylistStore 状态变化 → 刷新 UI
        PlaylistStore.onChange(() => {
            refreshAll();
        });

        // Auth 状态变化 → 更新 UI
        Auth.onChange(() => {
            updateAuthUI();
            if (Auth.isLoggedIn()) {
                PlaylistStore.loadFromServer();
            }
        });

        // Lyrics 窗口关闭监听
        try {
            const bc = new BroadcastChannel('music_player_lyrics');
            bc.onmessage = (e) => {
                if (e.data && e.data.type === 'lyrics-closed') {
                    lyricsWindow = null;
                }
            };
        } catch (e) { /* BroadcastChannel not supported */ }

        // 主窗口关闭
        window.addEventListener('beforeunload', () => {
            closeLyricsWindow();
        });
    }

    // ========== Public API ==========
    return {
        init,
        renderSongList,
        renderCoverGrid,
        navigateHome,
        updatePlayBar,
        updateModeDisplay,
        refreshAll,
        hideModal,
        openDrawer,
        closeDrawer,
        openNowPlaying,
        closeNowPlaying,
    };
})();
