/**
 * download_tag_bg.js — 下载分类标签背景图到本地 public/images/tags/
 * ===========================================================================
 * 用法: /d/softwa/nodejs/node scripts/download_tag_bg.js
 *
 * 从 picsum.photos 下载每个标签分类的高清背景图，保存到本地。
 * 使用 /seed/{seed}/{w}/{h} 格式，相同 seed 返回相同图片，确保幂等性。
 * 图片下载后，刷新网页即可看到本地背景图（无需依赖外部 CDN）。
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ========== 标签分类 → picsum.photos seed（50+ 张高清背景图） ==========
// 每个 seed 是唯一字符串 → picsum 返回不同的 Unsplash 高清图片
const TAG_QUERIES = {
    // —— 原有 15 张 ——
    '热门': 'concert',
    '经典': 'retro-vinyl',
    '华语': 'chinese-lantern',
    '粤语': 'hongkong-neon',
    '民谣': 'acoustic-guitar',
    '摇滚': 'electric-rock',
    '古风': 'chinese-traditional',
    '影视': 'cinema-film',
    '轻音乐': 'piano-keys',
    '一人一首成名曲': 'spotlight-stage',
    '情歌': 'romantic-sunset',
    '青春': 'cherry-blossom',
    '治愈': 'forest-nature',
    '励志': 'mountain-sunrise',
    '流行': 'neon-colorful',

    // —— 新增 45 张（乐器/演出/自然/城市/抽象/氛围） ——
    // 音乐 & 演出
    '鼓点': 'drum-solo-performance',
    '萨克斯': 'saxophone-closeup-jazz',
    '小提琴': 'violin-strings-orchestra',
    '贝斯': 'bass-groove-lowlight',
    '小号': 'trumpet-brass-blues',
    'DJ': 'dj-turntable-mixer',
    '麦克风': 'microphone-stage-closeup',
    '耳机': 'headphones-music-listening',
    '黑胶': 'vinyl-collection-retro',
    '乐谱': 'sheet-music-vintage',
    '音乐节': 'music-festival-crowd',
    '录音棚': 'studio-recording-desk',

    // 自然 & 风景
    '秋叶': 'autumn-forest-path',
    '沙漠': 'desert-dunes-sunset',
    '海浪': 'ocean-waves-crashing',
    '雪山': 'snowy-peak-alpine',
    '薰衣草': 'lavender-field-purple',
    '瀑布': 'waterfall-cliffs-mist',
    '竹林': 'bamboo-grove-green',
    '极光': 'aurora-borealis-sky',
    '星空': 'starry-night-milkyway',
    '草原': 'wildflower-meadow-sunset',
    '湖泊': 'lake-reflection-mirror',
    '彩虹': 'rainbow-after-storm',

    // 城市 & 建筑
    '城市夜景': 'city-skyline-night',
    '雨街': 'rainy-street-reflection',
    '咖啡馆': 'coffee-shop-interior',
    '霓虹': 'night-market-lanterns',
    '古寺': 'ancient-temple-architecture',
    '天桥': 'bridge-sunset-silhouette',
    '隧道': 'subway-tunnel-lights',
    '书店': 'vintage-bookstore-shelves',
    '涂鸦': 'street-art-graffiti-wall',

    // 抽象 & 质感
    '油彩': 'oil-paint-swirl-colors',
    '水彩': 'watercolor-wash-abstract',
    '纹理': 'marble-texture-elegant',
    '光影': 'bokeh-lights-defocused',
    '烟雾': 'smoke-trail-abstract',
    '棱镜': 'prism-light-refraction',
    '水墨': 'ink-water-diffusion',
    '丝绸': 'silk-fabric-flowing',

    // 氛围 & 情绪
    '黄昏': 'golden-hour-warm-light',
    '篝火': 'bonfire-night-sparks',
    '迷雾': 'misty-morning-forest',
    '禅意': 'zen-meditation-garden',
    '公路': 'road-trip-adventure',
    '深空': 'cosmic-nebula-deep-space',
};

const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'tags');
const WIDTH = 600;
const HEIGHT = 400;

// ========== 工具函数 ==========

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** 下载图片（自动跟随重定向） */
function downloadImage(url, destPath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url, { timeout: 15000 }, (response) => {
            // 跟随重定向
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                const redirectUrl = response.headers.location;
                response.resume();
                return downloadImage(redirectUrl, destPath).then(resolve).catch(reject);
            }

            if (response.statusCode !== 200) {
                response.resume();
                return reject(new Error(`HTTP ${response.statusCode}`));
            }

            const file = fs.createWriteStream(destPath);
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                const stats = fs.statSync(destPath);
                if (stats.size < 1000) {
                    fs.unlinkSync(destPath);
                    return reject(new Error(`图片过小 (${stats.size} bytes)，可能无效`));
                }
                resolve(stats.size);
            });
            file.on('error', (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        }).on('error', reject)
          .on('timeout', function() {
              this.destroy();
              reject(new Error('请求超时'));
          });
    });
}

// ========== 主流程 ==========

async function main() {
    // 确保输出目录存在
    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }
    console.log(`输出目录: ${OUT_DIR}\n`);

    const entries = Object.entries(TAG_QUERIES);
    let downloaded = 0;
    let failed = 0;

    for (let i = 0; i < entries.length; i++) {
        const [name, seed] = entries[i];
        const safeName = name.replace(/[\/\\:*?"<>|]/g, '_');
        const destPath = path.join(OUT_DIR, `${safeName}.jpg`);

        // 跳过已下载的
        if (fs.existsSync(destPath)) {
            const stats = fs.statSync(destPath);
            if (stats.size > 1000) {
                console.log(`[${i + 1}/${entries.length}] ${name} — 已存在 (${(stats.size / 1024).toFixed(0)} KB)`);
                downloaded++;
                continue;
            }
        }

        // picsum.photos: /seed/{seed}/{width}/{height} — 相同 seed 返回相同图片
        const url = `https://picsum.photos/seed/${encodeURIComponent(seed)}/${WIDTH}/${HEIGHT}`;
        console.log(`[${i + 1}/${entries.length}] ${name} — 下载中 (seed: ${seed})...`);

        try {
            const size = await downloadImage(url, destPath);
            console.log(`  ✓ 完成 (${(size / 1024).toFixed(0)} KB)`);
            downloaded++;
        } catch (err) {
            console.log(`  ✗ 失败: ${err.message}`);
            // 如果下载失败，删除可能的不完整文件
            if (fs.existsSync(destPath)) {
                fs.unlinkSync(destPath);
            }
            failed++;
        }

        // 限速：避免被限流
        if (i < entries.length - 1) {
            await sleep(2000);
        }
    }

    console.log(`\n========== 完成 ==========`);
    console.log(`成功: ${downloaded} 个`);
    console.log(`失败: ${failed} 个`);
    console.log(`图片目录: ${OUT_DIR}`);

    if (failed > 0) {
        console.log(`\n提示: 部分图片下载失败，可重新运行脚本重试。`);
        console.log(`如果 picsum.photos 不可用，可手动将图片放入 ${OUT_DIR} 目录。`);
        console.log(`文件命名规则: "热门.jpg", "经典.jpg", "华语.jpg" 等。`);
    }
}

main().catch(err => {
    console.error('脚本执行失败:', err);
    process.exit(1);
});
