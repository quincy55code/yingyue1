/**
 * lyrics.js — 歌词弹出窗口逻辑
 * =================================
 * 在 lyrics.html 独立窗口中运行。
 * 通过 BroadcastChannel 与主窗口通信。
 */

const Lyrics = (() => {
    // ========== 状态 ==========
    let mode = 'vertical';       // 'vertical' | 'horizontal'
    let lines = [];              // [{ time: number, text: string }, ...]
    let currentLineIdx = -1;
    let songTitle = '';
    let songSinger = '';

    // ========== DOM 引用 ==========
    let elHeader, elTitle, elSinger, elBody, elBtnMode, elBtnClose;

    function cacheDom() {
        elHeader  = document.getElementById('lyricsHeader');
        elTitle   = document.getElementById('lyricsTitle');
        elSinger  = document.getElementById('lyricsSinger');
        elBody    = document.getElementById('lyricsBody');
        elBtnMode = document.getElementById('btnMode');
        elBtnClose= document.getElementById('btnClose');
    }

    // ========== LRC 解析 ==========

    function parseLRC(lrcText) {
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

    // ========== 渲染 ==========

    function render() {
        if (!elBody) return;

        if (lines.length === 0) {
            elBody.innerHTML = `
                <div class="lyrics-empty">
                    <div class="empty-icon">🎵</div>
                    <div>暂无歌词</div>
                </div>`;
            return;
        }

        if (mode === 'vertical') {
            renderVertical();
        } else {
            renderHorizontal();
        }
    }

    function renderVertical() {
        // 显示当前行前后各 4~5 行，共约 10 行
        const visibleCount = 10;
        const halfCount = Math.floor(visibleCount / 2);
        let startIdx = Math.max(0, currentLineIdx - halfCount);
        const endIdx = Math.min(lines.length, startIdx + visibleCount);

        // 尽量填满 10 行
        if (endIdx - startIdx < visibleCount) {
            startIdx = Math.max(0, endIdx - visibleCount);
        }

        const visibleLines = lines.slice(startIdx, endIdx);

        elBody.innerHTML = `
            <div class="lyrics-vertical" style="transform: translateY(${-Math.max(0, currentLineIdx - startIdx - halfCount) * 0}px)">
                ${visibleLines.map((l, i) => {
                    const globalIdx = startIdx + i;
                    const cls = globalIdx === currentLineIdx ? 'lyric-line active' : 'lyric-line';
                    return `<div class="${cls}" data-idx="${globalIdx}">${escapeHtml(l.text)}</div>`;
                }).join('')}
            </div>`;
    }

    function renderHorizontal() {
        const currentLine = lines[currentLineIdx] || null;
        const nextLine = currentLineIdx >= 0 && currentLineIdx < lines.length - 1
            ? lines[currentLineIdx + 1] : null;

        elBody.innerHTML = `
            <div class="lyrics-horizontal">
                <div class="lyric-line active">${currentLine ? escapeHtml(currentLine.text) : '♪'}</div>
                <div class="lyric-line next-line">${nextLine ? escapeHtml(nextLine.text) : ''}</div>
            </div>`;
    }

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

    // ========== 时间同步 ==========

    function syncTime(currentSec) {
        if (lines.length === 0) return;

        // 二分查找当前行：最后一个 time <= currentSec 的行
        let lo = 0, hi = lines.length - 1;
        let found = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (lines[mid].time <= currentSec) {
                found = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }

        if (found !== currentLineIdx) {
            currentLineIdx = found;
            render();
        }
    }

    // ========== 歌曲切换 ==========

    async function loadSong(songId) {
        try {
            const resp = await fetch(`/api/lyrics/${songId}`);
            if (!resp.ok) {
                lines = [];
                currentLineIdx = -1;
                render();
                return;
            }
            const data = await resp.json();
            songTitle = data.title || '';
            songSinger = data.singer || '';

            if (elTitle) elTitle.textContent = songTitle;
            if (elSinger) elSinger.textContent = songSinger;

            lines = parseLRC(data.lrc_text);
            currentLineIdx = -1;
            render();
        } catch (err) {
            console.error('[lyrics] 加载歌词失败:', err);
            lines = [];
            currentLineIdx = -1;
            render();
        }
    }

    // ========== 自适应字号 ==========

    function autoResize() {
        if (!elBody) return;

        const w = elBody.clientWidth;
        const h = elBody.clientHeight;

        if (mode === 'horizontal') {
            // 横版：active 字体按容器宽度自适应（留 16% 边距）
            const activeSize = Math.max(16, Math.min(30, w * 0.075));
            const nextSize = Math.max(12, activeSize * 0.55);
            const baseSize = Math.max(11, activeSize * 0.5);
            elBody.style.setProperty('--h-active-size', Math.round(activeSize) + 'px');
            elBody.style.setProperty('--h-next-size', Math.round(nextSize) + 'px');
            elBody.style.setProperty('--h-base-size', Math.round(baseSize) + 'px');
        } else {
            // 竖版：按高度自适应（约 10 行可见）
            const lineHeight = Math.max(28, Math.min(50, h / 10));
            const activeSize = Math.max(14, lineHeight * 0.52);
            const baseSize = Math.max(12, lineHeight * 0.38);
            elBody.style.setProperty('--v-active-size', Math.round(activeSize) + 'px');
            elBody.style.setProperty('--v-base-size', Math.round(baseSize) + 'px');
        }
    }

    // ========== 模式切换 ==========

    function toggleMode() {
        mode = mode === 'vertical' ? 'horizontal' : 'vertical';
        if (elBtnMode) {
            elBtnMode.textContent = mode === 'vertical' ? '≡' : '—';
            elBtnMode.title = mode === 'vertical' ? '竖条形模式' : '长条形模式';
        }
        autoResize();
        render();

        // 通知主窗口
        try {
            const bc = new BroadcastChannel('music_player_lyrics');
            bc.postMessage({ type: 'mode-change', mode });
            bc.close();
        } catch {}
    }

    // ========== 拖拽 ==========

    function setupDrag() {
        if (!elHeader) return;
        let dragging = false;
        let startX, startY, winX, winY;

        elHeader.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            dragging = true;
            startX = e.screenX;
            startY = e.screenY;
            winX = window.screenX;
            winY = window.screenY;
            document.body.style.cursor = 'move';
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.screenX - startX;
            const dy = e.screenY - startY;
            window.moveTo(winX + dx, winY + dy);
        });

        document.addEventListener('mouseup', () => {
            if (dragging) {
                dragging = false;
                document.body.style.cursor = '';
            }
        });
    }

    // ========== BroadcastChannel 监听 ==========

    function setupChannel() {
        const bc = new BroadcastChannel('music_player_lyrics');

        bc.onmessage = (e) => {
            const msg = e.data;
            if (!msg || !msg.type) return;

            switch (msg.type) {
                case 'time-update':
                    syncTime(msg.currentTime || 0);
                    break;

                case 'lyrics-open':
                case 'song-change':
                    if (msg.id) {
                        loadSong(msg.id);
                    }
                    break;
            }
        };
    }

    // ========== 事件绑定 ==========

    function postSeek(time) {
        try {
            const bc = new BroadcastChannel('music_player_lyrics');
            bc.postMessage({ type: 'seek-to', time: time });
            bc.close();
        } catch {}
    }

    function setupEvents() {
        if (elBtnClose) {
            elBtnClose.addEventListener('click', () => {
                try {
                    const bc = new BroadcastChannel('music_player_lyrics');
                    bc.postMessage({ type: 'lyrics-closed' });
                    bc.close();
                } catch {}
                window.close();
            });
        }

        if (elBtnMode) {
            elBtnMode.addEventListener('click', toggleMode);
        }

        // 点击/拖拽歌词行跳转播放进度
        if (elBody) {
            let lyricsDragging = false;

            function seekLyricsByClientY(clientY) {
                const lineEl = document.elementFromPoint(
                    elBody.getBoundingClientRect().left + 20,
                    clientY
                )?.closest('.lyric-line');
                if (!lineEl) return;
                const idx = parseInt(lineEl.dataset.idx);
                if (!isNaN(idx) && lines[idx]) {
                    postSeek(lines[idx].time);
                }
            }

            elBody.addEventListener('mousedown', (e) => {
                const line = e.target.closest('.lyric-line');
                if (!line) return;
                lyricsDragging = true;
                const idx = parseInt(line.dataset.idx);
                if (!isNaN(idx) && lines[idx]) {
                    postSeek(lines[idx].time);
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
            elBody.addEventListener('touchstart', (e) => {
                const line = e.target.closest('.lyric-line');
                if (!line) return;
                lyricsDragging = true;
                const idx = parseInt(line.dataset.idx);
                if (!isNaN(idx) && lines[idx]) {
                    postSeek(lines[idx].time);
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
    }

    // ========== 初始化 ==========

    function init() {
        cacheDom();
        setupDrag();
        setupChannel();
        setupEvents();

        // 自适应字号
        autoResize();
        window.addEventListener('resize', () => {
            autoResize();
            render();
        });

        // 检查 URL 参数中是否有 songId，有则自动加载
        const urlParams = new URLSearchParams(window.location.search);
        const songId = urlParams.get('songId');
        if (songId) {
            loadSong(parseInt(songId, 10));
        } else {
            render();
        }

        // 设置初始按钮文字
        if (elBtnMode) {
            elBtnMode.textContent = mode === 'vertical' ? '≡' : '—';
        }
    }

    // DOM ready 后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { parseLRC, syncTime, toggleMode, loadSong };
})();
