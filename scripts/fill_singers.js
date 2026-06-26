/**
 * fill_singers.js — 为空歌手歌曲匹配原唱
 * ======================================
 * 用法: /d/softwa/nodejs/node scripts/fill_singers.js [--dry-run]
 *
 * 匹配策略:
 *   1. 从标题提取 【歌手名】歌名 格式
 *   2. 从已有歌曲中匹配: 同歌名 → 取最常见歌手
 *   3. 从 B站 API 获取页面标题，解析歌手信息
 */

const path = require('path');
const fs = require('fs');
const https = require('https');

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
const DRY_RUN = process.argv.includes('--dry-run');

const HEADERS = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ========== 已知歌手映射（来自 fix_song_titles.js） ==========
const KNOWN_SINGERS = {
    '偏爱': '张芸京','夜曲': '周杰伦','奢香夫人': '凤凰传奇','江南': '林俊杰',
    '第一次爱的人': '王心凌','黄昏': '周传雄','倒带': '蔡依林','天涯': '任贤齐',
    '我们的爱': 'F.I.R.飞儿乐团','有何不可': '许嵩','十年': '陈奕迅','宁夏': '梁静茹',
    'Letting Go': '蔡健雅','最后一页': '江语晨','如愿': '王菲','至少还有你': '林忆莲',
    '不分手的恋爱': '汪苏泷','多远都要在一起': '邓紫棋','遇见': '孙燕姿','七里香': '周杰伦',
    '若月亮没来': '王宇宙Leto/乔浚丞','青花': '周传雄','泡沫': '邓紫棋','身骑白马': '徐佳莹',
    '一千年以后': '林俊杰','说好的幸福呢': '周杰伦','我怀念的': '孙燕姿','飞鸟和蝉': '任然',
    '错位时空': '艾辰','白月光与朱砂痣': '大籽','辞九门回忆': '解忧草、冰幽','告白气球': '周杰伦',
    '夏天的风': '火羊瞌睡了','虞兮叹': '闻人听书','半生雪': '是七叔呢','孤勇者': '陈奕迅',
    '爱你': '王心凌','成都': '赵雷','春天里': '汪峰','春庭雪': '等什么君','大海': '张雨生',
    '关山酒': '小魂','光年之外': '邓紫棋','后来': '刘若英','画': '邓紫棋','红色高跟鞋': '蔡健雅',
    '奇妙能力歌': '陈粒','起风了': '买辣椒也用券','少年': '梦然','体面': '于文文',
    '我的歌声里': '曲婉婷','我曾': '隔壁老樊','小幸运': '田馥甄','演员': '薛之谦','追光者': '岑宁儿',
    '最美的期待': '周笔畅','晴天': '周杰伦','稻香': '周杰伦','青花瓷': '周杰伦','东风破': '周杰伦',
    '发如雪': '周杰伦','千里之外': '周杰伦/费玉清','菊花台': '周杰伦','听妈妈的话': '周杰伦',
    '给我一首歌的时间': '周杰伦','花海': '周杰伦','说爱你': '蔡依林','日不落': '蔡依林',
    '布拉格广场': '蔡依林','绿光': '孙燕姿','开始懂了': '孙燕姿','天黑黑': '孙燕姿',
    '勇气': '梁静茹','暖暖': '梁静茹','会呼吸的痛': '梁静茹','可惜不是你': '梁静茹',
    '隐形的翅膀': '张韶涵','欧若拉': '张韶涵','亲爱的那不是爱情': '张韶涵',
    '如果这就是爱情': '张靓颖','画心': '张靓颖','如果爱下去': '张靓颖','天下': '张杰',
    '明天过后': '张杰','这就是爱': '张杰','剑心': '张杰','突然好想你': '五月天','倔强': '五月天',
    '知足': '五月天','温柔': '五月天','你不是真正的快乐': '五月天','很爱很爱你': '刘若英',
    '为爱痴狂': '刘若英','小情歌': '苏打绿','无与伦比的美丽': '苏打绿','K歌之王': '陈奕迅',
    '浮夸': '陈奕迅','爱情转移': '陈奕迅','好久不见': '陈奕迅','不要说话': '陈奕迅','红玫瑰': '陈奕迅',
    '她说': '林俊杰','曹操': '林俊杰','背对背拥抱': '林俊杰','修炼爱情': '林俊杰',
    '不为谁而作的歌': '林俊杰','当你': '林俊杰','大城小爱': '王力宏','唯一': '王力宏',
    '改变自己': '王力宏','需要人陪': '王力宏','童话': '光良','第一次': '光良','约定': '光良',
    '寂寞沙洲冷': '周传雄','男人海洋': '周传雄','记事本': '陈慧琳','蓝莲花': '许巍',
    '曾经的你': '许巍','故乡': '许巍','我的未来不是梦': '张雨生','死了都要爱': '信乐团',
    '离歌': '信乐团','海阔天空': '信乐团','飞得更高': '汪峰','怒放的生命': '汪峰',
    '北京北京': '汪峰','存在': '汪峰','最熟悉的陌生人': '萧亚轩','突然想起你': '萧亚轩',
    '爱的主打歌': '萧亚轩','类似爱情': '萧亚轩','盛夏的果实': '莫文蔚','阴天': '莫文蔚',
    '忽然之间': '莫文蔚','他不爱我': '莫文蔚','如果没有你': '莫文蔚','电台情歌': '莫文蔚',
    '当你老了': '莫文蔚','伤痕': '林忆莲','爱上一个不回家的人': '林忆莲','听说爱情回来过': '林忆莲',
    '为你我受冷风吹': '林忆莲','分手快乐': '梁静茹','崇拜': '梁静茹','丝路': '梁静茹',
    '爱你不是两三天': '梁静茹','月亮惹的祸': '张宇','用心良苦': '张宇','雨一直下': '张宇',
    '一言难尽': '张宇','心太软': '任贤齐','伤心太平洋': '任贤齐','对面的女孩看过来': '任贤齐',
    '浪花一朵朵': '任贤齐','痴心绝对': '李圣杰','手放开': '李圣杰','有一种爱叫做放手': '阿木',
    '别说我的眼泪你无所谓': '东来东往','求佛': '誓言','秋天不回来': '王强','等一分钟': '徐誉滕',
    '老人与海': '海鸣威','该死的温柔': '马天宇','两只蝴蝶': '庞龙','老鼠爱大米': '杨臣刚',
    '暗香': '沙宝亮','香水有毒': '胡杨林','白狐': '陈瑞','天使的翅膀': '安琥','一万个理由': '郑源',
    '不要在我寂寞的时候说爱我': '郑源','犯错': '斯琴高丽','丁香花': '唐磊','你到底爱谁': '刘嘉亮',
    '童话镇': '陈一发儿','空空如也': '任然','我们不一样': '大壮','沙漠骆驼': '展展与罗罗',
    '38度6': '黑龙','纸短情长': '烟把儿','往后余生': '马良','学猫叫': '小潘潘/小峰峰',
    '可能否': '木小雅','平凡之路': '朴树','那些年': '胡夏','有点甜': '汪苏泷/By2',
    '因为爱情': '陈奕迅/王菲','美丽的神话': '孙楠/韩红','珊瑚海': '周杰伦/梁心颐',
    '今天你要嫁给我': '陶喆/蔡依林','小酒窝': '林俊杰/蔡卓妍','被风吹过的夏天': '林俊杰/金莎',
    '只对你有感觉': '飞轮海/田馥甄','你是我心内的一首歌': '王力宏/Selina','答案': '杨坤/郭采洁',
    '凉凉': '杨宗纬/张碧晨','风吹麦浪': '李健/孙俪','大王叫我来巡山': '贾乃亮/甜馨',
    '生生世世爱': '吴雨霏','一直很安静': '阿桑','叶子': '阿桑','寂寞在唱歌': '阿桑',
    '受了点伤': '阿桑','星月神话': '金莎','画沙': '周杰伦/袁咏琳','给我一个理由忘记': 'A-Lin',
    '寂寞不痛': 'A-Lin','失恋无罪': 'A-Lin','樱花草': 'Sweety','挥着翅膀的女孩': '容祖儿',
    '下一站天后': 'Twins','死性不改': "Twins/Boy'z",'下一站幸福': '品冠','我以为': '品冠',
    '过火': '张信哲','爱如潮水': '张信哲','信仰': '张信哲','从开始到现在': '张信哲',
    '别怕我伤心': '张信哲','太想爱你': '张信哲','漂洋过海来看你': '娃娃','囚鸟': '彭羚',
    '大约在冬季': '齐秦','外面的世界': '齐秦','夜夜夜夜': '齐秦','不让我的眼泪陪我过夜': '齐秦',
    '记事本': '陈慧琳','眉飞色舞': '郑秀文','值得': '郑秀文','短发': '梁咏琪','胆小鬼': '梁咏琪',
    '灰姑娘': '郑钧','赤裸裸': '郑钧','一生有你': '水木年华','在他乡': '水木年华',
    '完美世界': '水木年华','奔跑': '羽泉','冷酷到底': '羽泉','最美': '羽泉','深呼吸': '羽泉',
    '月亮代表我的心': '邓丽君','甜蜜蜜': '邓丽君','我只在乎你': '邓丽君','小城故事': '邓丽君',
    '但愿人长久': '邓丽君','朋友': '周华健','花心': '周华健','让我欢喜让我忧': '周华健',
    '忘忧草': '周华健','难念的经': '周华健','就是爱你': '陶喆','爱很简单': '陶喆','Melody': '陶喆',
    '小镇姑娘': '陶喆','一眼万年': 'S.H.E','Super Star': 'S.H.E','中国话': 'S.H.E',
    '不想长大': 'S.H.E','波斯猫': 'S.H.E','流星雨': 'F4','第一时间': 'F4','燕尾蝶': '梁静茹',
    'Lydia': 'F.I.R.飞儿乐团','千年之恋': 'F.I.R.飞儿乐团','月牙湾': 'F.I.R.飞儿乐团',
    '你的微笑': 'F.I.R.飞儿乐团','三国恋': 'Tank','专属天使': 'Tank','如果我变成回忆': 'Tank',
    '爱转角': '罗志祥','灰色空间': '罗志祥','狐狸精': '罗志祥','想你的夜': '关喆','洋葱': '杨宗纬',
    '空白格': '蔡健雅','达尔文': '蔡健雅','别找我麻烦': '蔡健雅','思念是一种病': '张震岳',
    '爱我别走': '张震岳','再见': '张震岳','路口': '张震岳','王妃': '萧敬腾','新不了情': '萧敬腾',
    '怎么说我不爱你': '萧敬腾','如果云知道': '许茹芸','独角戏': '许茹芸','泪海': '许茹芸',
    '味道': '辛晓琪','领悟': '辛晓琪','承认': '辛晓琪','梦醒时分': '陈淑桦','笑红尘': '陈淑桦',
    '滚滚红尘': '陈淑桦','凡人歌': '李宗盛','山丘': '李宗盛','鬼迷心窍': '李宗盛',
    '爱的代价': '张艾嘉','新鸳鸯蝴蝶梦': '黄安','铁血丹心': '罗文/甄妮','世间始终你好': '罗文/甄妮',
    '沧海一声笑': '许冠杰','男儿当自强': '林子祥','你的样子': '罗大佑','童年': '罗大佑',
    '光阴的故事': '罗大佑','鹿港小镇': '罗大佑','野百合也有春天': '潘越云',
    '我是不是你最疼爱的人': '潘越云','天天想你': '张雨生','一天到晚游泳的鱼': '张雨生',
    '酒干倘卖无': '苏芮','跟着感觉走': '苏芮','是否': '苏芮','一样的月光': '苏芮',
    '女人花': '梅艳芳','亲密爱人': '梅艳芳','似水流年': '梅艳芳','夕阳之歌': '梅艳芳',
    '千千阙歌': '陈慧娴','飘雪': '陈慧娴','傻女': '陈慧娴','红茶馆': '陈慧娴',
    '容易受伤的女人': '王菲','执迷不悔': '王菲','我愿意': '王菲','红豆': '王菲','传奇': '王菲',
    '匆匆那年': '王菲','致青春': '王菲','白月光': '张信哲','星晴': '周杰伦','简单爱': '周杰伦',
    '龙卷风': '周杰伦','可爱女人': '周杰伦','爱在西元前': '周杰伦','半岛铁盒': '周杰伦',
    '以父之名': '周杰伦','轨迹': '周杰伦','搁浅': '周杰伦','借口': '周杰伦','一路向北': '周杰伦',
    '断了的弦': '周杰伦','枫': '周杰伦','彩虹': '周杰伦','最长的电影': '周杰伦','不能说的秘密': '周杰伦',
    '珊瑚海': '周杰伦/Lara','千千阕歌': '陈慧娴','初爱': '杨宗纬','水星记': '郭顶',
    '旅行的意义': '陈绮贞','胡广生': '任素汐','缘分一道桥': '王力宏/谭维维','推开世界的门': '杨乃文',
    '一个人想着一个人': '曾沛慈','七月七日晴': '许慧欣','西海情歌': '刀郎','淘汰': '陈奕迅',
    '默': '那英','潇洒走一回': '叶倩文','人质': '张惠妹','刻在我心底的名字': '卢广仲',
    '末班车': '萧煌奇','下雨天': '南拳妈妈','醉赤壁': '林俊杰','我可以抱你吗': '张惠妹',
    '猜不透': '丁当','失落沙洲': '徐佳莹','有一种悲伤': 'A-Lin','此生不换': '青鸟飞鱼',
    '讲不出再见': '谭咏麟','月半小夜曲': '李克勤','笔记': '周笔畅','你要的爱': '戴佩妮',
    '不得不爱': '潘玮柏/弦子','有没有一首歌会让你想起我': '周华健','美人鱼': '林俊杰',
    '特别的人': '方大同','连名带姓': '张惠妹','听海': '张惠妹','南方姑娘': '赵雷',
    '来生缘': '刘德华','天天': '陶喆','当爱在靠近': '刘若英','我是真的爱上你': '王杰',
    '挪威的森林': '伍佰','贝加尔湖畔': '李健','有没有人告诉你': '陈楚生','再度重相逢': '伍佰',
    '认真的雪': '薛之谦','词不达意': '林忆莲','句号': '邓紫棋','小半': '陈粒',
    '日落大道': '梁博','我们的歌': '王力宏','如果你也听说': '张惠妹','大鱼': '周深',
    '爱，很简单': '陶喆','Last Dance': '伍佰','无名的人': '毛不易','不遗憾': '李荣浩',
    '人间': '王菲','若梦': '周深',
    // English classics
    'My Heart Will Go On': 'Céline Dion','Hotel California': 'Eagles',
    'Right Here Waiting': 'Richard Marx','Yesterday Once More': 'Carpenters',
    "Nothing's Gonna Change My Love For You": 'George Benson',
    'Take My Breath Away': 'Berlin','Big Big World': 'Emilia Rydberg',
    'Scarborough Fair': 'Sarah Brightman','More Than I Can Say': 'Leo Sayer',
    'Seasons In The Sun': 'Westlife','See You Again': 'Wiz Khalifa ft. Charlie Puth',
    'Casablanca': 'Bertie Higgins','Far Away From Home': 'Groove Coverage',
    'Five Hundred Miles': 'The Journeymen','Take Me Home, Country Roads': 'John Denver',
    'My Love': 'Westlife','Rhythm Of The Rain': 'The Cascades','Hey Jude': 'The Beatles',
    'Moonlight Shadow': 'Dana Winner','Beat It': 'Michael Jackson','Careless Whisper': 'Wham!',
    'Say You Say Me': 'Lionel Richie','Take Me To Your Heart': 'Michael Learns To Rock',
    'Because I Love You': 'Stevie B','Traveling Light': 'Joel Hanson',
    'We Are The World': 'Michael Jackson','That\'s Why You Go Away': 'Michael Learns To Rock',
    'Trouble Is A Friend': 'Lenka','Lemon Tree': "Fool's Garden",'Free Loop': 'Daniel Powter',
    'You Are Beautiful': 'James Blunt','Yellow': 'Coldplay','Burning': 'Maria Arredondo',
    'Sailing': 'Rod Stewart','Cry On My Shoulder': 'Deutschland sucht den Superstar',
    'The Sound of Silence': 'Simon & Garfunkel','Auld Lang Syne': 'Traditional',
    'Promise Don\'t Come Easy': 'Caron Nightingale','Laughter In The Rain': 'Neil Sedaka',
    'Love Story': 'Taylor Swift','You Are Not Alone': 'Michael Jackson',
    'You Raise Me Up': 'Secret Garden',
    // Piano/instrumental
    '卡农': 'Pachelbel','River Flows in You': 'Yiruma','A Little Story': 'Valentine',
    'Sundial Dreams': 'Kevin Kern','The Level Plain': 'Joanie Madden','Always': 'Yiruma',
    'Letter': 'Iris','The Twisting Of The Rope': 'Joanie Madden','You raise me up': 'Secret Garden',
    // More Chinese songs
    '笼': '张碧晨','落': '唐伯虎','牧马城市': '毛不易','苹果香': '狼戈',
    '凄美地': '郭顶','牵丝戏': '银临/阿杰','曲中人': '安儿陈','人间半途': '刘阳阳',
    '人间烟火': '程响','人生的道场': '魏佳艺','如果爱忘了': '戚薇','三生石下': '大欢',
    '石沉大海': '王理文','世界这么大还是遇见你': '程响','是你': '梦然',
    '手心里的温柔': '刀郎','水手': '郑智化','说书人': '暗杠/寅子','桃花诺': '邓紫棋',
    '逃爱': '霍尊','探故知': '浅影阿','太多': '陈冠蒲','踏山河': '是七叔呢',
    '听闻远方有你': '刘钧','我的歌声里': '曲婉婷','问': '陈淑桦','我会等': '承桓',
    '我会好好的': '王心凌','我记得': '赵雷','西楼儿女': '海来阿木',
    '像我这样的人': '毛不易','相思': '毛阿敏','一路生花': '温奕心',
    '小美满': '周深','我们的时光': '赵雷','一半疯了一半算了': '刘振宇',
    '若月亮没来': '王宇宙Leto/乔浚丞','如果当时': '许嵩','奢香夫人': '凤凰传奇',
    '少年': '梦然','阿嬷': '伦桑','壁上观': '张晓棠','卜卦': '崔子格',
    '不要慌太阳下山有月光': '陆虎','冲动的惩罚': '刀郎','迟来的爱': '李茂山',
    '春风何时来': '巴扎黑','春娇与志明': '街道办/欧阳耀莹','此情一直在心间': '花姐',
    '此去半生': 'L(桃籽)','反方向的钟': '阿冗','点歌的人': '海来阿木',
    '赐伤': '侯泽润','感谢你曾来过': 'Ayo97/周思涵','富士山下': '陈奕迅',
    '光辉岁月': 'Beyond','化风行万里': '大欢','剑魂': '汪苏泷','空心之城': '文夫',
    '兰亭序': '周杰伦','离别开出花': '就是南方凯','泪如雪': '海来阿木',
    '笼': '张碧晨','秒针': '阿梨粤','你答应我的事': '叶炫清','难却': '浮生',
    '哪里都是你': '队长','千千万万': '深海鱼子酱','诺言': '李翊君',
    '你总要学会往前走': '任夏','千千阕歌': '陈慧娴','你再平凡也是限量版': '任夏',
    '你的万水千山': '海来阿木','前尘应念': '等什么君','情歌': '梁静茹',
    '情罪': '戚薇','山茶花读不懂白玫瑰': 'Li 2c','她才是你的天赐良缘': '尹昔眠',
    '忘了你忘了我': '王杰','我好像在哪见过你': '薛之谦','我很快乐': '刘惜君',
    '忘情忘你忘最初': '彤大王','天际': '洋澜一','天亮以前说再见': '何野',
    '天也不懂情': '云朵','晚风心里吹': '阿梨粤','望故乡': '刘钧','我的楼兰': '云朵',
    '消散对白': '丁当','谢谢你': '刀郎','心之火': 'F.I.R.飞儿乐团/彭佳慧',
    '一路往南走': '卢润泽','游京': '海伦','有风无风皆自由': '周深',
    '远山少年': '就是南方凯','这些年在忙什么': '彤大王','枕着光的她': '任素汐',
    '只为你着迷': '李秉成','转身即心痛': '吉星出租','相遇的意义': '队长',
    '列车开往春天': '就是南方凯','暮色回响': '吉星出租','白鸽乌鸦相爱的戏码': '潘成(皮卡潘)',
    '疯子傻子呆子': '王铁锤','放纵L': '就是南方凯','暗里着迷': '刘德华',
    '安和桥': '宋冬野','别听悲伤的歌': '汪苏泷','秋风吹起': '单依纯','秋风经过': '张靓颖',
    '人间疾苦': '大欢','陪我过个冬': '李嘉嘉','谁': '小柯','天地龙鳞': '王力宏',
    '土坡上的狗尾草': '卢润泽','封心的雪': '侯泽润','爱错': '王力宏','爱我还是他': '陶喆',
    '熬过风雪又一年': '刘阳阳','都怪我太贪心': '彤大王','孤独患者': '陈奕迅',
    '归途的光': '卢润泽','你看时间等过谁': '彤大王','搀扶': '马健涛','望故乡': '刘钧',
    '诺言': '李翊君','半生雪': '是七叔呢','一路向北': '周杰伦','搁浅': '周杰伦',
    '花妖': '刀郎','蓝莲花': '许巍','笼': '张碧晨','探故知': '浅影阿','天际': '洋澜一',
    '游京': '海伦','一路向北': '周杰伦','喀什噶尔胡杨': '刀郎',
    '青空': '薪盐赤','风居住的街道': '矶村由纪子','神秘园之歌': 'Secret Garden',
    '月光下的凤尾竹': '关牧村','森林狂想曲': '吴金黛','蝉鸣半夏': '忘乡',
    '土耳其进行曲': 'Mozart','烟袋斜街': '接靓','镜中的安娜': 'Nicolas de Angelis',
    '悲伤的西班牙': 'Nicolas de Angelis','斯卡布罗集市（钢琴曲）': 'Traditional',
    '卡农（经典钢琴版）': 'Pachelbel','Jasmine Flower  茉莉花': 'Traditional',
    'Bauade Four Adeline 水边的阿狄丽娜': 'Richard Clayderman',
    'Merry Christmas Mr. Lawrence': '坂本龙一','晚星': '接靓',
    '我在那一角落患过伤风': '陈光荣','Song From A Secret Garden 神秘园之歌': 'Secret Garden',
    '青石巷―魏琮霏': '魏琮霏',
};

