/**
 * fix_song_titles.js — 修复刚导入的歌曲标题和歌手信息
 * ==================================================
 * 用法: /d/softwa/nodejs/node scripts/fix_song_titles.js
 *
 * 针对三个视频的页面标题格式:
 *   BV1Dd4y1U7AE: "NN.歌名-歌手"（有数字前缀）
 *   BV1tv4y127ZC: "NN.歌名-歌手"（同上）
 *   BV1BDk2YCEHF: "歌名"（无歌手，需从已有数据库匹配）
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

// ========== 加载 .env ==========
(function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) return;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (key && value) process.env[key] = value;
    });
})();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_HEADERS = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
};
const BILI_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://www.bilibili.com/',
};

// ========== 要处理的三组视频的 bvid ==========
const TARGET_BVIDS = ['BV1Dd4y1U7AE', 'BV1tv4y127ZC', 'BV1BDk2YCEHF'];

// ========== 工具函数 ==========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers, timeout: 15000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, data: null }); }
            });
        }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
    });
}

/**
 * 解析页面标题，提取歌名和歌手
 * 支持格式:
 *   "NN.歌名-歌手"  → { title: "歌名", singer: "歌手" }
 *   "NN.歌名-歌手." → { title: "歌名", singer: "歌手" } (去尾部句号)
 *   "歌名"          → { title: "歌名", singer: null }
 *   "歌名-歌手"     → { title: "歌名", singer: "歌手" }
 */
function parseTitle(raw) {
    let part = raw.trim();

    // 去除数字前缀: "01.", "1.", "001." 等
    const numPrefixRe = /^\d{1,4}\.\s*/;
    part = part.replace(numPrefixRe, '');

    // 去除尾部无意义的标点
    part = part.replace(/[。．.，,、\s]+$/, '');

    // 尝试用 " - " 分割（带空格）
    let idx = part.indexOf(' - ');
    if (idx > 0) {
        return {
            title: part.slice(idx + 3).trim(),
            singer: part.slice(0, idx).trim(),
        };
    }

    // 尝试用 "-" 分割（不带空格，但要区分是否是歌手名的一部分）
    // 规则: 最后一个 "-" 作为分隔符
    idx = part.lastIndexOf('-');
    if (idx > 0) {
        const left = part.slice(0, idx).trim();
        const right = part.slice(idx + 1).trim();
        // 确保两段都不是纯数字或太短
        if (right.length >= 1 && left.length >= 1
            && !/^\d+$/.test(right) && !/^\d+$/.test(left)) {
            return { title: left, singer: right };
        }
    }

    // 尝试用 "—" 或 "–" 分割
    for (const sep of ['—', '–', '：', ':']) {
        idx = part.lastIndexOf(sep);
        if (idx > 0) {
            return {
                title: part.slice(0, idx).trim(),
                singer: part.slice(idx + sep.length).trim(),
            };
        }
    }

    // 无分隔符：整个是歌名
    return { title: part, singer: null };
}

