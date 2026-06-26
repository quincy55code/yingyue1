/**
 * 批量关联歌曲和标签 → 插入 song_tags 表
 * 用法：/d/softwa/nodejs/node scripts/map_tags.js
 */
const fs = require('fs');
const path = require('path');

// 标签名 → ID 映射（从 setup 输出确认）
const TAG_IDS = {
    '2026热歌': 1, '一人一首成名曲': 2, '粤语': 3, 'KTV': 4,
    '民谣': 5, '热门': 6, '动漫': 7, '经典': 8, '伤感': 9,
    '古风': 10, '8090': 11, '游戏': 12, '纯音乐': 13, '英语': 14, '摇滚': 15,
    '明星': 16,
    '周杰伦': 17, '王菲': 18, '林俊杰': 19, '陈奕迅': 20,
    '刘德华': 21, '邓紫棋': 22, '张学友': 23, '莫文蔚': 24,
};

// 歌手 → 标签 映射
const SINGER_TAGS = {
    // 粤语歌手（注意：歌手来自香港不代表每首歌都是粤语，不再按歌手加粤语标签）
    '莫文蔚': ['经典', 'KTV'],
    '陈慧琳': ['经典', 'KTV'],
    '陈奕迅': ['经典', '陈奕迅'],
    '张学友': ['经典', '张学友'],
    '刘德华': ['经典', '刘德华'],
    '邓紫棋': ['热门', 'KTV', '邓紫棋'],
    '林俊杰': ['8090', '经典', 'KTV', '一人一首成名曲', '林俊杰'],
    '王菲': ['经典', 'KTV', '王菲'],
    '林忆莲': ['经典', 'KTV'],
    '周迅': ['经典'],
    // 古风
    '刘珂矣': ['古风', '纯音乐'],
    '音阙诗听': ['古风'],
    // 民谣
    '陈粒': ['民谣'],
    '房东的猫': ['民谣'],
    // 周杰伦
    '周杰伦': ['8090', '经典', 'KTV', '一人一首成名曲', '周杰伦'],
    '温岚': ['8090', '经典', '周杰伦'],
    // 伤感风格
    '阿桑': ['伤感', '经典'],
    '一支榴莲': ['伤感'],
    '蓝心羽': ['伤感'],
    '苏星婕': ['伤感'],
    // 8090 年代
    '许茹芸': ['8090', '经典', '伤感'],
    '辛晓琪': ['8090', '经典', '伤感'],
    '金海心': ['8090', '经典'],
    '范玮琪': ['8090', '经典'],
    '梁咏琪': ['8090', '经典', 'KTV'],
    // 经典（8090年代华语经典）
    '孙燕姿': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '梁静茹': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '张韶涵': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '张惠妹': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '刘若英': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '萧亚轩': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '蔡健雅': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '戴佩妮': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '张靓颖': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '田馥甄': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '丁当': ['8090', '经典', 'KTV'],
    '张芸京': ['8090', '经典'],
    '戚薇': ['8090', '经典', 'KTV'],
    'A-Lin': ['8090', '经典', 'KTV'],
    '金莎': ['8090', '经典'],
    '江美琪': ['8090', '经典'],
    '张碧晨': ['8090', '经典', 'KTV'],
    '袁娅维TIA RAY': ['热门', 'KTV'],

    // ========== BV1az4ceJEhk 新增歌手（8090经典华语合集）==========
    // 天王级
    '王力宏': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '周传雄': ['8090', '经典', 'KTV'],
    '五月天': ['8090', '经典', 'KTV', '一人一首成名曲'],
    'F.I.R.飞儿乐团': ['8090', '经典', 'KTV', '一人一首成名曲'],
    'S.H.E': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '蔡依林': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '陶喆': ['8090', '经典', 'KTV'],
    '王心凌': ['8090', '经典', 'KTV'],
    '光良': ['8090', '经典', 'KTV', '一人一首成名曲'],
    '林忆莲': ['8090', '经典', 'KTV'],
    '容祖儿': ['8090', '经典', 'KTV'],
    '杨丞琳': ['8090', '经典', 'KTV'],
    'Twins': ['8090', '经典', 'KTV'],

    // 8090 经典男歌手
    '马天宇': ['8090', '经典'],
    '海鸣威': ['8090', '经典'],
    '李圣杰': ['8090', '经典', 'KTV'],
    'F4': ['8090', '经典', 'KTV'],
    '苏打绿': ['8090', '经典'],
    '沙宝亮': ['8090', '经典'],
    '陈小春': ['8090', '经典', 'KTV'],
    '庾澄庆': ['8090', '经典', 'KTV'],
    '伍佰': ['8090', '经典', 'KTV'],
    '吴克群': ['8090', '经典'],
    '林志炫': ['8090', '经典', 'KTV'],
    '阿杜': ['8090', '经典', '伤感'],
    '潘玮柏': ['8090', '经典', 'KTV'],
    '许嵩': ['8090', '经典'],
    '黄小琥': ['8090', '经典', 'KTV'],
    'Tank': ['8090', '经典'],
    '林宥嘉': ['8090', '经典', 'KTV'],
    '信乐团': ['8090', '经典', '摇滚'],
    '谢霆锋': ['8090', '经典', 'KTV'],
    '水木年华': ['8090', '经典'],
    '张宇': ['8090', '经典', 'KTV'],
    '萧敬腾': ['8090', '经典', 'KTV'],
    '李翊君': ['8090', '经典'],

    // 8090 经典女歌手
    '梁咏琪': ['8090', '经典', 'KTV'],
    '郭静': ['8090', '经典'],
    '彭佳慧': ['8090', '经典', 'KTV'],
    '飞轮海': ['8090', '经典'],

    // 其他组合/合唱
    '孙楠': ['8090', '经典', 'KTV'],
    '韩红': ['8090', '经典', 'KTV'],
    '袁成杰': ['8090', '经典'],
    // 近年热门
    '郁可唯': ['热门', '一人一首成名曲'],
    '单依纯': ['热门', 'KTV'],
    '黄霄雲': ['热门', 'KTV'],
    '任然': ['热门'],
    '大籽': ['热门'],
    '阿肆': ['热门'],
    '阿YueYue': ['热门'],
    '徐佳莹': ['KTV', '一人一首成名曲'],
    '梦然': ['热门'],
    '回小仙': ['热门'],
    '王靖雯': ['热门', '伤感'],
    '卢润泽': ['2026热歌'],
    '潘成': ['2026热歌'],
    '丹正母子': ['2026热歌'],
    '窝窝': ['2026热歌'],
    '王睿卓': ['2026热歌'],
    'PAMajor': ['2026热歌'],
    '温奕心': ['热门'],
    '王搏': ['伤感'],
    '王艳薇': ['伤感'],
    '南方凯': ['热门'],
    '旺仔小乔': ['伤感'],
    '周林枫': ['伤感'],
    '尹昔眠': ['古风'],

    // ========== BV1iP 十年榜新增歌手 ==========
    '罗志祥': ['8090', '经典', 'KTV'],
    'Sweety': ['8090', '经典'],
    '许巍': ['8090', '经典', '摇滚'],
    '卢巧音': ['经典'],
    '蔡卓妍': ['8090', '经典'],
    '徐誉滕': ['8090', '伤感'],
    '誓言': ['8090', '伤感'],
    '王强': ['8090', '伤感'],
    '羽泉': ['8090', '经典'],
    '汪峰': ['8090', '经典', '摇滚'],
    '凤凰传奇': ['8090', '经典', 'KTV'],
    '费玉清': ['8090', '经典'],
    '华语群星': ['经典'],
    '刀郎': ['8090', '经典'],
    '乌兰托娅': ['8090', '经典'],
    '金沙': ['8090', '经典'],
    '飞儿乐队': ['8090', '经典', 'KTV', '一人一首成名曲'],
    'F.I.R': ['8090', '经典', 'KTV', '一人一首成名曲'],
    'she': ['8090', '经典', 'KTV', '一人一首成名曲'],
    'twins': ['8090', '经典', 'KTV'],
};

