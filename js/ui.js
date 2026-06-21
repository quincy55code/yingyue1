/**
 * ui.js — DOM 渲染与用户交互
 * ===========================
 * 连接 Player + PlaylistStore + Auth + HTML DOM。
 */

const UI = (() => {
    let lyricsWindow = null;  // 歌词弹出窗口引用

    // 标签系统状态
    let _tagsCache = [];        // 标签树缓存
    let _currentView = 'home';  // 'home' | 'tag' | 'star' | 'search'
    let _currentTagId = null;   // 当前查看的标签 ID
    let _currentTagName = '';   // 当前查看的标签名（用于标题）

    // ========== DOM 引用缓存 ==========
    let els = {};

    function cacheDom() {
        els = {
            viewContainer: document.getElementById('viewContainer'),
            viewHeader: document.getElementById('viewHeader'),
            btnBack: document.getElementById('btnBack'),
            viewTitle: document.getElementById('viewTitle'),
            sectionHeader: document.getElementById('sectionHeader'),
            playerBar: document.getElementById('playerBar'),
            progressWrap: document.getElementById('progressWrap'),
            progressFill: document.getElementById('progressFill'),
            timeCurrent: document.getElementById('timeCurrent'),
            timeTotal: document.getElementById('timeTotal'),
            btnPlay: document.getElementById('btnPlay'),
            btnPrev: document.getElementById('btnPrev'),
            btnNext: document.getElementById('btnNext'),
            btnLyrics: document.getElementById('btnLyrics'),
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
            btnLogin: document.getElementById('btnLogin'),
            userMenu: document.getElementById('userMenu'),
            authModal: document.getElementById('authModal'),
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

    /** 将歌曲合并到全局缓存（用于收藏/歌单面板查找） */
    function mergeToCache(songs) {
        if (!window._songCache) window._songCache = [];
        const cache = window._songCache;
        songs.forEach(song => {
            const idx = cache.findIndex(s => String(s.id) === String(song.id));
            if (idx >= 0) {
                cache[idx] = song;  // 更新已有条目
            } else {
                cache.push(song);   // 添加新条目
            }
        });
    }

    // ========== 渲染歌曲列表 ==========

    function renderSongList(songs) {
        if (!els.viewContainer) return;
        const currentId = Player.getCurrentSong() ? String(Player.getCurrentSong().id) : null;

        let html = '';
        songs.forEach((song, idx) => {
            const sid = String(song.id);
            const isFav = PlaylistStore.isFavorite(sid);
            const isPlaying = currentId === sid;

            const singerHtml = song.singer ? `<div class="card-singer">${escapeHtml(song.singer)}</div>` : '';
            const tagsHtml = (song.tags && song.tags.length > 0) ? `
                <div class="tag-badges">
                    ${song.tags.map(t => `<span class="tag-badge" data-tag-name="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')}
                </div>` : '';

            html += `
                <div class="song-card${isPlaying ? ' playing' : ''}" data-song-id="${sid}">
                    <div class="card-index">${idx + 1}</div>
                    <div class="card-info">
                        <div class="card-title">${escapeHtml(song.title)}</div>
                        ${singerHtml}
                        <div class="card-meta">${song.duration ? formatTime(song.duration) : '完整版'}</div>
                        ${tagsHtml}
                    </div>
                    <div class="card-actions">
                        <button class="btn-fav${isFav ? ' favorited' : ''}" data-action="fav" data-song-id="${sid}" title="收藏">${isFav ? '❤️' : '🤍'}</button>
                        <button class="btn-add" data-action="addToPl" data-song-id="${sid}" title="添加到歌单">+</button>
                    </div>
                </div>`;
        });

        els.viewContainer.innerHTML = html;

        requestAnimationFrame(() => _staggerCards(els.viewContainer, '.song-card, .tag-card'));

        // 绑定卡片点击事件
        els.viewContainer.querySelectorAll('.song-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button') || e.target.closest('.tag-badge')) return;
                Player.play(card.dataset.songId);
            });
        });
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ========== 标签卡片网格（首页） ==========

    /** 所有标签的 emoji 映射 */
    function getTagEmoji(name) {
        const map = {
            '2026热歌': '🔥', '一人一首成名曲': '⭐', '粤语': '🎬',
            'KTV': '🎤', '民谣': '🎸', '热门': '🔥',
            '动漫': '🎭', '经典': '📻', '伤感': '💔',
            '古风': '🏯', '8090': '📼', '游戏': '🎮',
            '纯音乐': '🎹', '英语': '🌍', '摇滚': '🎸',
            '明星': '🌟',
        };
        return map[name] || '🎵';
    }

    function renderTagGrid(tags) {
        if (!els.viewContainer) return;

        let html = '<div class="tag-grid">';
        tags.forEach(tag => {
            const emoji = getTagEmoji(tag.name);
            const color = tag.color || '#E8917B';
            const isStar = tag.name === '明星';
            html += `
                <div class="tag-card" data-tag-id="${tag.id}" data-tag-name="${escapeHtml(tag.name)}" data-is-star="${isStar ? '1' : '0'}" style="--tag-color:${color}">
                    <span class="tag-card-icon">${emoji}</span>
                    <div class="tag-card-name">${escapeHtml(tag.name)}</div>
                    <div class="tag-card-count">${tag.song_count || 0} 首</div>
                </div>`;
        });
        html += '</div>';

        els.viewContainer.innerHTML = html;

        requestAnimationFrame(() => _staggerCards(els.viewContainer, '.song-card, .tag-card'));
    }

    /** 明星子卡片列表 */
    function renderStarCards(parentTag) {
        if (!els.viewContainer) return;

        const children = parentTag.children || [];
        let html = '<div class="tag-grid">';
        children.forEach(tag => {
            const color = tag.color || '#E8917B';
            html += `
                <div class="tag-card" data-tag-id="${tag.id}" data-tag-name="${escapeHtml(tag.name)}" style="--tag-color:${color}">
                    <span class="tag-card-icon">🎤</span>
                    <div class="tag-card-name">${escapeHtml(tag.name)}</div>
                    <div class="tag-card-count">${tag.song_count || 0} 首</div>
                </div>`;
        });
        html += '</div>';

        els.viewContainer.innerHTML = html;

        requestAnimationFrame(() => _staggerCards(els.viewContainer, '.song-card, .tag-card'));
    }

    /** 显示/隐藏返回导航栏 */
    function updateViewHeader(show, title) {
        if (!els.viewHeader || !els.sectionHeader || !els.viewTitle) return;
        if (show) {
            els.viewHeader.style.display = 'flex';
            els.sectionHeader.style.display = 'none';
            els.viewTitle.textContent = title || '';
        } else {
            els.viewHeader.style.display = 'none';
            els.sectionHeader.style.display = 'block';
        }
    }

    /** 导航到标签歌曲列表 */
    async function navigateToTag(tagId, tagName) {
        _currentView = 'tag';
        _currentTagId = tagId;
        _currentTagName = tagName;
        updateViewHeader(true, tagName);

        // 显示加载状态
        if (els.viewContainer) {
            els.viewContainer.innerHTML = '<div class="empty-state"><span class="empty-icon">⏳</span>加载中...</div>';
        }

        try {
            const resp = await fetch(`/api/songs?tag=${encodeURIComponent(tagName)}&limit=50`);
            if (!resp.ok) throw new Error('获取歌曲失败');
            const songs = await resp.json();

            if (songs.length === 0) {
                if (els.viewContainer) {
                    els.viewContainer.innerHTML = `<div class="empty-state"><span class="empty-icon">🎵</span>该标签下暂无歌曲</div>`;
                }
                return;
            }

            mergeToCache(songs);
            _lastSearchResults = songs;
            renderSongList(songs);
        } catch (err) {
            console.error('[navigateToTag]', err);
            if (els.viewContainer) {
                els.viewContainer.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span>加载失败</div>';
            }
        }
    }

    /** 导航到明星子卡片 */
    function navigateToStar(parentTag) {
        _currentView = 'star';
        _currentTagId = parentTag.id;
        _currentTagName = parentTag.name;
        updateViewHeader(true, parentTag.name);
        renderStarCards(parentTag);
    }

    /** 返回上一级 */
    function goBack() {
        if (_currentView === 'star') {
            // 从明星子卡片返回首页
            navigateHome();
        } else if (_currentView === 'tag' || _currentView === 'search') {
            // 从歌曲列表/搜索结果返回首页
            _isSearching = false;
            if (els.searchInput) els.searchInput.value = '';
            if (els.searchClear) els.searchClear.style.display = 'none';
            navigateHome();
        }
    }

    /** 返回首页标签网格 */
    function navigateHome() {
        _currentView = 'home';
        _currentTagId = null;
        _currentTagName = '';
        _isSearching = false;
        _lastSearchResults = [];
        updateViewHeader(false, '');
        if (els.searchInput) els.searchInput.value = '';
        if (els.searchClear) els.searchClear.style.display = 'none';
        renderTagGrid(_tagsCache);
    }

    /** 在所有标签中查找（包括子标签） */
    function findTagByName(name) {
        for (const t of _tagsCache) {
            if (t.name === name) return t;
            if (t.children) {
                for (const c of t.children) {
                    if (c.name === name) return c;
                }
            }
        }
        return null;
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

    // ========== Auth UI ==========

    function updateAuthUI() {
        const headerRight = document.querySelector('.header-right');
        if (!headerRight) return;

        if (Auth.isLoggedIn()) {
            const user = Auth.getUser();
            headerRight.innerHTML = `
                <div class="user-menu-wrap">
                    <button class="btn-user" id="btnUserMenu">👤 ${escapeHtml(user.username)}</button>
                    <div class="user-dropdown" id="userDropdown" style="display:none">
                        <div class="user-dropdown-item" data-action="logout">🚪 退出登录</div>
                    </div>
                </div>`;
        } else {
            headerRight.innerHTML = `
                <button class="btn-login" id="btnLogin" data-action="login">🔑 登录</button>`;
        }
    }

    function showAuthModal(mode) {
        // mode: 'login' | 'register'
        const isLogin = mode === 'login';
        const title = isLogin ? '登录' : '注册';
        const bodyHtml = `
            <div class="auth-form">
                ${!isLogin ? '<input class="modal-input auth-input" id="authUsername" placeholder="用户名" maxlength="30" autocomplete="username">' : ''}
                <input class="modal-input auth-input" id="authEmail" type="email" placeholder="邮箱" autocomplete="email">
                <input class="modal-input auth-input" id="authPassword" type="password" placeholder="密码（至少6位）" autocomplete="${isLogin ? 'current-password' : 'new-password'}">
                <div class="auth-error" id="authError" style="display:none"></div>
            </div>`;
        const actionsHtml = `
            <button class="btn btn-secondary" data-action="cancel">取消</button>
            <button class="btn btn-primary" id="btnAuthSubmit">${isLogin ? '登录' : '注册'}</button>
            <div class="auth-switch">
                ${isLogin
                    ? '没有账号？<a data-action="switchToRegister">去注册</a>'
                    : '已有账号？<a data-action="switchToLogin">去登录</a>'}
            </div>`;

        showModal(title, bodyHtml, actionsHtml);

        // 绑定提交事件
        setTimeout(() => {
            const submitBtn = document.getElementById('btnAuthSubmit');
            const errorEl = document.getElementById('authError');

            async function handleSubmit() {
                const email = document.getElementById('authEmail').value.trim();
                const password = document.getElementById('authPassword').value;

                if (!email || !password) {
                    errorEl.textContent = '请填写所有字段';
                    errorEl.style.display = 'block';
                    return;
                }
                if (password.length < 6) {
                    errorEl.textContent = '密码至少需要6位';
                    errorEl.style.display = 'block';
                    return;
                }

                errorEl.style.display = 'none';
                submitBtn.disabled = true;
                submitBtn.textContent = '处理中...';

                try {
                    if (isLogin) {
                        await Auth.login(email, password);
                    } else {
                        const username = document.getElementById('authUsername').value.trim();
                        if (!username) {
                            errorEl.textContent = '请输入用户名';
                            errorEl.style.display = 'block';
                            submitBtn.disabled = false;
                            submitBtn.textContent = '注册';
                            return;
                        }
                        await Auth.signup(email, password, username);
                    }
                    hideModal();
                } catch (err) {
                    errorEl.textContent = err.message;
                    errorEl.style.display = 'block';
                    submitBtn.disabled = false;
                    submitBtn.textContent = isLogin ? '登录' : '注册';
                }
            }

            if (submitBtn) {
                submitBtn.addEventListener('click', handleSubmit);
            }

            // 回车提交
            const inputs = document.querySelectorAll('.auth-input');
            inputs.forEach(inp => {
                inp.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') handleSubmit();
                });
            });

            // 第一个输入框自动聚焦
            if (inputs.length > 0) inputs[0].focus();
        }, 100);
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
        // favs 现在是歌曲对象数组
        els.panelFav.innerHTML = `
            <button class="btn-play-all" data-action="playAllFav">▶ 全部播放（${favs.length} 首）</button>
            ${favs.map(song => `
                <div class="playlist-item" data-song-id="${song.id}">
                    <div class="pl-name">${escapeHtml(song.title)}</div>
                    <button class="btn-delete" data-action="unfav" data-song-id="${song.id}">✕</button>
                </div>`).join('')}`;
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
                <div class="playlist-item" data-pl-name="${escapeHtml(pl.name)}" data-pl-id="${pl.id}">
                    <button class="btn-playlist-play" data-action="playAllPl" data-pl-id="${pl.id}" title="全部播放">▶</button>
                    <div class="pl-name">📁 ${escapeHtml(pl.name)}</div>
                    <div class="pl-count">${pl.song_count} 首</div>
                    <button class="btn-delete" data-action="delPl" data-pl-id="${pl.id}" data-pl-name="${escapeHtml(pl.name)}">✕</button>
                </div>`).join('');
        }
        if (Auth.isLoggedIn()) {
            html += `<button class="btn-new-pl" id="btnNewPl">+ 新建歌单</button>`;
        }
        els.panelPl.innerHTML = html;
    }

    let _detailSongs = [];  // 当前查看的歌单弹窗中的歌曲列表

    async function renderPlaylistDetail(plId, plName) {
        const songs = await PlaylistStore.getPlaylistSongs(plId);
        _detailSongs = songs;

        showModal(
            `📁 ${plName}`,
            songs.length === 0
                ? '<div class="empty-state"><span class="empty-icon">🎵</span>歌单是空的<br>在歌曲列表中点击 + 添加</div>'
                : `<button class="btn-play-all" data-action="playAllDetail">▶ 全部播放（${songs.length} 首）</button>
                   ${songs.map(song => `
                    <div class="pl-song-item" data-song-id="${song.id}">
                        <span>🎵 ${escapeHtml(song.title)}</span>
                        <button class="btn-remove-song" data-action="removeFromPl" data-pl-id="${plId}" data-pl-name="${escapeHtml(plName)}" data-song-id="${song.id}">✕</button>
                    </div>`).join('')}`,
            ''
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
            `<button class="btn btn-secondary" data-action="cancel" id="btnModalCancel">取消</button>
             <button class="btn btn-primary" data-action="confirm" id="btnModalConfirm">创建</button>`
        );
        setTimeout(() => {
            const inp = document.getElementById('inputPlName');
            if (inp) {
                inp.focus();
                inp.addEventListener('keydown', async (e) => {
                    if (e.key === 'Enter') {
                        const created = await PlaylistStore.createPlaylist(inp.value.trim());
                        if (created) {
                            hideModal();
                        } else {
                            alert('歌单名重复或无效');
                        }
                    }
                });
            }
        }, 100);
    }

    async function showAddToPlaylistModal(songId) {
        const pls = await PlaylistStore.getPlaylists();
        if (pls.length === 0) {
            showModal(
                '添加到歌单',
                '<div class="empty-state"><span class="empty-icon">📋</span>还没有歌单<br>请先在右侧面板新建歌单</div>',
                '<button class="btn btn-secondary" data-action="cancel">关闭</button>'
            );
            return;
        }
        showModal(
            '添加到歌单',
            pls.map(pl => {
                const songsInPl = pl.song_count; // 用 song_count 快速判断
                return `<div class="playlist-item" data-action="doAddToPl" data-pl-id="${pl.id}" data-pl-name="${escapeHtml(pl.name)}" data-song-id="${songId}">
                    <div class="pl-name">📁 ${escapeHtml(pl.name)}</div>
                    <div style="font-size:12px;color:var(--text-muted)">点击添加</div>
                </div>`;
            }).join(''),
            '<button class="btn btn-secondary" data-action="cancel">关闭</button>'
        );
    }

    // ========== 搜索功能 ==========
    let _searchTimer = null;
    let _isSearching = false;        // 当前是否在搜索模式
    let _defaultSongs = [];          // 默认歌曲缓存（搜索清空后恢复）
    let _lastSearchResults = [];     // 最近一次搜索结果（用于面板刷新时保持显示）
    let _savedView = null;           // 搜索前的视图状态（用于取消搜索后恢复）

    function setupSearch() {
        const input = els.searchInput;
        const clearBtn = els.searchClear;
        if (!input) return;

        // 创建搜索历史下拉
        const dropdown = document.createElement('div');
        dropdown.className = 'search-history-dropdown';
        dropdown.style.display = 'none';
        input.parentNode.appendChild(dropdown);

        function renderHistoryDropdown() {
            const history = PlaylistStore.getSearchHistory();
            if (history.length === 0) {
                dropdown.style.display = 'none';
                return;
            }
            dropdown.innerHTML = `
                <div class="shd-header">
                    <span>🕐 最近搜索</span>
                    <button class="shd-clear" id="btnClearHistory">清除</button>
                </div>
                ${history.map(h => `
                    <div class="shd-item" data-query="${escapeHtml(h)}">
                        <span class="shd-query">${escapeHtml(h)}</span>
                    </div>
                `).join('')}
            `;
            dropdown.style.display = 'block';
        }

        function hideHistoryDropdown() {
            setTimeout(() => { dropdown.style.display = 'none'; }, 150);
        }

        // 下拉点击事件
        dropdown.addEventListener('mousedown', (e) => {
            e.preventDefault(); // 阻止 input 失焦
            const item = e.target.closest('.shd-item');
            const clearBtn2 = e.target.closest('#btnClearHistory');
            if (item) {
                const q = item.dataset.query;
                input.value = q;
                clearBtn.style.display = 'flex';
                doSearch(q, { logMiss: true });
                dropdown.style.display = 'none';
            } else if (clearBtn2) {
                PlaylistStore.clearSearchHistory();
                dropdown.style.display = 'none';
            }
        });

        // 聚焦时显示历史
        input.addEventListener('focus', () => {
            if (!input.value.trim()) {
                renderHistoryDropdown();
            }
        });

        // 失焦时隐藏
        input.addEventListener('blur', () => {
            hideHistoryDropdown();
        });

        // 输入 → 防抖搜索
        input.addEventListener('input', () => {
            const q = input.value.trim();
            clearBtn.style.display = q ? 'flex' : 'none';

            if (q) {
                dropdown.style.display = 'none'; // 有输入时隐藏历史
            }

            clearTimeout(_searchTimer);
            if (!q) {
                // 清空搜索框 → 恢复之前视图
                _isSearching = false;
                _lastSearchResults = [];
                restorePreviousView();
                return;
            }

            _searchTimer = setTimeout(() => doSearch(q), 300);  // 实时搜索，不记录缺失
        });

        // 回车立即搜索（主动搜索 → 记录缺失）
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                clearTimeout(_searchTimer);
                const q = input.value.trim();
                if (q) doSearch(q, { logMiss: true });
            }
        });

        // 清除按钮
        clearBtn.addEventListener('click', () => {
            input.value = '';
            clearBtn.style.display = 'none';
            _isSearching = false;
            _lastSearchResults = [];
            restorePreviousView();
            input.focus();
        });
    }

    /** 取消搜索后恢复之前的视图 */
    function restorePreviousView() {
        if (_savedView) {
            const sv = _savedView;
            _savedView = null;
            _currentView = sv.view;
            _currentTagId = sv.tagId;
            _currentTagName = sv.tagName;

            if (sv.view === 'home') {
                navigateHome();
            } else if (sv.view === 'tag') {
                updateViewHeader(true, sv.tagName);
                navigateToTag(sv.tagId, sv.tagName);
            } else if (sv.view === 'star') {
                updateViewHeader(true, sv.tagName);
                const parentTag = _tagsCache.find(t => t.id === sv.tagId);
                if (parentTag) renderStarCards(parentTag);
            }
        } else {
            navigateHome();
        }
    }

    async function doSearch(q, { logMiss = false } = {}) {
        if (!q || q.length > 100) return;

        // 保存搜索前的视图状态
        if (!_isSearching) {
            _savedView = {
                view: _currentView,
                tagId: _currentTagId,
                tagName: _currentTagName,
            };
        }

        _isSearching = true;
        updateViewHeader(true, `搜索: ${q}`);

        // 保存搜索历史
        PlaylistStore.addSearchHistory(q);

        try {
            const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            if (!resp.ok) return;
            const data = await resp.json();

            if (data.results && data.results.length > 0) {
                // 有结果 → 合并到 _songCache（收藏面板需要），然后渲染
                mergeToCache(data.results);
                _lastSearchResults = data.results;
                renderSongList(data.results);
            } else {
                // 无结果 → 显示空状态，仅在主动搜索时记录
                _isSearching = false;
                renderSearchEmpty(q);
                if (logMiss) {
                    logSearchMiss(q);
                }
            }
        } catch (err) {
            console.error('[search]', err);
        }
    }

    function renderSearchEmpty(q) {
        if (!els.viewContainer) return;
        els.viewContainer.innerHTML = `
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

    // ========== 歌词窗口管理 ==========

    function openLyricsWindow() {
        // 如果窗口已存在且未关闭，聚焦
        if (lyricsWindow && !lyricsWindow.closed) {
            lyricsWindow.focus();
            return;
        }

        const song = Player.getCurrentSong();
        const songId = song ? song.id : '';

        lyricsWindow = window.open(
            `/lyrics.html?songId=${songId}`,
            'lyricsWin',
            'width=360,height=520,menubar=no,toolbar=no,location=no,status=no'
        );

        if (!lyricsWindow) {
            alert('歌词窗口被浏览器拦截，请允许弹窗后重试');
            return;
        }

        // 等窗口加载后发送初始歌曲信息
        lyricsWindow.addEventListener('load', () => {
            if (song) {
                try {
                    const bc = new BroadcastChannel('music_player_lyrics');
                    bc.postMessage({
                        type: 'lyrics-open',
                        id: song.id,
                    });
                    bc.close();
                } catch {}
            }
        });
    }

    function closeLyricsWindow() {
        if (lyricsWindow && !lyricsWindow.closed) {
            lyricsWindow.close();
        }
        lyricsWindow = null;
    }

    function setupLyricsChannel() {
        try {
            const bc = new BroadcastChannel('music_player_lyrics');
            bc.onmessage = (e) => {
                const msg = e.data;
                if (!msg || !msg.type) return;

                switch (msg.type) {
                    case 'lyrics-closed':
                        lyricsWindow = null;
                        break;
                    case 'mode-change':
                        // 可存储用户偏好，当前不需要
                        break;
                }
            };
        } catch {}
    }

    // ========== 全局事件代理 ==========

    function setupGlobalListeners() {
        // 返回按钮
        if (els.btnBack) {
            els.btnBack.addEventListener('click', () => goBack());
        }

        // 标签卡片点击（事件代理）
        if (els.viewContainer) {
            els.viewContainer.addEventListener('click', (e) => {
                const tagCard = e.target.closest('.tag-card');
                if (tagCard) {
                    const tagId = parseInt(tagCard.dataset.tagId);
                    const tagName = tagCard.dataset.tagName;
                    const isStar = tagCard.dataset.isStar === '1';

                    if (isStar) {
                        // 明星 → 显示子卡片
                        const parentTag = _tagsCache.find(t => t.id === tagId);
                        if (parentTag) navigateToStar(parentTag);
                    } else if (_currentView === 'star') {
                        // 在明星子卡片视图 → 点击子明星 → 查看歌曲
                        navigateToTag(tagId, tagName);
                    } else {
                        // 首页普通标签 → 查看歌曲
                        navigateToTag(tagId, tagName);
                    }
                    return;
                }

                // 标签徽章点击 → 导航到该标签的歌曲列表
                const tagBadge = e.target.closest('.tag-badge');
                if (tagBadge) {
                    e.stopPropagation();
                    const tagName = tagBadge.dataset.tagName;
                    // 找到对应标签
                    const found = findTagByName(tagName);
                    if (found) {
                        if (els.searchInput) {
                            els.searchInput.value = '';
                            els.searchClear.style.display = 'none';
                        }
                        _isSearching = false;
                        _savedView = null;
                        navigateToTag(found.id, found.name);
                    }
                    return;
                }
            });
        }

        document.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;

            switch (action) {
                // 登录按钮点击
                case 'login': {
                    showAuthModal('login');
                    break;
                }

                // 切换到注册
                case 'switchToRegister': {
                    showAuthModal('register');
                    break;
                }

                // 切换到登录
                case 'switchToLogin': {
                    showAuthModal('login');
                    break;
                }

                // 全部播放 — 收藏
                case 'playAllFav': {
                    const favs = PlaylistStore.getFavorites();
                    if (favs.length > 0) Player.playAll(favs);
                    break;
                }

                // 全部播放 — 歌单（从面板）
                case 'playAllPl': {
                    const plSongs = await PlaylistStore.getPlaylistSongs(btn.dataset.plId);
                    if (plSongs.length > 0) Player.playAll(plSongs);
                    break;
                }

                // 全部播放 — 歌单详情弹窗
                case 'playAllDetail': {
                    if (_detailSongs.length > 0) Player.playAll(_detailSongs);
                    hideModal();
                    break;
                }

                // 退出登录
                case 'logout': {
                    if (confirm('确定退出登录吗？')) {
                        Auth.logout();
                    }
                    break;
                }

                // 收藏切换（乐观更新在 PlaylistStore 中，onChange → refreshAll）
                case 'fav': {
                    e.stopPropagation();
                    if (!Auth.isLoggedIn()) {
                        showAuthModal('login');
                        return;
                    }
                    PlaylistStore.toggleFavorite(btn.dataset.songId);
                    break;
                }

                // 添加到歌单
                case 'addToPl': {
                    e.stopPropagation();
                    if (!Auth.isLoggedIn()) {
                        showAuthModal('login');
                        return;
                    }
                    showAddToPlaylistModal(btn.dataset.songId);
                    break;
                }

                // 在 modal 中确认添加到歌单（乐观更新 + onChange → refreshAll）
                case 'doAddToPl': {
                    PlaylistStore.addToPlaylist(btn.dataset.plId, btn.dataset.songId);
                    hideModal();
                    break;
                }

                // 取消收藏（乐观更新 + onChange → refreshAll）
                case 'unfav': {
                    PlaylistStore.removeFavorite(btn.dataset.songId);
                    break;
                }

                // 删除歌单
                case 'delPl': {
                    e.stopPropagation();
                    const plId = btn.dataset.plId;
                    const plName = btn.dataset.plName;
                    if (confirm(`确定删除歌单「${plName}」吗？`)) {
                        PlaylistStore.deletePlaylist(plId);
                    }
                    break;
                }

                // 从歌单中移除歌曲
                case 'removeFromPl': {
                    e.stopPropagation();
                    PlaylistStore.removeFromPlaylist(btn.dataset.plId, btn.dataset.songId);
                    await renderPlaylistDetail(btn.dataset.plId, btn.dataset.plName);
                    break;
                }

                // Modal 取消
                case 'btnModalCancel':
                case 'cancel': {
                    hideModal();
                    break;
                }

                // Modal 确认（新建歌单 — onChange 自动触发 refreshAll）
                case 'btnModalConfirm':
                case 'confirm': {
                    const inp = document.getElementById('inputPlName');
                    if (inp && inp.value.trim()) {
                        const created = await PlaylistStore.createPlaylist(inp.value.trim());
                        if (created) {
                            hideModal();
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
            const item = e.target.closest('.playlist-item[data-pl-id]');
            if (!item) return;
            if (e.target.closest('button')) return;
            renderPlaylistDetail(item.dataset.plId, item.dataset.plName);
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

        // 用户菜单下拉
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('#btnUserMenu');
            if (btn) {
                const dropdown = document.getElementById('userDropdown');
                if (dropdown) {
                    dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
                }
                return;
            }
            // 点击其他地方关闭
            const dropdown = document.getElementById('userDropdown');
            if (dropdown && !e.target.closest('.user-menu-wrap')) {
                dropdown.style.display = 'none';
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
        if (els.btnLyrics) els.btnLyrics.addEventListener('click', () => openLyricsWindow());

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

    // ========== 视图切换动画 ==========

    /**
     * 卡片 stagger 入场：为 .song-card 或 .tag-card 依次添加 animation-delay
     */
    function _staggerCards(container, selector) {
        const cards = container.querySelectorAll(selector);
        cards.forEach((card, i) => {
            card.style.animationDelay = `${i * 50}ms`;
        });
    }

    // ========== 全局刷新 ==========

    function refreshAll() {
        // 搜索模式下保持搜索结果显示
        if (_isSearching && _lastSearchResults.length > 0) {
            renderSongList(_lastSearchResults);
        } else if (_currentView === 'home') {
            renderTagGrid(_tagsCache);
        } else if (_currentView === 'tag') {
            // 标签视图下保持显示歌曲
            if (_lastSearchResults.length > 0) {
                renderSongList(_lastSearchResults);
            }
        } else if (_currentView === 'star') {
            const parentTag = _tagsCache.find(t => t.id === _currentTagId);
            if (parentTag) renderStarCards(parentTag);
        }
        updatePlayBar();
        updateModeDisplay();
        if (els.panelFav && els.panelFav.style.display !== 'none') renderFavoritesPanel();
        if (els.panelPl && els.panelPl.style.display !== 'none') renderPlaylistsPanel();

        // 如果抽屉打开，同步更新
        const sheet = document.getElementById('drawerSheet');
        if (sheet && sheet.classList.contains('show')) {
            // 重新复制当前激活 tab 的内容
            const favTab = document.getElementById('tabFav');
            const isFav = favTab && favTab.classList.contains('active');
            const source = isFav
                ? document.getElementById('panelFav')
                : document.getElementById('panelPl');
            const content = document.getElementById('drawerContent');
            if (source && content) {
                content.innerHTML = source.innerHTML;
            }
        }
    }

    // ========== 初始化 ==========

    async function init(songs, tags) {
        cacheDom();
        window._songCache = songs;
        _defaultSongs = songs;
        _tagsCache = tags || [];
        Player.setSongs(songs);
        Player.init();

        // 恢复登录状态
        await Auth.init();
        updateAuthUI();

        // 如果已登录，加载服务器数据
        if (Auth.isLoggedIn()) {
            await PlaylistStore.loadFromServer();
        }

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

        // 监听登录状态变化
        Auth.onChange(async (user) => {
            updateAuthUI();
            if (user) {
                await PlaylistStore.loadFromServer();
            } else {
                PlaylistStore.clearAll();
            }
            refreshAll();
        });

        setupLyricsChannel();
        setupGlobalListeners();
        // 默认显示首页标签卡片网格（而非歌曲列表）
        renderTagGrid(_tagsCache);
        updatePlayBar();
        updateModeDisplay();
        switchPanel('fav'); // 默认显示收藏面板
        setupSearch();

        // 主窗口关闭时自动关闭歌词窗口
        window.addEventListener('beforeunload', () => {
            closeLyricsWindow();
        });

        // FAB 按钮 — 打开抽屉
        const fabBtn = document.getElementById('fabDrawer');
        if (fabBtn) {
            fabBtn.addEventListener('click', () => UI.openDrawer('fav'));
        }

        // 点击遮罩关闭抽屉
        const drawerOverlay = document.getElementById('drawerOverlay');
        if (drawerOverlay) {
            drawerOverlay.addEventListener('click', () => UI.closeDrawer());
        }
    }

    // ========== 平板底部抽屉 ==========

    /**
     * 打开底部抽屉（平板模式）
     * @param {'fav'|'pl'} tab — 默认激活的 tab
     */
    openDrawer(tab = 'fav') {
        const overlay = document.getElementById('drawerOverlay');
        const sheet = document.getElementById('drawerSheet');
        const content = document.getElementById('drawerContent');

        // 复制面板内容到抽屉
        const source = tab === 'fav'
            ? document.getElementById('panelFav')
            : document.getElementById('panelPl');
        if (source) {
            content.innerHTML = source.innerHTML;
        }

        // 显示抽屉
        overlay.style.display = 'block';
        sheet.style.display = 'flex';
        requestAnimationFrame(() => {
            overlay.classList.add('show');
            sheet.classList.add('show');
        });
    },

    /**
     * 关闭底部抽屉
     */
    closeDrawer() {
        const overlay = document.getElementById('drawerOverlay');
        const sheet = document.getElementById('drawerSheet');
        overlay.classList.remove('show');
        sheet.classList.remove('show');
        setTimeout(() => {
            overlay.style.display = '';
            sheet.style.display = '';
        }, 400);
    },

    /**
     * 判断当前是否为平板宽度（抽屉模式）
     */
    _isTablet() {
        return window.innerWidth < 1024;
    },

    return {
        init,
        renderSongList,
        renderTagGrid,
        navigateToTag,
        navigateHome,
        updatePlayBar,
        updateModeDisplay,
        refreshAll,
        hideModal,
        openDrawer,
        closeDrawer,
    };
})();