// 已知歌曲的 title→singer 映射（从 BV1BDk2YCEHF 150首经典歌曲手动补充）
// 这些是华语乐坛极经典的歌曲，歌手广为人知
const KNOWN_SINGERS = {
    '偏爱': '张芸京',
    '夜曲': '周杰伦',
    '奢香夫人': '凤凰传奇',
    '江南': '林俊杰',
    '第一次爱的人': '王心凌',
    '黄昏': '周传雄',
    '倒带': '蔡依林',
    '天涯': '任贤齐',
    '我们的爱': 'F.I.R.飞儿乐团',
    '有何不可': '许嵩',
    '十年': '陈奕迅',
    '宁夏': '梁静茹',
    'Letting Go': '蔡健雅',
    '最后一页': '江语晨',
    '如愿': '王菲',
    '至少还有你': '林忆莲',
    '不分手的恋爱': '汪苏泷',
    '多远都要在一起': '邓紫棋',
    '遇见': '孙燕姿',
    '七里香': '周杰伦',
    '若月亮没来': '王宇宙Leto/乔浚丞',
    '青花': '周传雄',
    '泡沫': '邓紫棋',
    '身骑白马': '徐佳莹',
    '一千年以后': '林俊杰',
    '说好的幸福呢': '周杰伦',
    '我怀念的': '孙燕姿',
    '飞鸟和蝉': '任然',
    '错位时空': '艾辰',
    '白月光与朱砂痣': '大籽',
    '辞九门回忆': '解忧草、冰幽',
    '告白气球': '周杰伦',
    '夏天的风': '火羊瞌睡了',
    '虞兮叹': '闻人听书',
    '半生雪': '是七叔呢',
    '孤勇者': '陈奕迅',
    '爱你': '王心凌',
    '成都': '赵雷',
    '春天里': '汪峰',
    '春庭雪': '等什么君',
    '大海': '张雨生',
    '关山酒': '小魂',
    '光年之外': '邓紫棋',
    '后来': '刘若英',
    '画': '邓紫棋',
    '红色高跟鞋': '蔡健雅',
    '奇妙能力歌': '陈粒',
    '起风了': '买辣椒也用券',
    '少年': '梦然',
    '体面': '于文文',
    '我的歌声里': '曲婉婷',
    '我曾': '隔壁老樊',
    '小幸运': '田馥甄',
    '演员': '薛之谦',
    '追光者': '岑宁儿',
    '最美的期待': '周笔畅',
    '晴天': '周杰伦',
    '稻香': '周杰伦',
    '青花瓷': '周杰伦',
    '东风破': '周杰伦',
    '发如雪': '周杰伦',
    '千里之外': '周杰伦/费玉清',
    '菊花台': '周杰伦',
    '听妈妈的话': '周杰伦',
    '给我一首歌的时间': '周杰伦',
    '花海': '周杰伦',
    '说爱你': '蔡依林',
    '日不落': '蔡依林',
    '布拉格广场': '蔡依林',
    '绿光': '孙燕姿',
    '开始懂了': '孙燕姿',
    '天黑黑': '孙燕姿',
    '我怀念的': '孙燕姿',
    '遇见': '孙燕姿',
    '勇气': '梁静茹',
    '暖暖': '梁静茹',
    '宁夏': '梁静茹',
    '会呼吸的痛': '梁静茹',
    '可惜不是你': '梁静茹',
    '隐形的翅膀': '张韶涵',
    '欧若拉': '张韶涵',
    '亲爱的那不是爱情': '张韶涵',
    '如果这就是爱情': '张靓颖',
    '画心': '张靓颖',
    '如果爱下去': '张靓颖',
    '天下': '张杰',
    '明天过后': '张杰',
    '这就是爱': '张杰',
    '剑心': '张杰',
    '突然好想你': '五月天',
    '倔强': '五月天',
    '知足': '五月天',
    '温柔': '五月天',
    '你不是真正的快乐': '五月天',
    '后来': '刘若英',
    '很爱很爱你': '刘若英',
    '为爱痴狂': '刘若英',
    '小情歌': '苏打绿',
    '无与伦比的美丽': '苏打绿',
    'K歌之王': '陈奕迅',
    '浮夸': '陈奕迅',
    '爱情转移': '陈奕迅',
    '好久不见': '陈奕迅',
    '不要说话': '陈奕迅',
    '红玫瑰': '陈奕迅',
    '她说': '林俊杰',
    '曹操': '林俊杰',
    '背对背拥抱': '林俊杰',
    '修炼爱情': '林俊杰',
    '不为谁而作的歌': '林俊杰',
    '当你': '林俊杰',
    '大城小爱': '王力宏',
    '唯一': '王力宏',
    '改变自己': '王力宏',
    '需要人陪': '王力宏',
    '童话': '光良',
    '第一次': '光良',
    '约定': '光良',
    '黄昏': '周传雄',
    '寂寞沙洲冷': '周传雄',
    '男人海洋': '周传雄',
    '记事本': '周传雄',
    '蓝莲花': '许巍',
    '曾经的你': '许巍',
    '故乡': '许巍',
    '大海': '张雨生',
    '我的未来不是梦': '张雨生',
    '死了都要爱': '信乐团',
    '离歌': '信乐团',
    '海阔天空': '信乐团',
    '飞得更高': '汪峰',
    '怒放的生命': '汪峰',
    '春天里': '汪峰',
    '北京北京': '汪峰',
    '存在': '汪峰',
    '最熟悉的陌生人': '萧亚轩',
    '突然想起你': '萧亚轩',
    '爱的主打歌': '萧亚轩',
    '类似爱情': '萧亚轩',
    '盛夏的果实': '莫文蔚',
    '阴天': '莫文蔚',
    '忽然之间': '莫文蔚',
    '他不爱我': '莫文蔚',
    '如果没有你': '莫文蔚',
    '电台情歌': '莫文蔚',
    '当你老了': '莫文蔚',
    '至少还有你': '林忆莲',
    '伤痕': '林忆莲',
    '爱上一个不回家的人': '林忆莲',
    '听说爱情回来过': '林忆莲',
    '为你我受冷风吹': '林忆莲',
    '勇气': '梁静茹',
    '分手快乐': '梁静茹',
    '崇拜': '梁静茹',
    '丝路': '梁静茹',
    '爱你不是两三天': '梁静茹',
    '月亮惹的祸': '张宇',
    '用心良苦': '张宇',
    '雨一直下': '张宇',
    '一言难尽': '张宇',
    '心太软': '任贤齐',
    '伤心太平洋': '任贤齐',
    '对面的女孩看过来': '任贤齐',
    '浪花一朵朵': '任贤齐',
    '痴心绝对': '李圣杰',
    '手放开': '李圣杰',
    '有一种爱叫做放手': '阿木',
    '别说我的眼泪你无所谓': '东来东往',
    '求佛': '誓言',
    '秋天不回来': '王强',
    '等一分钟': '徐誉滕',
    '老人与海': '海鸣威',
    '该死的温柔': '马天宇',
    '两只蝴蝶': '庞龙',
    '老鼠爱大米': '杨臣刚',
    '暗香': '沙宝亮',
    '香水有毒': '胡杨林',
    '白狐': '陈瑞',
    '天使的翅膀': '安琥',
    '一万个理由': '郑源',
    '不要在我寂寞的时候说爱我': '郑源',
    '犯错': '斯琴高丽',
    '丁香花': '唐磊',
    '你到底爱谁': '刘嘉亮',
    '童话镇': '陈一发儿',
    '空空如也': '任然',
    '我们不一样': '大壮',
    '沙漠骆驼': '展展与罗罗',
    '38度6': '黑龙',
    '纸短情长': '烟把儿',
    '往后余生': '马良',
    '学猫叫': '小潘潘/小峰峰',
    '最美的期待': '周笔畅',
    '可能否': '木小雅',
    '平凡之路': '朴树',
    '那些年': '胡夏',
    '小幸运': '田馥甄',
    '有点甜': '汪苏泷/By2',
    '因为爱情': '陈奕迅/王菲',
    '美丽的神话': '孙楠/韩红',
    '珊瑚海': '周杰伦/梁心颐',
    '今天你要嫁给我': '陶喆/蔡依林',
    '小酒窝': '林俊杰/蔡卓妍',
    '被风吹过的夏天': '林俊杰/金莎',
    '只对你有感觉': '飞轮海/田馥甄',
    '你是我心内的一首歌': '王力宏/Selina',
    '答案': '杨坤/郭采洁',
    '凉凉': '杨宗纬/张碧晨',
    '风吹麦浪': '李健/孙俪',
    '大王叫我来巡山': '贾乃亮/甜馨',
    '生生世世爱': '吴雨霏',
    '一直很安静': '阿桑',
    '叶子': '阿桑',
    '寂寞在唱歌': '阿桑',
    '受了点伤': '阿桑',
    '星月神话': '金莎',
    '画沙': '周杰伦/袁咏琳',
    '给我一个理由忘记': 'A-Lin',
    '寂寞不痛': 'A-Lin',
    '失恋无罪': 'A-Lin',
    '樱花草': 'Sweety',
    '挥着翅膀的女孩': '容祖儿',
    '下一站天后': 'Twins',
    '死性不改': 'Twins/Boy\'z',
    '下一站幸福': '品冠',
    '我以为': '品冠',
    '过火': '张信哲',
    '爱如潮水': '张信哲',
    '信仰': '张信哲',
    '从开始到现在': '张信哲',
    '别怕我伤心': '张信哲',
    '太想爱你': '张信哲',
    '漂洋过海来看你': '娃娃',
    '囚鸟': '彭羚',
    '大约在冬季': '齐秦',
    '外面的世界': '齐秦',
    '夜夜夜夜': '齐秦',
    '不让我的眼泪陪我过夜': '齐秦',
    '黄昏': '周传雄',
    '记事本': '陈慧琳',
    '眉飞色舞': '郑秀文',
    '值得': '郑秀文',
    '短发': '梁咏琪',
    '胆小鬼': '梁咏琪',
    '灰姑娘': '郑钧',
    '赤裸裸': '郑钧',
    '一生有你': '水木年华',
    '在他乡': '水木年华',
    '完美世界': '水木年华',
    '奔跑': '羽泉',
    '冷酷到底': '羽泉',
    '最美': '羽泉',
    '深呼吸': '羽泉',
    '月亮代表我的心': '邓丽君',
    '甜蜜蜜': '邓丽君',
    '我只在乎你': '邓丽君',
    '小城故事': '邓丽君',
    '但愿人长久': '邓丽君',
    '朋友': '周华健',
    '花心': '周华健',
    '让我欢喜让我忧': '周华健',
    '忘忧草': '周华健',
    '难念的经': '周华健',
    '就是爱你': '陶喆',
    '爱很简单': '陶喆',
    'Melody': '陶喆',
    '小镇姑娘': '陶喆',
    '曹操': '林俊杰',
    '一眼万年': 'S.H.E',
    'Super Star': 'S.H.E',
    '中国话': 'S.H.E',
    '不想长大': 'S.H.E',
    '波斯猫': 'S.H.E',
    '流星雨': 'F4',
    '第一时间': 'F4',
    '燕尾蝶': '梁静茹',
    'Lydia': 'F.I.R.飞儿乐团',
    '千年之恋': 'F.I.R.飞儿乐团',
    '月牙湾': 'F.I.R.飞儿乐团',
    '你的微笑': 'F.I.R.飞儿乐团',
    '三国恋': 'Tank',
    '专属天使': 'Tank',
    '如果我变成回忆': 'Tank',
    '爱转角': '罗志祥',
    '灰色空间': '罗志祥',
    '狐狸精': '罗志祥',
    '想你的夜': '关喆',
    '洋葱': '杨宗纬',
    '空白格': '蔡健雅',
    '达尔文': '蔡健雅',
    '红色高跟鞋': '蔡健雅',
    '别找我麻烦': '蔡健雅',
    '思念是一种病': '张震岳',
    '爱我别走': '张震岳',
    '再见': '张震岳',
    '路口': '张震岳',
    '王妃': '萧敬腾',
    '新不了情': '萧敬腾',
    '怎么说我不爱你': '萧敬腾',
    '如果云知道': '许茹芸',
    '独角戏': '许茹芸',
    '泪海': '许茹芸',
    '味道': '辛晓琪',
    '领悟': '辛晓琪',
    '承认': '辛晓琪',
    '梦醒时分': '陈淑桦',
    '笑红尘': '陈淑桦',
    '滚滚红尘': '陈淑桦',
    '凡人歌': '李宗盛',
    '山丘': '李宗盛',
    '鬼迷心窍': '李宗盛',
    '爱的代价': '张艾嘉',
    '新鸳鸯蝴蝶梦': '黄安',
    '包青天': '胡瓜',
    '铁血丹心': '罗文/甄妮',
    '世间始终你好': '罗文/甄妮',
    '沧海一声笑': '许冠杰',
    '男儿当自强': '林子祥',
    '皇后大道东': '罗大佑/蒋志光',
    '你的样子': '罗大佑',
    '童年': '罗大佑',
    '光阴的故事': '罗大佑',
    '鹿港小镇': '罗大佑',
    '野百合也有春天': '潘越云',
    '我是不是你最疼爱的人': '潘越云',
    '天天想你': '张雨生',
    '大海': '张雨生',
    '一天到晚游泳的鱼': '张雨生',
    '我的未来不是梦': '张雨生',
    '酒干倘卖无': '苏芮',
    '跟着感觉走': '苏芮',
    '是否': '苏芮',
    '一样的月光': '苏芮',
    '女人花': '梅艳芳',
    '亲密爱人': '梅艳芳',
    '似水流年': '梅艳芳',
    '夕阳之歌': '梅艳芳',
    '千千阙歌': '陈慧娴',
    '飘雪': '陈慧娴',
    '傻女': '陈慧娴',
    '红茶馆': '陈慧娴',
    '容易受伤的女人': '王菲',
    '执迷不悔': '王菲',
    '我愿意': '王菲',
    '红豆': '王菲',
    '传奇': '王菲',
    '因为爱情': '陈奕迅/王菲',
    '匆匆那年': '王菲',
    '致青春': '王菲',
    '白月光': '张信哲',
    '遇见': '孙燕姿',
    '星晴': '周杰伦',
    '简单爱': '周杰伦',
    '龙卷风': '周杰伦',
    '可爱女人': '周杰伦',
    '爱在西元前': '周杰伦',
    '半岛铁盒': '周杰伦',
    '以父之名': '周杰伦',
    '轨迹': '周杰伦',
    '搁浅': '周杰伦',
    '借口': '周杰伦',
    '珊瑚海': '周杰伦/Lara',
    '一路向北': '周杰伦',
    '断了的弦': '周杰伦',
    '枫': '周杰伦',
    '彩虹': '周杰伦',
    '最长的电影': '周杰伦',
    '不能说的秘密': '周杰伦',
};