// 歌名关键词 → 额外标签
const TITLE_KEYWORDS = [
    { kw: '阿嬷', tags: ['伤感', '2026热歌'] },
    { kw: '离别', tags: ['伤感'] },
    { kw: '樱花', tags: ['动漫'] },
    { kw: '海底', tags: ['伤感'] },
    { kw: '乌兰巴托', tags: ['民谣'] },
    { kw: '白月光', tags: ['伤感'] },
    { kw: '说散就散', tags: ['伤感', 'KTV'] },
    { kw: '永不失联的爱', tags: ['KTV', '热门'] },
    { kw: '星辰大海', tags: ['热门', 'KTV'] },
    { kw: '一路生花', tags: ['热门'] },
    { kw: '月亮之上', tags: ['民谣'] },
    { kw: '月亮代表我的心', tags: ['民谣'] },
    { kw: '狗尾草', tags: ['民谣'] },
    { kw: '白鸽乌鸦', tags: ['伤感', '2026热歌'] },
    { kw: '红昭愿', tags: ['古风', '热门'] },
    { kw: '半壶纱', tags: ['古风', '纯音乐'] },
    { kw: '风筝误', tags: ['古风'] },
    { kw: '九张机', tags: ['古风'] },
    { kw: '年轮', tags: ['古风'] },
    { kw: '西楼别序', tags: ['古风'] },
    { kw: '目及皆是', tags: ['热门'] },
    { kw: '云烟成雨', tags: ['民谣'] },
    { kw: '身骑白马', tags: ['经典', 'KTV'] },
    { kw: '热爱105', tags: ['热门'] },
    { kw: '阿嬷', tags: ['伤感'] },
    { kw: '偏爱', tags: ['经典', 'KTV'] },
    { kw: '红色高跟鞋', tags: ['KTV'] },
    { kw: '后来', tags: ['经典', 'KTV', '伤感'] },
    { kw: '一直很安静', tags: ['经典', '伤感'] },
    { kw: '突然想起你', tags: ['经典'] },
    { kw: '类似爱情', tags: ['伤感'] },
    { kw: '遗失的美好', tags: ['经典'] },
    { kw: '如果这就是爱情', tags: ['经典', '伤感'] },
    { kw: '你就不要想起我', tags: ['伤感', 'KTV'] },
    { kw: '会呼吸的痛', tags: ['伤感', 'KTV'] },
    { kw: '小幸运', tags: ['热门', 'KTV', '一人一首成名曲'] },
    { kw: '开始懂了', tags: ['经典', '伤感'] },
    { kw: '去有风的地方', tags: ['热门'] },
    { kw: '这世界那么多人', tags: ['热门', '伤感'] },
    { kw: '嘉宾', tags: ['热门', 'KTV'] },
    { kw: '想你时风起', tags: ['热门', '伤感'] },
    { kw: '追光者', tags: ['热门', 'KTV'] },
    { kw: '云与海', tags: ['热门'] },
    { kw: '飞鸟和蝉', tags: ['热门', '伤感'] },
    { kw: '去年夏天', tags: ['热门'] },
    { kw: '空空如也', tags: ['热门', '伤感'] },
    { kw: '醒不来的梦', tags: ['热门', '伤感'] },
    { kw: '把回忆拼好给你', tags: ['伤感'] },
    { kw: '你的酒馆对我打了烊', tags: ['伤感'] },
    { kw: '善变', tags: ['伤感'] },
    { kw: '走在冷风中', tags: ['伤感'] },
    { kw: '悲伤剧情', tags: ['伤感'] },
    { kw: '寂寞烟火', tags: ['伤感'] },
    { kw: '给我一个理由忘记', tags: ['伤感', 'KTV'] },
    { kw: '阿拉斯加海湾', tags: ['伤感'] },
    { kw: '如果爱忘了', tags: ['伤感', 'KTV'] },
    { kw: '画心', tags: ['经典', '伤感'] },
    { kw: '记事本', tags: ['经典', '伤感'] },
    { kw: '我们的纪念', tags: ['经典', '伤感'] },
    { kw: '吻别', tags: ['经典', '伤感', 'KTV'] },
    { kw: '十年', tags: ['伤感', 'KTV'] },
    { kw: '浮夸', tags: ['KTV'] },
    { kw: '黄昏', tags: ['伤感'] },
    { kw: '痴心绝对', tags: ['伤感', 'KTV'] },
    { kw: '暗香', tags: ['伤感'] },
    { kw: '独家记忆', tags: ['伤感', 'KTV'] },
    { kw: '死了都要爱', tags: ['伤感', 'KTV', '摇滚'] },
    { kw: '突然好想你', tags: ['伤感', 'KTV'] },
    { kw: '童话', tags: ['伤感', 'KTV', '一人一首成名曲'] },
    { kw: '我怀念的', tags: ['伤感'] },
    { kw: '知足', tags: ['KTV'] },
    { kw: '千年之恋', tags: ['伤感'] },
    { kw: '我们的爱', tags: ['伤感', 'KTV'] },
    { kw: '菊花台', tags: ['伤感'] },
    { kw: '千里之外', tags: ['KTV'] },
    { kw: '发如雪', tags: ['KTV'] },
    { kw: '夜曲', tags: ['KTV'] },
    { kw: '七里香', tags: ['KTV', '一人一首成名曲'] },
    { kw: '晴天', tags: ['KTV', '一人一首成名曲'] },
    { kw: '青花瓷', tags: ['KTV', '一人一首成名曲'] },
    { kw: '江南', tags: ['KTV', '一人一首成名曲'] },
    { kw: '一千年以后', tags: ['KTV'] },
    { kw: '曹操', tags: ['KTV'] },
    { kw: '日不落', tags: ['KTV'] },
    { kw: '勇气', tags: ['KTV', '一人一首成名曲'] },
    { kw: '隐形的翅膀', tags: ['KTV', '一人一首成名曲'] },
    { kw: '欧若拉', tags: ['KTV'] },
    { kw: '倔强', tags: ['KTV'] },
    { kw: '温柔', tags: ['伤感'] },
    { kw: '大城小爱', tags: ['KTV', '一人一首成名曲'] },
    { kw: '好心分手', tags: ['伤感', 'KTV'] },
    { kw: '快乐崇拜', tags: ['KTV', '一人一首成名曲'] },
    { kw: '波斯猫', tags: ['KTV'] },
    { kw: '流星雨', tags: ['KTV'] },
    { kw: '为你写诗', tags: ['KTV'] },
    { kw: '情非得已', tags: ['KTV'] },
    { kw: '盛夏的果实', tags: ['伤感', 'KTV'] },
    { kw: '他一定很爱你', tags: ['伤感'] },
    { kw: '遇见', tags: ['伤感', 'KTV', '一人一首成名曲'] },
    { kw: '龙卷风', tags: ['KTV'] },
    { kw: '爱你', tags: ['KTV'] },  // 王心凌
    { kw: '第一次爱的人', tags: ['KTV'] },
    { kw: '至少还有你', tags: ['经典', 'KTV', '一人一首成名曲'] },
    { kw: '没那么简单', tags: ['伤感', 'KTV'] },
    { kw: '说谎', tags: ['伤感', 'KTV'] },  // 林宥嘉
    { kw: '下一站天后', tags: ['KTV'] },
    { kw: '一生有你', tags: ['伤感'] },
    { kw: '月亮惹的祸', tags: ['伤感', 'KTV'] },
    { kw: '突然的自我', tags: ['KTV'] },
    { kw: '王妃', tags: ['KTV', '摇滚'] },
    { kw: '背对背拥抱', tags: ['KTV'] },
    { kw: '爱的主打歌', tags: ['KTV'] },
    { kw: '就是我', tags: ['KTV'] },
    { kw: '第一次', tags: ['伤感', 'KTV'] },
    { kw: '星月神话', tags: ['伤感'] },
    { kw: '美丽的神话', tags: ['伤感', 'KTV'] },
    { kw: '灰色头像', tags: ['伤感'] },
    { kw: '三国恋', tags: ['KTV'] },
    { kw: '给我一首歌的时间', tags: ['KTV'] },
    { kw: '稻香', tags: ['KTV', '一人一首成名曲'] },
    { kw: '花海', tags: ['伤感'] },
    { kw: '小情歌', tags: ['KTV'] },
    { kw: '寂寞沙洲冷', tags: ['伤感', 'KTV'] },
    { kw: '该死的温柔', tags: ['伤感'] },
    { kw: '老人与海', tags: ['KTV'] },

    // ========== BV1iP 十年榜新增关键词 ==========
    { kw: '蓝莲花', tags: ['摇滚', '经典'] },
    { kw: '可惜不是你', tags: ['伤感', 'KTV'] },
    { kw: '东风破', tags: ['KTV'] },
    { kw: '双截棍', tags: ['KTV'] },
    { kw: '今天你要嫁给我', tags: ['KTV'] },
    { kw: '北京欢迎你', tags: ['经典'] },
    { kw: '爱情转移', tags: ['KTV'] },
    { kw: '中国话', tags: ['KTV'] },
    { kw: 'Super Star', tags: ['KTV'] },
    { kw: '樱花草', tags: ['经典'] },
    { kw: '天黑黑', tags: ['经典', '伤感'] },
    { kw: '布拉格广场', tags: ['KTV'] },
    { kw: '你不是真正的快乐', tags: ['伤感', 'KTV'] },
    { kw: '唯一', tags: ['KTV'] },
    { kw: '2002年的第一场雪', tags: ['经典'] },
    { kw: '等一分钟', tags: ['伤感'] },
    { kw: '求佛', tags: ['伤感'] },
    { kw: '秋天不回来', tags: ['伤感'] },
    { kw: '挥着翅膀的女孩', tags: ['经典', 'KTV', '一人一首成名曲'] },
    { kw: '天路', tags: ['经典'] },
    { kw: '小酒窝', tags: ['KTV'] },
    { kw: '奔跑', tags: ['KTV'] },
    { kw: '自由飞翔', tags: ['KTV'] },
    { kw: '听妈妈的话', tags: ['KTV'] },
    { kw: '绿光', tags: ['KTV'] },
    { kw: '套马杆', tags: ['KTV'] },
    { kw: '最炫民族风', tags: ['KTV'] },
    { kw: '宁夏', tags: ['经典'] },
    { kw: '心墙', tags: ['KTV'] },
    { kw: '说爱你', tags: ['KTV'] },
    { kw: '有何不可', tags: ['KTV'] },
    { kw: '亲爱的那不是爱情', tags: ['KTV'] },
    { kw: '就是爱你', tags: ['KTV'] },
    { kw: '月牙湾', tags: ['KTV'] },
    { kw: '爱转角', tags: ['KTV'] },
    { kw: '只对你有感觉', tags: ['KTV'] },
    { kw: '怒放的生命', tags: ['摇滚'] },
    { kw: '因为爱所以爱', tags: ['KTV'] },
];