// ========== 主逻辑 ==========

/** 从 【歌手名】歌名 格式提取 */
function extractFromBracket(title) {
    const m = title.match(/^【(.+?)】(.+)$/);
    if (m) return { singer: m[1].trim(), title: m[2].trim() };
    return null;
}

/** 规范化标题用于匹配（去标点、去空格） */
function normalize(s) {
    return (s || '').replace(/[，,。．.、\s\-—–（）()【】《》"']/g, '').toLowerCase().trim();
}

async function main() {
    const mode = DRY_RUN ? '🔍 DRY RUN' : '🔧 实际修复';
    console.log(`🎵 歌手填充脚本 — ${mode}\n`);

    // 1. 获取空歌手歌曲
    console.log('📊 获取空歌手歌曲...');
    const emptyResp = await fetch(
        `${SUPABASE_URL}/rest/v1/songs?select=id,title,singer,bvid&singer=eq.&order=id.asc&limit=500`,
        { headers: HEADERS }
    );
    const empty = await emptyResp.json();
    console.log(`  → ${empty.length} 首`);

    // 2. 获取已有歌手的歌曲（用于构建 title→singer 映射）
    console.log('📊 获取已有歌手的歌曲...');
    let withSingers = [];
    let offset = 0;
    while (true) {
        const url = `${SUPABASE_URL}/rest/v1/songs?select=title,singer&singer=neq.&singer=not.is.null&order=id.asc&limit=1000&offset=${offset}`;
        const resp = await fetch(url, { headers: HEADERS });
        const page = await resp.json();
        if (!page || page.length === 0) break;
        withSingers = withSingers.concat(page);
        if (page.length < 1000) break;
        offset += 1000;
    }
    console.log(`  → ${withSingers.length} 首`);

    // 构建 title→singer 映射（按出现频率取最常见的）
    const titleSingers = {}; // normalized_title → { singer: count }
    for (const s of withSingers) {
        if (!s.title || !s.singer) continue;
        const key = normalize(s.title);
        if (!titleSingers[key]) titleSingers[key] = {};
        titleSingers[key][s.singer] = (titleSingers[key][s.singer] || 0) + 1;
    }
    console.log(`  → ${Object.keys(titleSingers).length} 个唯一歌名`);

    // 3. 匹配
    console.log('\n🔍 匹配歌手...');
    const fixes = [];
    const noMatch = [];

    for (const song of empty) {
        let newTitle = song.title;
        let newSinger = '';
        let source = '';

        // Strategy 1: 【Singer】Title format
        const bracket = extractFromBracket(newTitle);
        if (bracket) {
            newTitle = bracket.title;
            newSinger = bracket.singer;
            source = '【】提取';
        }

        // Strategy 2: KNOWN_SINGERS map
        if (!newSinger) {
            // Try exact match
            if (KNOWN_SINGERS[newTitle]) {
                newSinger = KNOWN_SINGERS[newTitle];
                source = '已知映射';
            }
            // Try case-insensitive
            if (!newSinger) {
                for (const [k, v] of Object.entries(KNOWN_SINGERS)) {
                    if (k.toLowerCase() === newTitle.toLowerCase()) {
                        newSinger = v;
                        source = '已知映射(case)';
                        break;
                    }
                }
            }
        }

        // Strategy 3: Match from database (same title, most common singer)
        if (!newSinger) {
            const key = normalize(newTitle);
            const candidates = titleSingers[key];
            if (candidates && Object.keys(candidates).length > 0) {
                // Get most common
                let best = '', bestCount = 0;
                for (const [s, c] of Object.entries(candidates)) {
                    if (c > bestCount) { best = s; bestCount = c; }
                }
                newSinger = best;
                source = `数据库匹配(${bestCount}次)`;
            }
        }

        // Strategy 4: Try normalized match (handles minor differences)
        if (!newSinger) {
            const key = normalize(newTitle);
            // Try fuzzy: if key contains or is contained by a known title
            for (const [knownKey, candidates] of Object.entries(titleSingers)) {
                if (knownKey.length > 4 && key.length > 4 &&
                    (knownKey.includes(key) || key.includes(knownKey))) {
                    let best = '', bestCount = 0;
                    for (const [s, c] of Object.entries(candidates)) {
                        if (c > bestCount) { best = s; bestCount = c; }
                    }
                    if (bestCount >= 2) {
                        newSinger = best;
                        source = `模糊匹配(${bestCount}次)`;
                        break;
                    }
                }
            }
        }

        if (newSinger) {
            fixes.push({
                id: song.id,
                oldTitle: song.title,
                newTitle: newTitle,
                singer: newSinger,
                source,
            });
        } else {
            noMatch.push(song);
        }
    }

    console.log(`  → 匹配成功: ${fixes.length} 首`);
    console.log(`  → 未匹配: ${noMatch.length} 首\n`);

    // Show no-match list
    if (noMatch.length > 0) {
        console.log('=== 未能匹配的歌曲 ===');
        for (const s of noMatch) {
            console.log(`#${s.id} | ${s.title} | ${s.bvid || '?'}`);
        }
        console.log('');
    }

    // Show fixes preview
    console.log(`=== ${DRY_RUN ? '预览' : '修复'} ${fixes.length} 首 ===`);
    for (const f of fixes) {
        const titleChange = f.oldTitle !== f.newTitle ? ` [标题修正]` : '';
        console.log(`#${f.id} | ${f.oldTitle} → ${f.newTitle} | 歌手: ${f.singer} | ${f.source}${titleChange}`);
    }

    if (DRY_RUN) {
        console.log('\n🔍 DRY RUN 完成。实际执行:');
        console.log('  /d/softwa/nodejs/node scripts/fill_singers.js');
        return;
    }

    // 4. 执行修复
    console.log(`\n🔧 开始 PATCH ${fixes.length} 首...`);
    let success = 0, failed = 0;

    for (let i = 0; i < fixes.length; i++) {
        const f = fixes[i];
        try {
            const body = { singer: f.singer };
            if (f.oldTitle !== f.newTitle) body.title = f.newTitle;

            const resp = await fetch(
                `${SUPABASE_URL}/rest/v1/songs?id=eq.${f.id}`,
                {
                    method: 'PATCH',
                    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
                    body: JSON.stringify(body),
                }
            );
            if (resp.ok) success++;
            else { failed++; console.log(`  ✗ #${f.id}: ${await resp.text().then(t => t.slice(0, 60))}`); }
        } catch (err) {
            failed++;
            console.log(`  ✗ #${f.id}: ${err.message}`);
        }
        if ((i + 1) % 100 === 0) console.log(`  进度: ${i + 1}/${fixes.length}`);
        await sleep(80);
    }

    console.log(`\n========== 完成 ==========`);
    console.log(`成功: ${success} | 失败: ${failed} | 总计: ${fixes.length}`);
}

main().catch(err => { console.error('失败:', err); process.exit(1); });