// ========== 主流程 ==========

async function main() {
    console.log('🔧 修复歌曲标题和歌手信息\n');
    console.log('='.repeat(60));

    // 1. 获取数据库中这三组 bvid 的歌曲
    console.log('\n📊 查询数据库中待修复的歌曲...');
    const songsResp = await fetch(
        `${SUPABASE_URL}/rest/v1/songs?select=id,bvid,page,title,singer&bvid=in.(BV1Dd4y1U7AE,BV1tv4y127ZC,BV1BDk2YCEHF)&order=id.asc&limit=350`,
        { headers: SUPABASE_HEADERS }
    );
    const dbSongs = await songsResp.json();
    console.log(`  找到 ${dbSongs.length} 首待修复歌曲`);

    // 构建快速查找: bvid → page → db_song
    const dbMap = {};
    for (const s of dbSongs) {
        if (!dbMap[s.bvid]) dbMap[s.bvid] = {};
        dbMap[s.bvid][s.page] = s;
    }

    // 2. 获取已有歌曲的 title→singer 映射（用于 BV1BDk2YCEHF 的匹配）
    console.log('\n📊 查询所有已有歌曲（用于歌手匹配）...');
    const allResp = await fetch(
        `${SUPABASE_URL}/rest/v1/songs?select=title,singer&order=id.asc&limit=1000`,
        { headers: SUPABASE_HEADERS }
    );
    const allSongs = await allResp.json();
    // 构建 title→singer 映射（取第一个非空的singer）
    const titleToSinger = {};
    for (const s of allSongs) {
        if (s.singer && !titleToSinger[s.title]) {
            titleToSinger[s.title] = s.singer;
        }
    }
    // 合并手动映射
    for (const [title, singer] of Object.entries(KNOWN_SINGERS)) {
        if (!titleToSinger[title]) {
            titleToSinger[title] = singer;
        }
    }
    console.log(`  共 ${Object.keys(titleToSinger).length} 个歌手映射可用来匹配`);

    // 3. 逐个 B站视频获取页面标题并修复
    let fixCount = 0;
    let skipCount = 0;

    for (const bvid of TARGET_BVIDS) {
        console.log(`\n📺 获取 ${bvid} 页面列表...`);

        let pages;
        try {
            const result = await httpGet(
                `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
                BILI_HEADERS
            );
            if (!result.data || result.data.code !== 0) {
                console.log(`  ✗ API 错误: ${JSON.stringify(result.data)}`);
                continue;
            }
            pages = result.data.data.pages;
            console.log(`  共 ${pages.length} 页`);
        } catch (err) {
            console.log(`  ✗ 请求失败: ${err.message}`);
            continue;
        }

        for (const page of pages) {
            const dbSong = dbMap[bvid]?.[page.page];
            if (!dbSong) {
                continue; // 可能不是我们导入的
            }

            const { title: newTitle, singer: parsedSinger } = parseTitle(page.part);

            // 确定最终的歌手
            let finalSinger = parsedSinger;
            if (!finalSinger) {
                // 尝试从已知映射中获取歌手
                finalSinger = titleToSinger[newTitle] || titleToSinger[page.part.trim()] || null;
            }

            // 检查是否需要更新
            const needUpdate = (
                dbSong.title !== newTitle ||
                (dbSong.singer || '') !== (finalSinger || '')
            );

            if (!needUpdate) {
                skipCount++;
                continue;
            }

            // PATCH 更新
            try {
                const patchBody = { title: newTitle };
                if (finalSinger) patchBody.singer = finalSinger;

                const resp = await fetch(
                    `${SUPABASE_URL}/rest/v1/songs?id=eq.${dbSong.id}`,
                    {
                        method: 'PATCH',
                        headers: {
                            ...SUPABASE_HEADERS,
                            'Prefer': 'return=minimal',
                        },
                        body: JSON.stringify(patchBody),
                    }
                );

                if (resp.ok) {
                    fixCount++;
                } else {
                    const errText = await resp.text();
                    console.log(`  ✗ #${dbSong.id} ${page.part}: ${errText.slice(0, 80)}`);
                }
            } catch (err) {
                console.log(`  ✗ #${dbSong.id} ${page.part}: ${err.message}`);
            }
        }

        // 限速
        await sleep(300);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ 修复完成!');
    console.log(`  已修复: ${fixCount} 首`);
    console.log(`  无需修复: ${skipCount} 首`);

    // 4. 验证: 显示一些修复后的结果
    console.log('\n📝 修复后示例（从 BV1Dd4y1U7AE 前5首）:');
    const verifyResp = await fetch(
        `${SUPABASE_URL}/rest/v1/songs?select=id,title,singer&bvid=eq.BV1Dd4y1U7AE&order=page.asc&limit=5`,
        { headers: SUPABASE_HEADERS }
    );
    const verify = await verifyResp.json();
    for (const s of verify) {
        console.log(`  #${s.id} ${s.singer || '(无歌手)'} — ${s.title}`);
    }

    // 5. 统计 BV1BDk2YCEHF 中有多少首歌没找到歌手
    const noSingerResp = await fetch(
        `${SUPABASE_URL}/rest/v1/songs?select=id&singer=is.null&bvid=eq.BV1BDk2YCEHF`,
        { headers: { ...SUPABASE_HEADERS, 'Prefer': 'count=exact' } }
    );
    console.log(`\n⚠ BV1BDk2YCEHF 中仍缺少歌手的歌曲: ${noSingerResp.headers.get('content-range')?.split('/')[1] || '未知'} 首`);
}

main().catch(err => {
    console.error('脚本执行失败:', err);
    process.exit(1);
});