async function main() {
    // 从 .env 加载密钥
    const envPath = path.join(__dirname, '..', '.env');
    let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const lines = envContent.split('\n');
        for (const line of lines) {
            const t = line.trim();
            if (t.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
                serviceKey = t.split('=').slice(1).join('=').trim();
                break;
            }
        }
    }

    const BASE = 'https://orphftlwdwuvoscizndx.supabase.co/rest/v1';
    const headers = {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
    };

    // 1. 拉取所有歌曲（分页）
    console.log('Fetching songs from Supabase...');
    let songs = [];
    let offset = 0;
    const PAGE_SIZE = 1000;
    while (true) {
        const songsResp = await fetch(`${BASE}/songs?select=id,title,singer&order=id&limit=${PAGE_SIZE}&offset=${offset}`, { headers });
        if (!songsResp.ok) {
            console.log(`  ✗ 查询失败: ${songsResp.status}`);
            break;
        }
        const page = await songsResp.json();
        if (!page || page.length === 0) break;
        songs = songs.concat(page);
        console.log(`  → 第 ${offset / PAGE_SIZE + 1} 页: ${page.length} 首 (累计 ${songs.length})`);
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }
    console.log(`Found ${songs.length} songs`);
    console.log(`开始匹配标签...`);

    // 2. 计算每首歌的标签
    let insertCount = 0;
    let skipCount = 0;

    for (const song of songs) {
        const singer = song.singer || '';
        const title = song.title || '';
        const tagSet = new Set();

        // 按歌手匹配（跳过空歌手，避免匹配到所有标签）
        if (singer) {
            for (const [singerName, tags] of Object.entries(SINGER_TAGS)) {
                if (singer.includes(singerName) || singerName.includes(singer)) {
                    tags.forEach(t => tagSet.add(t));
                }
            }
        }

        // 按歌名关键词匹配
        for (const { kw, tags } of TITLE_KEYWORDS) {
            if (title.includes(kw)) {
                tags.forEach(t => tagSet.add(t));
            }
        }

        // 默认：所有歌曲都算"热门"候选
        if (tagSet.size === 0) {
            tagSet.add('热门');
        }

        // 3. 插入 song_tags
        for (const tagName of tagSet) {
            const tagId = TAG_IDS[tagName];
            if (!tagId) {
                console.log(`  ⚠ Unknown tag: ${tagName}`);
                continue;
            }

            try {
                const resp = await fetch(`${BASE}/song_tags`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ song_id: song.id, tag_id: tagId }),
                });
                if (resp.ok) {
                    insertCount++;
                } else if (resp.status === 409) {
                    skipCount++; // duplicate
                } else {
                    const err = await resp.text();
                    console.log(`  ✗ ${song.title} -> ${tagName}: ${err.slice(0, 80)}`);
                }
            } catch (err) {
                console.log(`  ✗ ${song.title} -> ${tagName}: ${err.message}`);
            }
        }

        // 进度
        if (song.id % 100 === 0) {
            console.log(`  → 已处理到 #${song.id}, 已插入 ${insertCount}, 跳过 ${skipCount}`);
        }
    }

    console.log(`\nDone: ${insertCount} inserted, ${skipCount} duplicates skipped`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
