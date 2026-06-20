/**
 * player.js — 音频播放控制
 * ==========================
 * 管理 <audio> 元素、播放状态、模式切换、前后曲目逻辑。
 */

const Player = (() => {
    // ========== 歌词同步通道 ==========
    let lyricsChannel = null;
    try {
        lyricsChannel = new BroadcastChannel('music_player_lyrics');
    } catch (e) {
        // BroadcastChannel 不可用（旧浏览器），静默降级
    }

    // ========== 内部状态 ==========
    let audio = null;
    let songs = [];                // 歌曲元数据缓存
    let currentSong = null;       // 当前加载的歌曲对象
    let isPlaying = false;
    let playMode = 'loop';        // 'loop' | 'single' | 'shuffle'
    let shuffleQueue = [];        // 随机播放队列（歌曲 ID）
    let shuffleIdx = -1;
    let startTime = 0;            // 片段起始秒数（如离别开出花从 45:48 开始）
    let endTime = null;           // 片段结束秒数
    let pageDuration = null;      // B站视频页面总时长（fallback，当 audio.duration 为 Infinity 时使用）
    let listeners = [];

    // ========== 事件系统 ==========
    function emit(event, data) {
        listeners.forEach(fn => fn(event, data));
    }

    /** 注册事件回调: fn(eventName, data) */
    function on(fn) {
        listeners.push(fn);
        return () => { listeners = listeners.filter(f => f !== fn); };
    }

    // ========== 初始化 ==========
    function init() {
        if (audio) return;
        audio = new Audio();
        audio.preload = 'auto';

        let seekFallbackTimer = null;
        let hasSeeked = false;

        audio.addEventListener('loadedmetadata', () => {
            // 流式音频的 audio.duration 可能为 Infinity → 用 pageDuration 回退
            const dur = isFinite(audio.duration) ? audio.duration : (pageDuration || 0);
            emit('duration', dur);
            // 如果有片段起始时间，跳转到该位置
            if (startTime > 0) {
                hasSeeked = false;
                audio.currentTime = startTime;

                // Fallback: 如果 3 秒内 seek 未成功（CDN 不支持 Range），快速静音快进
                seekFallbackTimer = setTimeout(() => {
                    if (!hasSeeked && audio.currentTime < startTime - 5) {
                        seekByFastForward(startTime);
                    }
                }, 3000);
            }
        });

        audio.addEventListener('seeked', () => {
            hasSeeked = true;
            if (seekFallbackTimer) {
                clearTimeout(seekFallbackTimer);
                seekFallbackTimer = null;
            }
        });

        audio.addEventListener('timeupdate', () => {
            const ct = audio.currentTime;
            // 处理片段结束
            if (endTime && ct >= endTime) {
                audio.pause();
                emit('ended');
                return;
            }
            // 快进 fallback 中：检查是否已越过目标
            if (audio.muted && audio.playbackRate > 1 && startTime > 0 && ct >= startTime) {
                audio.pause();
                audio.playbackRate = 1;
                audio.muted = false;
                audio.currentTime = startTime;
                audio.play();
                return;
            }
            const displayTime = startTime > 0 ? ct - startTime : ct;
            const totalDuration = endTime ? (endTime - startTime) : (isFinite(audio.duration) ? audio.duration : (pageDuration || 0));
            emit('timeupdate', {
                current: ct,
                displayCurrent: Math.max(0, displayTime),
                duration: audio.duration,
                displayDuration: totalDuration || 0,
                progress: totalDuration > 0 ? (displayTime / totalDuration) * 100 : 0,
            });

            // 歌词同步：推送当前播放时间
            if (lyricsChannel) {
                try {
                    lyricsChannel.postMessage({
                        type: 'time-update',
                        currentTime: displayTime,  // 已扣除 startTime 偏移
                    });
                } catch {}
            }
        });

        audio.addEventListener('ended', () => {
            emit('ended');
        });

        audio.addEventListener('play', () => {
            isPlaying = true;
            emit('playState', true);
        });

        audio.addEventListener('pause', () => {
            isPlaying = false;
            emit('playState', false);
        });

        audio.addEventListener('error', () => {
            emit('error', '音频加载失败，请稍后重试');
        });

        audio.addEventListener('waiting', () => {
            emit('waiting', true);
        });

        audio.addEventListener('canplay', () => {
            emit('waiting', false);
        });
    }

    // ========== 歌曲加载 ==========

    /** 缓存歌曲列表 */
    function setSongs(list) {
        songs = list;
    }

    /** 播放整个歌单：替换歌曲列表并从第一首开始播放 */
    async function playAll(list) {
        if (!list || list.length === 0) return;
        setSongs(list);
        await play(list[0].id);
    }

    /** 加载歌曲元数据并设置 audio.src */
    async function load(songId) {
        init();
        // 优先在 Player 内部列表查找，回退到全局 songCache
        let song = songs.find(s => String(s.id) === String(songId));
        if (!song && window._songCache) {
            song = window._songCache.find(s => String(s.id) === String(songId));
        }
        if (!song) {
            emit('error', '歌曲不存在');
            return;
        }

        // 如果当前是同一首歌且已经加载过，直接播放
        if (currentSong && String(currentSong.id) === String(songId) && audio.src) {
            if (!isPlaying) {
                await audio.play();
            }
            return;
        }

        currentSong = song;

        // 歌词同步：推送歌曲切换
        if (lyricsChannel) {
            try {
                lyricsChannel.postMessage({
                    type: 'song-change',
                    id: song.id,
                });
            } catch {}
        }

        startTime = song.start_time || 0;
        endTime = song.end_time || null;
        pageDuration = song.page_duration || null;

        emit('loading', song);

        // 设置音频源（通过后端代理）
        audio.src = `/api/stream/${song.id}`;
        audio.load();

        try {
            await audio.play();
        } catch (err) {
            // 浏览器可能阻止自动播放
            emit('error', '播放被阻止，请点击播放按钮');
        }
    }

    // ========== 播放控制 ==========

    /** Fallback seek: 当 Range 请求不被 CDN 支持时，快速静音快进到目标位置 */
    function seekByFastForward(targetTime) {
        if (!audio || !audio.src) return;
        const wasPlaying = !audio.paused;
        audio.muted = true;
        audio.playbackRate = 8.0;          // 8 倍速快进
        if (audio.paused) {
            audio.play().catch(() => {});
        }
        // timeupdate 事件会在到达目标后停止快进（见 init 中的逻辑）
    }

    // ========== 播放控制 ==========

    async function play(songId) {
        if (songId !== undefined) {
            await load(songId);
        } else if (audio && audio.src) {
            try {
                await audio.play();
            } catch (err) {
                emit('error', '无法播放');
            }
        }
    }

    function pause() {
        if (audio) audio.pause();
    }

    async function togglePlay() {
        if (!audio || !audio.src) {
            // 没有加载任何歌曲：播放第一首
            if (songs.length > 0) {
                await play(songs[0].id);
            }
            return;
        }
        if (isPlaying) {
            pause();
        } else {
            try {
                await audio.play();
            } catch (err) {
                emit('error', '无法播放');
            }
        }
    }

    function seek(time) {
        if (!audio) return;
        const target = startTime > 0 ? startTime + time : time;
        audio.currentTime = target;
    }

    // ========== 上/下一首 ==========

    function getSongIds() {
        return songs.map(s => String(s.id));
    }

    function next() {
        if (songs.length === 0) return;
        const currentId = currentSong ? String(currentSong.id) : null;

        if (playMode === 'single') {
            // 单曲循环：从头播放当前歌曲
            if (audio) {
                audio.currentTime = startTime || 0;
                audio.play();
            }
            return;
        }

        if (playMode === 'shuffle') {
            // 随机模式
            if (shuffleQueue.length === 0 || shuffleIdx >= shuffleQueue.length - 1) {
                // 重新洗牌
                const ids = getSongIds();
                // Fisher-Yates
                shuffleQueue = [...ids];
                for (let i = shuffleQueue.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffleQueue[i], shuffleQueue[j]] = [shuffleQueue[j], shuffleQueue[i]];
                }
                // 确保第一首不是当前歌曲
                if (shuffleQueue.length > 1 && currentId && shuffleQueue[0] === currentId) {
                    [shuffleQueue[0], shuffleQueue[1]] = [shuffleQueue[1], shuffleQueue[0]];
                }
                shuffleIdx = 0;
            } else {
                shuffleIdx++;
            }
            play(shuffleQueue[shuffleIdx]);
            return;
        }

        // 列表循环
        const ids = getSongIds();
        if (!currentId) {
            play(ids[0]);
            return;
        }
        const idx = ids.indexOf(currentId);
        const nextIdx = (idx + 1) % ids.length;
        play(ids[nextIdx]);
    }

    function prev() {
        if (songs.length === 0) return;
        // 如果播放超过 3 秒，重新播放当前歌曲
        if (audio && audio.currentTime > 3) {
            audio.currentTime = startTime || 0;
            return;
        }

        if (playMode === 'shuffle' && shuffleQueue.length > 0) {
            if (shuffleIdx > 0) {
                shuffleIdx--;
                play(shuffleQueue[shuffleIdx]);
                return;
            }
        }

        const ids = getSongIds();
        const currentId = currentSong ? String(currentSong.id) : null;
        if (!currentId) { play(ids[0]); return; }
        const idx = ids.indexOf(currentId);
        const prevIdx = (idx - 1 + ids.length) % ids.length;
        play(ids[prevIdx]);
    }

    // ========== 模式切换 ==========

    function setMode(mode) {
        const modes = ['loop', 'single', 'shuffle'];
        if (mode === 'next') {
            const idx = modes.indexOf(playMode);
            playMode = modes[(idx + 1) % modes.length];
        } else if (modes.includes(mode)) {
            playMode = mode;
        }
        // 切换到随机时重置队列
        if (playMode === 'shuffle') {
            shuffleQueue = [];
            shuffleIdx = -1;
        }
        emit('modeChange', playMode);
    }

    function getMode() {
        return playMode;
    }

    // ========== 查询 ==========

    function getCurrentSong() {
        return currentSong;
    }

    function getIsPlaying() {
        return isPlaying;
    }

    function getCurrentTime() {
        if (!audio) return 0;
        const raw = audio.currentTime;
        return startTime > 0 ? Math.max(0, raw - startTime) : raw;
    }

    function getDuration() {
        if (endTime) return endTime - startTime;
        if (!audio) return pageDuration || 0;
        return isFinite(audio.duration) ? audio.duration : (pageDuration || 0);
    }

    return {
        init,
        on,
        setSongs,
        playAll,
        play,
        pause,
        togglePlay,
        seek,
        next,
        prev,
        setMode,
        getMode,
        getCurrentSong,
        getIsPlaying,
        getCurrentTime,
        getDuration,
    };
})();
