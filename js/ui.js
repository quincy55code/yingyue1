/**
 * ui.js — DOM 渲染与用户交互
 * ===========================
 * 连接 Player + PlaylistStore + HTML DOM。
 */

const UI = (() => {
    // ========== DOM 引用缓存 ==========
    let els = {};

    function cacheDom() {
        els = {
            songList: document.getElementById('songList'),
            playerBar: document.getElementById('playerBar'),
            progressWrap: document.getElementById('progressWrap'),
            progressFill: document.getElementById('progressFill'),
            timeCurrent: document.getElementById('timeCurrent'),
            timeTotal: document.getElementById('timeTotal'),
            btnPlay: document.getElementById('btnPlay'),
            btnPrev: document.getElementById('btnPrev'),
            btnNext: document.getElementById('btnNext'),
            btnMode: document.getElementById('btnMode'),
            nowPlayingTitle: document.getElementById('nowPlayingTitle'),
            nowPlayingDot: document.getElementById('nowPlayingDot'),
            panelFav: document.getElementById('panelFav'),
            panelPl: document.getElementById('panelPl'),
            tabFav: document.getElementById('tabFav'),
            tabPl: document.getElementById('tabPl'),
            modalOverlay: document.getElementById('modalOverlay'),
            modalTitle: document.getElementById('modalTitle'),
            modalBody: document.getElementById('modalBody'),
            modalActions: document.getElementById('modalActions'),
            searchInput: document.getElementById('searchInput'),
            searchClear: document.getElementById('searchClear'),
        };
    }

    // ========== 工具函数 ==========

    function formatTime(sec) {
        if (!sec || !isFinite(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    function h(html) {
        const t = document.createElement('template');
        t.innerHTML = html.trim();
        return t.content.firstChild;
    }

    // ========== 渲染歌曲列表 ==========

    function renderSongList(songs) {
        if (!els.songList) return;
        const currentId = Player.getCurrentSong() ? String(Player.getCurrentSong().id) : null;

        els.songList.innerHTML = '';
        songs.forEach((song, idx) => {
            const sid = String(song.id);
            const isFav = PlaylistStore.isFavorite(sid);
            const isPlaying = currentId === sid;

            const singerHtml = song.singer ? `<div class="card-singer">${escapeHtml(song.singer)}</div>` : '';
            const card = h(`
                <div class="song-card${isPlaying ? ' playing' : ''}" data-song-id="${sid}">
                    <div class="card-index">${idx + 1}</div>
                    <div class="card-info">
                        <div class="card-title">${escapeHtml(song.title)}</div>
                        ${singerHtml}
                        <div class="card-meta">${song.duration ? formatTime(song.duration) : '完整版'}</div>
                    </div>
                    <div class="card-actions">
                        <button class="btn-fav${isFav ? ' favorited' : ''}" data-action="fav" data-song-id="${sid}" title="收藏">${isFav ? '❤️' : '🤍'}</button>
                        <button class="btn-add" data-action="addToPl" data-song-id="${sid}" title="添加到歌单">+</button>
                    </div>
                </div>
            `);

            // 点击卡片播放
            card.addEventListener('click', (e) => {
                // 不拦截按钮点击
                if (e.target.closest('button')) return;
                Player.play(sid);
            });

            els.songList.appendChild(card);
        });
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ========== 更新播放栏 ==========

    function updatePlayBar() {
        const song = Player.getCurrentSong();
        const isPlaying = Player.getIsPlaying();

        if (els.nowPlayingTitle) {
            els.nowPlayingTitle.textContent = song ? song.title : '未在播放';
        }
        if (els.nowPlayingDot) {
            els.nowPlayingDot.style.display = isPlaying ? 'inline-block' : 'none';
        }
        if (els.btnPlay) {
            els.btnPlay.textContent = isPlaying ? '⏸' : '▶';
        }
    }

    function updateProgress(data) {
        if (!data) return;
        if (els.progressFill) {
            els.progressFill.style.width = Math.min(100, data.progress || 0) + '%';
        }
        if (els.timeCurrent) {
            els.timeCurrent.textContent = formatTime(data.displayCurrent);
        }
    }

    function updateDuration(dur) {
        if (els.timeTotal) {
            const song = Player.getCurrentSong();
            const total = song && song.end_time && song.start_time
                ? song.end_time - song.start_time
                : dur;
            els.timeTotal.textContent = formatTime(total);
        }
    }

    function updateModeDisplay() {
        if (!els.btnMode) return;
        const mode = Player.getMode();
        els.btnMode.className = 'btn-mode btn-ctrl';
        if (mode === 'loop') {
            els.btnMode.classList.add('loop-all');
            els.btnMode.textContent = '🔁';
            els.btnMode.title = '列表循环';
        } else if (mode === 'single') {
            els.btnMode.classList.add('loop-single');
            els.btnMode.textContent = '🔂';
            els.btnMode.title = '单曲循环';
        } else {
            els.btnMode.classList.add('shuffle');
            els.btnMode.textContent = '🔀';
            els.btnMode.title = '随机播放';
        }
    }

    // ========== 右侧面板 ==========

    function switchPanel(tab) {
        if (!els.panelFav || !els.panelPl) return;
        if (tab === 'fav') {
            els.panelFav.style.display = 'block';
            els.panelPl.style.display = 'none';
            els.tabFav.classList.add('active');
            els.tabPl.classList.remove('active');
            renderFavoritesPanel();
        } else {
            els.panelFav.style.display = 'none';
            els.panelPl.style.display = 'block';
            els.tabFav.classList.remove('active');
            els.tabPl.classList.add('active');
            renderPlaylistsPanel();
        }
    }

    function renderFavoritesPanel() {
        if (!els.panelFav) return;
        const favs = PlaylistStore.getFavorites();
        if (favs.length === 0) {
            els.panelFav.innerHTML = `
                <div class="empty-state">
                    <span class="empty-icon">⭐</span>
                    还没有收藏歌曲<br>点击歌曲旁的 🤍 收藏吧
                </div>`;
            return;
        }
        const songs = window._songCache || [];
        els.panelFav.innerHTML = favs.map(fid => {
            const song = songs.find(s => String(s.id) === fid);
            if (!song) return '';
            return `
                <div class="playlist-item" data-song-id="${fid}">
                    <div class="pl-name">${escapeHtml(song.title)}</div>
                    <button class="btn-delete" data-action="unfav" data-song-id="${fid}">✕</button>
                </div>`;
        }).join('');
    }

    function renderPlaylistsPanel() {
        if (!els.panelPl) return;
        const pls = PlaylistStore.getPlaylists();
        let html = '';
        if (pls.length === 0) {
            html = `
                <div class="empty-state">
                    <span class="empty-icon">📋</span>
                    还没有自定义歌单<br>点击下方按钮新建
                </div>`;
        } else {
            html = pls.map(pl => `
                <div class="playlist-item" data-pl-name="${escapeHtml(pl.name)}">
                    <div class="pl-name">📁 ${escapeHtml(pl.name)}</div>
                    <div class="pl-count">${pl.songs.length} 首</div>
                    <button class="btn-delete" data-action="delPl" data-pl-name="${escapeHtml(pl.name)}">✕</button>
                </div>`).join('');
        }
        html += `<button class="btn-new-pl" id="btnNewPl">+ 新建歌单</button>`;
        els.panelPl.innerHTML = html;
    }

    function renderPlaylistDetail(plName) {
        const pl = PlaylistStore.getPlaylist(plName);
        if (!pl) return;
        const songs = window._songCache || [];

        showModal(
            `📁 ${plName}`,
            pl.songs.length === 0
                ? '<div class="empty-state"><span class="empty-icon">🎵</span>歌单是空的<br>在歌曲列表中点击 + 添加</div>'
                : pl.songs.map(sid => {
                    const song = songs.find(s => String(s.id) === sid);
                    if (!song) return '';
                    return `
                        <div class="pl-song-item" data-song-id="${sid}">
                            <span>🎵 ${escapeHtml(song.title)}</span>
                            <button class="btn-remove-song" data-action="removeFromPl" data-pl-name="${escapeHtml(plName)}" data-song-id="${sid}">✕</button>
                        </div>`;
                }).join(''),
            '' // 底部没有额外按钮
        );
    }

    // ========== Modal ==========

    function showModal(title, bodyHtml, actionsHtml) {
        if (!els.modalOverlay) return;
        els.modalTitle.textContent = title;
        els.modalBody.innerHTML = bodyHtml;
        els.modalActions.innerHTML = actionsHtml;
        els.modalOverlay.classList.add('show');
    }

    function hideModal() {
        if (!els.modalOverlay) return;
        els.modalOverlay.classList.remove('show');
    }

    function showNewPlaylistModal() {
        showModal(
            '新建歌单',
            '<input class="modal-input" id="inputPlName" placeholder="输入歌单名称…" maxlength="30">',
            `<button class="btn btn-secondary" id="btnModalCancel">取消</button>
             <button class="btn btn-primary" id="btnModalConfirm">创建</button>`
        );
        setTimeout(() => {
            const inp = document.getElementById('inputPlName');
            if (inp) inp.focus();
        }, 100);
    }

    function showAddToPlaylistModal(songId) {
        const pls = PlaylistStore.getPlaylists();
        if (pls.length === 0) {
            showModal(
                '添加到歌单',
                '<div class="empty-state"><span class="empty-icon">📋</span>还没有歌单<br>请先在右侧面板新建歌单</div>',
                '<button class="btn btn-secondary" id="btnModalCancel">关闭</button>'
            );
            return;
        }
        showModal(
            '添加到歌单',
            pls.map(pl => {
                const already = pl.songs.includes(String(songId));
                return `<div class="playlist-item" data-action="doAddToPl" data-pl-name="${escapeHtml(pl.name)}" data-song-id="${songId}">
                    <div class="pl-name">📁 ${escapeHtml(pl.name)}</div>
                    <div style="font-size:12px;color:var(--text-muted)">${already ? '✓ 已添加' : '点击添加'}</div>
                </div>`;
            }).join(''),
            '<button class="btn btn-secondary" id="btnModalCancel">关闭</button>'
        );
    }

    // ========== 搜索功能 ==========
    let _searchTimer = null;
    let _isSearching = false;        // 当前是否在搜索模式
    let _defaultSongs = [];          // 默认歌曲缓存（搜索清空后恢复）

    function setupSearch() {
        const input = els.searchInput;
        const clearBtn = els.searchClear;
        if (!input) return;

        // 输入 → 防抖搜索
        input.addEventListener('input', () => {
            const q = input.value.trim();
            clearBtn.style.display = q ? 'flex' : 'none';

            clearTimeout(_searchTimer);
            if (!q) {
                // 清空搜索框 → 恢复默认列表
                _isSearching = false;
                renderSongList(_defaultSongs);
                return;
            }

            _searchTimer = setTimeout(() => doSearch(q), 300);
        });

        // 回车立即搜索
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(_searchTimer);
                const q = input.value.trim();
                if (q) doSearch(q);
            }
        });

        // 清除按钮
        clearBtn.addEventListener('click', () => {
            input.value = '';
            clearBtn.style.display = 'none';
            _isSearching = false;
            renderSongList(_defaultSongs);
            input.focus();
        });
    }

    async function doSearch(q) {
        if (!q || q.length > 100) return;

        try {
            const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            if (!resp.ok) return;
            const data = await resp.json();

            _isSearching = true;

            if (data.results && data.results.length > 0) {
                // 有结果 → 渲染搜索结果
                renderSongList(data.results);
            } else {
                // 无结果 → 显示空状态 + 记录搜索
                _isSearching = false;
                renderSearchEmpty(q);
                logSearchMiss(q);
            }
        } catch (err) {
            console.error('[search]', err);
        }
    }

    function renderSearchEmpty(q) {
        if (!els.songList) return;
        els.songList.innerHTML = `
            <div class="empty-state search-empty">
                <span class="empty-icon">🔍</span>
                未找到「<strong>${escapeHtml(q)}</strong>」<br>
                <small style="color:var(--text-muted)">已记录你的搜索，后续会添加相关歌曲</small>
            </div>`;
    }

    async function logSearchMiss(q) {
        try {
            await fetch('/api/search-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: q }),
            });
        } catch {
            // 静默失败，不影响用户体验
        }
    }

    // ========== 全局事件代理 ==========

    function setupGlobalListeners() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;

            switch (action) {
                // 收藏切换
                case 'fav': {
                    e.stopPropagation();
                    const sid = btn.dataset.songId;
                    const isFav = PlaylistStore.toggleFavorite(sid);
                    btn.classList.toggle('favorited', isFav);
                    btn.innerHTML = isFav ? '❤️' : '🤍';
                    // 重新触发动画
                    if (isFav) {
                        btn.classList.remove('favorited');
                        void btn.offsetWidth;
                        btn.classList.add('favorited');
                    }
                    refreshAll();
                    break;
                }

                // 添加到歌单
                case 'addToPl': {
                    e.stopPropagation();
                    showAddToPlaylistModal(btn.dataset.songId);
                    break;
                }

                // 在 modal 中确认添加到歌单
                case 'doAddToPl': {
                    PlaylistStore.addToPlaylist(btn.dataset.plName, btn.dataset.songId);
                    hideModal();
                    refreshAll();
                    break;
                }

                // 取消收藏
                case 'unfav': {
                    PlaylistStore.removeFavorite(btn.dataset.songId);
                    refreshAll();
                    break;
                }

                // 删除歌单
                case 'delPl': {
                    e.stopPropagation();
                    if (confirm(`确定删除歌单「${btn.dataset.plName}」吗？`)) {
                        PlaylistStore.deletePlaylist(btn.dataset.plName);
                        refreshAll();
                    }
                    break;
                }

                // 从歌单中移除歌曲
                case 'removeFromPl': {
                    e.stopPropagation();
                    PlaylistStore.removeFromPlaylist(btn.dataset.plName, btn.dataset.songId);
                    renderPlaylistDetail(btn.dataset.plName);
                    refreshAll();
                    break;
                }

                // Modal 取消
                case 'btnModalCancel':
                case 'cancel': {
                    hideModal();
                    break;
                }

                // Modal 确认（新建歌单）
                case 'btnModalConfirm':
                case 'confirm': {
                    const inp = document.getElementById('inputPlName');
                    if (inp && inp.value.trim()) {
                        const created = PlaylistStore.createPlaylist(inp.value.trim());
                        if (created) {
                            hideModal();
                            refreshAll();
                        } else {
                            alert('歌单名重复或无效');
                        }
                    }
                    break;
                }
            }
        });

        // 点击歌单项目 → 查看详情
        document.addEventListener('click', (e) => {
            const item = e.target.closest('.playlist-item[data-pl-name]');
            if (!item) return;
            if (e.target.closest('button')) return; // 不拦截按钮
            renderPlaylistDetail(item.dataset.plName);
        });

        // 点击歌单中的歌曲 → 播放
        document.addEventListener('click', (e) => {
            const item = e.target.closest('.pl-song-item[data-song-id]');
            if (!item) return;
            if (e.target.closest('button')) return;
            Player.play(item.dataset.songId);
            hideModal();
        });

        // 收藏面板中的歌曲点击 → 播放
        document.addEventListener('click', (e) => {
            const item = e.target.closest('#panelFav .playlist-item[data-song-id]');
            if (!item) return;
            if (e.target.closest('button')) return;
            Player.play(item.dataset.songId);
        });

        // 模态遮罩点击关闭
        document.addEventListener('click', (e) => {
            if (e.target === els.modalOverlay) {
                hideModal();
            }
        });

        // Tab 切换
        if (els.tabFav) els.tabFav.addEventListener('click', () => switchPanel('fav'));
        if (els.tabPl) els.tabPl.addEventListener('click', () => switchPanel('pl'));

        // 新建歌单按钮（动态元素，用事件代理）
        document.addEventListener('click', (e) => {
            if (e.target.id === 'btnNewPl') {
                showNewPlaylistModal();
            }
        });

        // 播放器控制按钮
        if (els.btnPlay) els.btnPlay.addEventListener('click', () => Player.togglePlay());
        if (els.btnPrev) els.btnPrev.addEventListener('click', () => Player.prev());
        if (els.btnNext) els.btnNext.addEventListener('click', () => Player.next());
        if (els.btnMode) els.btnMode.addEventListener('click', () => {
            Player.setMode('next');
            updateModeDisplay();
        });

        // 进度条拖拽
        if (els.progressWrap) {
            els.progressWrap.addEventListener('click', (e) => {
                const rect = els.progressWrap.getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                const duration = Player.getDuration();
                if (duration > 0) {
                    Player.seek(ratio * duration);
                }
            });
        }

        // 键盘快捷键
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT') return; // 输入框中不响应
            switch (e.code) {
                case 'Space':
                    e.preventDefault();
                    Player.togglePlay();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    Player.prev();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    Player.next();
                    break;
            }
        });
    }

    // ========== 全局刷新 ==========

    function refreshAll() {
        const songs = window._songCache || [];
        renderSongList(songs);
        updatePlayBar();
        updateModeDisplay();
        if (els.panelFav && els.panelFav.style.display !== 'none') renderFavoritesPanel();
        if (els.panelPl && els.panelPl.style.display !== 'none') renderPlaylistsPanel();
    }

    // ========== 初始化 ==========

    function init(songs) {
        cacheDom();
        window._songCache = songs;
        _defaultSongs = songs;
        Player.setSongs(songs);
        Player.init();

        // 监听 Player 事件
        Player.on((event, data) => {
            switch (event) {
                case 'timeupdate':
                    updateProgress(data);
                    break;
                case 'duration':
                    updateDuration(data);
                    break;
                case 'playState':
                    updatePlayBar();
                    break;
                case 'modeChange':
                    updateModeDisplay();
                    break;
                case 'ended':
                    Player.next();
                    break;
                case 'loading':
                    updatePlayBar();
                    break;
                case 'error':
                    console.error('Player error:', data);
                    break;
            }
        });

        // 监听歌单变更
        PlaylistStore.onChange(() => {
            refreshAll();
        });

        setupGlobalListeners();
        renderSongList(songs);
        updatePlayBar();
        updateModeDisplay();
        switchPanel('fav'); // 默认显示收藏面板
        setupSearch();
    }

    return {
        init,
        renderSongList,
        updatePlayBar,
        updateModeDisplay,
        refreshAll,
        hideModal,
    };
})();
