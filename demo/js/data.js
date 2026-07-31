/* =========================================================================
 * data.js  —  发型数据库 + 发色 + 推荐引擎
 * 数据来源：桌面《收集表(2).pdf》发型收集表（26 款，已剔除侧脸/侧视角度），结合面部分析扩展元数据
 * 所有渲染与推荐均基于本地数据，不上传任何照片。
 * ========================================================================= */

// 发色库（含需求细分的：冷棕、黑茶、奶茶、红棕）
const HAIR_COLORS = [
  { id: 'black',     name: '原生黑', hex: '#1c1611', tone: 'neutral', swatch: '#1c1611' },
  { id: 'darkbrown', name: '深棕',   hex: '#3a261a', tone: 'warm',    swatch: '#3a261a' },
  { id: 'blacktea',  name: '黑茶',   hex: '#2c2018', tone: 'cool',    swatch: '#2c2018' },
  { id: 'coolbrown', name: '冷棕',   hex: '#4a3528', tone: 'cool',    swatch: '#4a3528' },
  { id: 'milktea',   name: '奶茶',   hex: '#7a5a42', tone: 'warm',    swatch: '#7a5a42' },
  { id: 'redbrown',  name: '红棕',   hex: '#6e3a24', tone: 'warm',    swatch: '#6e3a24' },
  { id: 'linen',     name: '亚麻',   hex: '#9c8366', tone: 'cool',    swatch: '#9c8366' },
  { id: 'ash',       name: '闷青',   hex: '#5f6b54', tone: 'cool',    swatch: '#5f6b54' },
  { id: 'honey',     name: '蜜茶金', hex: '#a9794a', tone: 'warm',    swatch: '#a9794a' },
  { id: 'pink',      name: '樱粉',   hex: '#b98a93', tone: 'cool',    swatch: '#b98a93' },
  { id: 'choco',    name: '巧克力棕', hex: '#4a2e1c', tone: 'warm',    swatch: '#4a2e1c' },
  { id: 'caramel',  name: '焦糖棕',  hex: '#8a5a34', tone: 'warm',    swatch: '#8a5a34' },
  { id: 'mocha',    name: '摩卡棕',  hex: '#3a281c', tone: 'neutral', swatch: '#3a281c' },
  { id: 'silver',   name: '银灰',    hex: '#b8b8be', tone: 'cool',    swatch: '#b8b8be' },
  { id: 'blueblack',name: '蓝黑',    hex: '#14161f', tone: 'cool',    swatch: '#14161f' },
  { id: 'wine',     name: '酒红',    hex: '#6e2a34', tone: 'cool',    swatch: '#6e2a34' },
  // —— 细分色（主色系内的过渡/更细色阶）——
  { id: 'chestnut',   name: '栗棕',   hex: '#5a3a22', tone: 'warm',    swatch: '#5a3a22' },
  { id: 'goldbrown',  name: '金棕',   hex: '#8a6a3a', tone: 'warm',    swatch: '#8a6a3a' },
  { id: 'orangebrown',name: '橘棕',   hex: '#8a4a26', tone: 'warm',    swatch: '#8a4a26' },
  { id: 'taup',       name: '灰棕',   hex: '#6a5e54', tone: 'neutral', swatch: '#6a5e54' },
  { id: 'lightlinen', name: '浅亚麻', hex: '#b8a688', tone: 'cool',    swatch: '#b8a688' },
  { id: 'lightpink',  name: '浅粉',   hex: '#d4a8b0', tone: 'cool',    swatch: '#d4a8b0' },
  { id: 'smokyblue',  name: '雾蓝',   hex: '#3a4a5a', tone: 'cool',    swatch: '#3a4a5a' },
  { id: 'berryred',   name: '莓红',   hex: '#822a3e', tone: 'cool',    swatch: '#822a3e' }
];

// 脸型中文标签（与收集表一致）
const FACE_SHAPES = ['圆脸', '方脸', '鹅蛋脸', '长脸', '菱形脸', '心形脸'];

// 风格标签
const STYLE_TAGS = ['简约', '甜酷', '成熟', '通勤'];

/* 发型条目
 * silhouette: crop|short|bob|lob|wolf|medium|long|curly|updo  —— 渲染轮廓类型
 * length:     short|medium|long
 * curl:       straight|wave|curly
 * bang:       none|air|blunt|middle|side|short
 * difficulty: 1~5 与 难度文案
 * styleTags:  用于风格筛选
 * suitableShapes / suitableColors 用于推荐
 * modifies:   修饰哪些面部特点（需求10）
 * careTip:    日常打理要点（需求3）
 */
const HAIRSTYLES = [
  { id: 2, img: "img/styles/s02.jpg", name: '法式空气刘高层次', source: '网络发型', suitableShapes: ['圆脸','方脸'], suitableCrowd: '学生',
    feature: '高颅顶层次', difficulty: 3, difficultyLabel: '中等', silhouette: 'medium', length: 'medium', curl: 'wave', bang: 'air',
    styleTags: ['甜酷','通勤'], suitableColors: ['milktea','coolbrown','linen'],
    modifies: '空气刘显脸小、弱化宽额头', careTip: '空气刘需每日用卷梳吹卷保持蓬松，定型喷雾轻喷。' },

  { id: 3, img: "img/styles/s03.jpg", name: '齐刘海利落', source: '网络发型', suitableShapes: ['圆脸','方脸'], suitableCrowd: '学生、通勤',
    feature: '厚款齐眉', difficulty: 2, difficultyLabel: '低', silhouette: 'bob', length: 'short', curl: 'straight', bang: 'blunt',
    styleTags: ['简约','通勤'], suitableColors: ['black','blacktea','darkbrown'],
    modifies: '厚齐刘修饰宽额头、显乖巧', careTip: '齐刘海每3周修剪保持齐整，吹直防外翘。' },

  { id: 4, img: "img/styles/s04.jpg", name: '高层次狼尾', source: '网络发型', suitableShapes: ['圆脸','方脸'], suitableCrowd: '学生、日常',
    feature: '顶部高蓬松', difficulty: 5, difficultyLabel: '高', silhouette: 'wolf', length: 'long', curl: 'wave', bang: 'side',
    styleTags: ['甜酷'], suitableColors: ['black','coolbrown','darkbrown'],
    modifies: '狼尾拉长脸型、增加顶部蓬松', careTip: '需发蜡/发泥维持层次，后部定期修剪，日常打理较难。' },

  { id: 5, img: "img/styles/s05.jpg", name: '法式羊毛卷', source: '网络素材', suitableShapes: ['菱形脸','长脸'], suitableCrowd: '头发细软',
    feature: '全头细密小卷', difficulty: 3, difficultyLabel: '中等', silhouette: 'curly', length: 'medium', curl: 'curly', bang: 'middle',
    styleTags: ['甜酷','成熟'], suitableColors: ['milktea','redbrown','linen'],
    modifies: '增加发量、柔化菱形脸颧骨', careTip: '羊毛卷需护卷膏，睡觉用发网防压塌。' },

  { id: 7, img: "img/styles/s07.jpg", name: '中分蛋卷短', source: '网络发型', suitableShapes: ['圆脸','方圆脸'], suitableCrowd: '上班族、学生',
    feature: '八字细碎刘', difficulty: 3, difficultyLabel: '中等', silhouette: 'curly', length: 'short', curl: 'curly', bang: 'middle',
    styleTags: ['通勤','甜酷'], suitableColors: ['milktea','linen','coolbrown'],
    modifies: '中分拉长脸型、八字刘修饰颧骨', careTip: '蛋卷需定型喷雾，发尾向外翻更灵动。' },

  { id: 8, img: "img/styles/s08.jpg", name: '港风复古水波纹', source: '网络素材', suitableShapes: ['鹅蛋脸','长脸'], suitableCrowd: '偏爱复古',
    feature: '工整流畅水波', difficulty: 4, difficultyLabel: '偏高', silhouette: 'long', length: 'long', curl: 'wave', bang: 'side',
    styleTags: ['成熟'], suitableColors: ['redbrown','blacktea','darkbrown'],
    modifies: '水波纹复古显气质、修饰长脸', careTip: '需卷发棒维持波纹，睡前编松辫保形。' },

  { id: 9, img: "img/styles/s09.jpg", name: '公主切长直', source: '网络素材', suitableShapes: ['圆脸','方圆脸'], suitableCrowd: '喜欢日系',
    feature: '厚齐刘海', difficulty: 3, difficultyLabel: '中等', silhouette: 'long', length: 'long', curl: 'straight', bang: 'blunt',
    styleTags: ['甜酷'], suitableColors: ['black','blacktea','darkbrown'],
    modifies: '公主切修饰圆脸、侧切显瘦', careTip: '长直发需定期护理防毛躁，用护发油。' },

  { id: 10, img: "img/styles/s10.jpg", name: '高层次鲻鱼', source: '网络发型', suitableShapes: ['圆脸','方圆脸'], suitableCrowd: '气质主打',
    feature: '黑发原生色', difficulty: 4, difficultyLabel: '中上', silhouette: 'wolf', length: 'long', curl: 'straight', bang: 'side',
    styleTags: ['甜酷','通勤'], suitableColors: ['black','blacktea','darkbrown'],
    modifies: '鲻鱼显个性、顶部蓬松', careTip: '后部需定期修剪保持层次，发蜡定型。' },

  { id: 11, img: "img/styles/s11.jpg", name: '纹理飞机头', source: 'AI 生成', suitableShapes: ['方形脸','菱形脸'], suitableCrowd: '学生、年轻',
    feature: '拉高颅顶', difficulty: 3, difficultyLabel: '中等', silhouette: 'short', length: 'short', curl: 'wave', bang: 'none',
    styleTags: ['简约','通勤'], suitableColors: ['black','darkbrown','blacktea'],
    modifies: '飞机头拉长脸型、增强颅顶', careTip: '发蜡由前向后抓蓬颅顶，两侧服帖。' },

  { id: 12, img: "img/styles/s12.jpg", name: '常春藤短发', source: 'AI 生成', suitableShapes: ['方形脸','三角脸'], suitableCrowd: '学生、年轻',
    feature: '自然稳重', difficulty: 3, difficultyLabel: '中等', silhouette: 'short', length: 'short', curl: 'straight', bang: 'side',
    styleTags: ['简约','通勤'], suitableColors: ['darkbrown','blacktea','coolbrown'],
    modifies: '稳重修饰方脸下颌', careTip: '每月修剪保持轮廓，吹顺即可。' },

  { id: 13, img: "img/styles/s13.jpg", name: '低渐变寸头', source: 'AI 生成', suitableShapes: ['方形脸','五角脸'], suitableCrowd: '学生、通勤',
    feature: '清爽利落', difficulty: 1, difficultyLabel: '低', silhouette: 'crop', length: 'short', curl: 'straight', bang: 'none',
    styleTags: ['简约'], suitableColors: ['black','darkbrown','blacktea'],
    modifies: '极简利落、突出五官', careTip: '几乎免打理，推剪器推短即可。' },

  { id: 14, img: "img/styles/s14.jpg", name: '中渐变短发', source: 'AI 生成', suitableShapes: ['方形脸','圆脸'], suitableCrowd: '学生、年轻',
    feature: '提亮侧面', difficulty: 1, difficultyLabel: '低', silhouette: 'crop', length: 'short', curl: 'straight', bang: 'none',
    styleTags: ['简约','通勤'], suitableColors: ['darkbrown','blacktea','coolbrown'],
    modifies: '渐变提亮侧面、显精神', careTip: '两侧渐变定期推剪，免造型。' },

  { id: 15, img: "img/styles/s15.jpg", name: '寸头', source: 'AI 生成', suitableShapes: ['方形脸'], suitableCrowd: '学生、通勤',
    feature: '极简好驾驭', difficulty: 1, difficultyLabel: '低', silhouette: 'crop', length: 'short', curl: 'straight', bang: 'none',
    styleTags: ['简约'], suitableColors: ['black','darkbrown'],
    modifies: '极简好驾驭、突出轮廓', careTip: '免打理，推剪维护。' },

  { id: 16, img: "img/styles/s16.jpg", name: '侧分短发', source: 'AI 生成', suitableShapes: ['方形脸','菱形脸'], suitableCrowd: '学生、通勤',
    feature: '拉长脸型', difficulty: 3, difficultyLabel: '中等', silhouette: 'short', length: 'short', curl: 'straight', bang: 'side',
    styleTags: ['通勤','简约'], suitableColors: ['darkbrown','blacktea','coolbrown'],
    modifies: '侧分拉长脸型、修饰菱形', careTip: '侧分线吹蓬，发蜡定型。' },

  { id: 17, img: "img/styles/s17.jpg", name: '短羊毛卷', source: 'AI 生成', suitableShapes: ['五角脸'], suitableCrowd: '学生、年轻',
    feature: '发量视觉倍增', difficulty: 5, difficultyLabel: '高', silhouette: 'curly', length: 'short', curl: 'curly', bang: 'middle',
    styleTags: ['甜酷'], suitableColors: ['milktea','linen','redbrown'],
    modifies: '增加发量、柔化棱角', careTip: '护卷产品维持，发量视觉更丰盈。' },

  { id: 18, img: "img/styles/s18.jpg", name: '中分微卷', source: 'AI 生成', suitableShapes: ['圆脸','三角脸'], suitableCrowd: '学生、年轻',
    feature: '柔化脸侧线', difficulty: 5, difficultyLabel: '高', silhouette: 'curly', length: 'medium', curl: 'wave', bang: 'middle',
    styleTags: ['甜酷','通勤'], suitableColors: ['milktea','coolbrown','linen'],
    modifies: '微卷柔化脸侧线条', careTip: '微卷需定型，中分线吹蓬。' },

  { id: 19, img: "img/styles/s19.jpg", name: '纹理背头', source: 'AI 生成', suitableShapes: ['方形脸','菱形脸'], suitableCrowd: '学生、通勤',
    feature: '增强颅顶', difficulty: 5, difficultyLabel: '高', silhouette: 'short', length: 'short', curl: 'wave', bang: 'none',
    styleTags: ['成熟','通勤'], suitableColors: ['black','darkbrown','blacktea'],
    modifies: '背头显成熟、增强颅顶', careTip: '发油向后梳定型，需一定手法。' },

  { id: 20, img: "img/styles/s20.jpg", name: '短碎刺头', source: 'AI 生成', suitableShapes: ['圆脸'], suitableCrowd: '学生、年轻',
    feature: '层次轻盈', difficulty: 3, difficultyLabel: '中等', silhouette: 'short', length: 'short', curl: 'straight', bang: 'short',
    styleTags: ['甜酷','简约'], suitableColors: ['darkbrown','blacktea','coolbrown'],
    modifies: '轻盈层次、显活力', careTip: '发蜡抓出碎发，吹蓬即可。' },


  { id: 24, img: "img/styles/s24.jpg", name: '日系蘑菇短', source: '美发沙龙', suitableShapes: ['圆脸','鹅蛋脸'], suitableCrowd: '学生、喜欢',
    feature: '轮廓圆润', difficulty: 2, difficultyLabel: '低', silhouette: 'bob', length: 'short', curl: 'straight', bang: 'blunt',
    styleTags: ['简约','甜酷'], suitableColors: ['black','blacktea','darkbrown'],
    modifies: '圆润轮廓减龄、修饰圆脸', careTip: '齐发尾定期修剪，吹顺。' },


  { id: 29, img: "img/styles/s29.jpg", name: '日系纹理烫', source: '美发平台', suitableShapes: ['方圆脸','鹅蛋脸'], suitableCrowd: '喜欢日系',
    feature: '纹理烫提升', difficulty: 3, difficultyLabel: '中等', silhouette: 'medium', length: 'medium', curl: 'wave', bang: 'side',
    styleTags: ['通勤','甜酷'], suitableColors: ['coolbrown','milktea','darkbrown'],
    modifies: '纹理烫提升颅顶、显蓬松', careTip: '纹理烫定期打理，发蜡抓蓬。' },


  { id: 31, img: "img/styles/s31.jpg", name: '日系碎剪短发', source: 'AI 生成', suitableShapes: ['圆脸','方脸'], suitableCrowd: '年轻人、学生',
    feature: '层次轻盈', difficulty: 1, difficultyLabel: '低', silhouette: 'short', length: 'short', curl: 'straight', bang: 'short',
    styleTags: ['简约','甜酷'], suitableColors: ['darkbrown','blacktea','coolbrown'],
    modifies: '碎剪轻盈、修饰圆脸', careTip: '发蜡抓碎，吹蓬发根。' },

  { id: 32, img: "img/styles/s32.jpg", name: '韩系慵懒云朵大波浪长发', source: '用户上传', suitableShapes: ['鹅蛋脸','方圆脸','菱形脸','长脸'], suitableCrowd: '18-35岁',
    feature: '层次剪裁，松散柔和大波浪', difficulty: 3, difficultyLabel: '中等', silhouette: 'long', length: 'long', curl: 'wave', bang: 'side',
    styleTags: ['甜酷','成熟'], suitableColors: ['black','blacktea','milktea','redbrown'],
    modifies: '大波浪柔化脸型、碎发修饰颧骨、提升浪漫氛围', careTip: '用大卷卷发棒或弹力素维持卷度，发根逆吹蓬松，脸颊碎发定期修剪。' },

  { id: 33, img: "img/styles/s33.jpg", name: '空气刘海黑长直', source: '用户上传', suitableShapes: ['鹅蛋脸','长脸','菱形脸','方圆脸'], suitableCrowd: '16-34岁',
    feature: '低层次剪裁，轻薄空气刘海', difficulty: 2, difficultyLabel: '简单', silhouette: 'long', length: 'long', curl: 'straight', bang: 'air',
    styleTags: ['简约','通勤'], suitableColors: ['black','blacktea','darkbrown'],
    modifies: '顺直长发拉长脸型、空气刘海弱化脸部棱角', careTip: '定期拉直或夹板顺发，刘海用卷梳吹出空气感，发尾护发油防毛躁。' },

  { id: 34, img: "img/styles/s34.jpg", name: '纹理前刺短发', source: '用户上传', suitableShapes: ['圆脸','方脸','菱形脸'], suitableCrowd: '16-32岁',
    feature: '顶部抓刺纹理，两侧渐层', difficulty: 3, difficultyLabel: '中等', silhouette: 'short', length: 'short', curl: 'straight', bang: 'short',
    styleTags: ['简约','甜酷'], suitableColors: ['darkbrown','blacktea','coolbrown','ash'],
    modifies: '顶部纹理拉长脸型、两侧渐层收窄轮廓', careTip: '发蜡指尖抓出前刺纹理，两侧定期推剪保持渐层。' }
];

/* ---------------- 性别标注 ----------------
 * 每款发型标注适用性别，用于「三套优选方案」与「智能推荐」按顾客性别筛选。
 * 男性款（id 11-20）均为 AI 生成的男士短发/渐变/背头类；其余为女性向发型。
 */
const STYLE_GENDER = {
  2:'female', 3:'female', 4:'female', 5:'female',
  7:'female', 8:'female', 9:'female', 10:'female',
  11:'male', 12:'male', 13:'male', 14:'male', 15:'male',
  16:'male', 17:'male', 18:'male', 19:'male', 20:'male',
  24:'female', 29:'female', 31:'female', 32:'female', 33:'female', 34:'male'
};
function styleGender(id){ return STYLE_GENDER[id] || 'female'; }
// 按顾客性别返回候选发型池；gender 为空或 'all' 时返回全部
function stylesForGender(gender){
  if(!gender || gender === 'all') return HAIRSTYLES;
  return HAIRSTYLES.filter(s => styleGender(s.id) === gender);
}

// 每款发型标注适用场景（日常/通勤/约会/聚会/运动/商务/校园/派对等）
const SCENE_MAP = {
  2:'约会、逛街', 3:'校园、通勤', 4:'街拍、音乐节',
  5:'聚会、拍照', 7:'通勤、约会', 8:'约会、派对', 9:'漫展、日常', 10:'街拍、潮流',
  11:'商务、通勤', 12:'校园、通勤', 13:'运动、夏日', 14:'通勤、运动',
  15:'运动、极简', 16:'商务、通勤', 17:'聚会、拍照', 18:'约会、通勤',
  19:'商务、正式场合', 20:'校园、潮流', 24:'校园、日常', 29:'通勤、约会',
  31:'校园、日常', 32:'约会、聚会、婚礼', 33:'校园、通勤、日常', 34:'通勤、约会、校园'
};
function styleScene(id){ return SCENE_MAP[id] || '日常'; }

// 每款发型标注居家打理小贴士（在家就能做的小窍门，区别于 careTip 的沙龙打理要点）
const HOMETIP_MAP = {
  2:'空气刘海用卷梳由下往上吹3秒，保持空气感。',
  3:'齐刘海每早用直板夹轻带防外翘，喷少量定型水。',
  4:'后颈狼尾用发蜡抓出束感，避免贴脖。',
  5:'睡觉戴丝巾发帽或松马尾，防卷度压塌。',
  7:'蛋卷发尾抹弹力素后用手托着吹，卷度更弹。',
  8:'睡前编松三股辫，醒来拆开即是自然水波。',
  9:'长直发每周一次发膜，发尾裹热毛巾5分钟更顺。',
  10:'两侧推剪处用发泥向后梳服帖，后部长发定期修层次。',
  11:'低头倒吹发根颅顶更蓬，发蜡由前向后抓。',
  12:'每月修剪保持轮廓，洗发后自然吹干即可。',
  13:'家用推剪器每2周推短，几乎免打理。',
  14:'两侧渐变每2周推剪，发顶用少量发泥造型。',
  15:'洗头后毛巾按干无需造型，注意头皮防晒。',
  16:'侧分线吹蓬，发蜡沿分线向后定型。',
  17:'护卷用弹力素，勿用密齿梳，手指拨松。',
  18:'中分线吹蓬，发尾用卷发棒补卷维持弧度。',
  19:'发油掌心搓开由前额向后梳光，湿发更好定型。',
  20:'发蜡指尖搓开后抓碎发，发根吹蓬显活力。',
  24:'齐发尾定期修剪，吹直即可，头顶逆吹蓬松。',
  29:'纹理烫用发蜡抓蓬发根，隔天清水拨松即可。',
  31:'发蜡抓碎吹蓬发根，每月修一次保持碎感。',
  32:'大卷用大号卷发棒冷定型，发根逆吹；脸颊碎发修剪。',
  33:'空气刘海卷梳吹蓬，长直发夹板顺拉防毛躁，发尾点护发油。',
  34:'发蜡取黄豆大小搓匀，指尖抓出前刺束感；头顶逆吹更蓬松。'
};
function styleHomeTip(id){ return HOMETIP_MAP[id] || '保持清洁与定期修剪即可。'; }

/* ---------------- 发型避雷提示（需求5）----------------
 * 每款发型标注「什么情况下别选/翻车点」，用于方案卡与理发师沟通卡的避雷区。
 */
const AVOID_MAP = {
  2:'空气刘海出油/流汗易塌，油头或运动量大者慎选；额头低者会显局促。',
  3:'厚齐刘海显脸方、放大宽脸；额头高度不足或方脸慎选，易显沉闷。',
  4:'狼尾打理难度高，油性发质易贴脖显脏；商务正式场合不适用。',
  5:'羊毛卷需大量护理，发质受损/极细软者卷度撑不住；长脸慎选易显头大。',
  7:'蛋卷卷度掉得快，头发过硬不吃烫者不推荐；圆脸配短款易显脸圆。',
  8:'水波纹造型耗时，年轻学生场景偏老气；扁塌发根撑不出复古弧度。',
  9:'公主切侧切一旦剪坏很难补救，脸大/颧骨高者侧发反而框脸。',
  10:'鲻鱼个性强，职场保守环境不适合；后颈层次需频繁修剪。',
  11:'飞机头依赖发蜡定型，塌发/细软发撑不起颅顶；圆脸慎选显头圆。',
  12:'常春藤偏正式，发际线后移者两侧会暴露；需每月修剪保持轮廓。',
  13:'寸头对头型和头皮要求高，头型不平、发际线高者慎剪。',
  14:'渐变两侧需2周一推，懒于打理者维护成本高。',
  15:'寸头几乎放大一切头皮/头型问题，疤痕、色斑者慎选。',
  16:'侧分需吹蓬定型，发质硬翘者分线难服帖；油头易塌线。',
  17:'短羊毛卷维护极高，发量少者卷后反显稀；棱角脸配短卷可能显方。',
  18:'微卷掉卷快需频繁补卷，直发不吃烫者不划算。',
  19:'背头显成熟偏老，发际线高/学生场景慎选；需发油手法。',
  20:'刺头显年轻但偏学生气，正式商务场景不适用。',
  24:'蘑菇头包脸，脸大/腮帮宽者会被显得更圆更方。',
  29:'纹理烫需定期打理，细软发烫后易塌；圆脸配中长注意别显脸圆。',
  31:'碎剪偏中性帅气，想显温柔淑女者慎选。',
  32:'大波浪需卷发棒维持，极细软/受损发撑不住卷度显毛躁；圆胖脸配大卷易显头大。',
  33:'黑长直放大脸型缺点，脸大/毛躁发质者显脸宽；空气刘海出油易塌。',
  34:'前刺需一定发量支撑，发际线过高或头顶稀疏者抓不出纹理；发质极软易塌。'
};
function styleAvoid(id){ return AVOID_MAP[id] || '按脸型与发质谨慎评估，必要时先做局部试样。'; }

/* ---------------- 剪裁要点（需求5：理发师沟通卡）----------------
 * 给理发师看的技术要点：分区、层次、留长、烫染建议。
 */
const CUTKEY_MAP = {
  2:'空气刘海取薄一片打薄至眉下，顶区加层次；卷梳吹卷定型。',
  3:'齐眉厚刘海一刀平剪留厚度，两侧过渡自然；发尾齐bob不打薄。',
  4:'顶短后长，狼尾层次分明，后颈留尖；发蜡抓束感。',
  5:'全头细密小卷冷烫，发尾护卷；中分修脸。',
  7:'短款蛋卷烫，八字细碎刘海打薄；发尾外翻。',
  8:'工整水波纹热烫，分线清晰；侧分修脸。',
  9:'厚齐刘海+两侧公主切齐剪，长直发尾修齐。',
  10:'顶区高层次，后长鲻鱼尾，侧发打薄；黑发原生色。',
  11:'两侧渐变收短，顶区留长向前抓纹理；发蜡定型。',
  12:'常春藤经典分区，侧短顶中，侧分线；免烫。',
  13:'低位渐变(0-2mm起推)，顶区保留少量长度。',
  14:'中位渐变，顶区留2-3cm做纹理。',
  15:'全头均匀寸头3-6mm，收干净轮廓。',
  16:'侧分短发，重侧留长做偏分，轻侧收短。',
  17:'短羊毛卷冷烫，全头小卷；发量少者加密卷。',
  18:'中长微卷电棒烫，中分；发尾S弧。',
  19:'纹理背头，两侧收短，顶区留长向后梳；发油定型。',
  20:'短碎刺，顶区打薄抓刺；两侧渐变过渡。',
  24:'蘑菇bob齐尾内扣，齐刘海；轮廓圆润。',
  29:'日系纹理烫，中长层次；发蜡抓蓬。',
  31:'日系碎剪短发，全头打薄轻盈；发蜡抓碎。',
  32:'长发大层次剪裁，大号卷发棒/大卷烫做松散大波浪，脸颊留修饰碎发。',
  33:'低层次一刀平顺直，轻薄空气刘海取薄片打薄；发尾修齐。',
  34:'顶部留4-6cm剪碎发纹理，前额抓前刺；两侧低位渐变(1-3mm)收干净。'
};
function styleCutKey(id){ return CUTKEY_MAP[id] || '按发型轮廓分区剪裁，结合脸型微调层次与留长。'; }

/* ---------------- 本店热门榜单（需求6）----------------
 * heat：人气热度值（0-100），rank 由 heat 排序生成。数据可由后端存档统计替换。
 */
const POPULAR_HEAT = {
  32:98, 33:92, 2:88, 29:85, 24:82, 7:80, 5:78,
  9:75, 31:73, 8:70, 10:68,
  11:90, 16:84, 12:79, 14:76, 20:72, 34:70, 13:66, 19:64, 15:60, 17:58, 18:55, 4:52, 3:50
};
function popularHeat(id){ return POPULAR_HEAT[id] || 40; }
// 返回按热度排序的发型（可按性别过滤）
function popularRanking(gender, n){
  const pool = stylesForGender(gender);
  const ranked = pool.map(s => ({ style:s, heat: popularHeat(s.id) }))
    .sort((a,b) => b.heat - a.heat);
  return n ? ranked.slice(0, n) : ranked;
}

/* ---------------- 季节发型专题（需求6）----------------
 * 每款归入一个或多个季节；用于季节专题页。
 */
const SEASON_MAP = {
  spring: { name:'春 · 轻盈减龄', icon:'🌸', desc:'轻柔卷度与减龄短发，配奶茶/浅棕，清新有活力。', ids:[2,7,18,24,31,5] },
  summer: { name:'夏 · 清爽利落', icon:'🌊', desc:'清爽短发与利落渐变，透气好打理，配冷棕/黑茶。', ids:[13,14,15,16,20,3,31] },
  autumn: { name:'秋 · 温柔知性', icon:'🍂', desc:'中长层次与大波浪，配栗棕/焦糖，温柔有氛围感。', ids:[29,32,8,5,12] },
  winter: { name:'冬 · 复古气质', icon:'❄️', desc:'黑长直与复古水波，配蓝黑/酒红，沉稳有质感。', ids:[33,8,9,10,19,32] }
};
function seasonStyles(key){
  const s = SEASON_MAP[key]; if(!s) return [];
  return s.ids.map(getStyleById).filter(Boolean);
}

/* ---------------- 推荐引擎 ---------------- */

// 需要烫染才能成型的发型（卷/烫/纹理类）——用于「是否接受烫染」问卷过滤
function needsPerm(style){
  return style.curl === 'curly' || style.silhouette === 'curly' ||
         /烫|卷|波浪|水波|蛋卷|羊毛/.test(style.name || '');
}

// 根据面部分析结果 + 发质问卷给单款发型打分（0~100）
// metrics 可含问卷字段：hairType('fine'|'normal'|'thick'|'curly') / styleTime('quick'|'normal'|'patient') / acceptPerm(bool)
function scoreStyle(style, metrics) {
  let score = 50;
  // 脸型匹配
  if (metrics.faceShape && style.suitableShapes.includes(metrics.faceShape)) score += 30;
  else score -= 8;
  // 肤色冷暖 → 发色适配（若当前选定发色在 suitableColors 内给加分）
  if (metrics.skinTone && style.suitableColors.length) {
    const toneMatch = HAIR_COLORS.filter(c => style.suitableColors.includes(c.id) && c.tone === metrics.skinTone);
    if (toneMatch.length) score += 8;
  }
  // 难度偏好：新手偏好低难度
  if (metrics.preferEasy && style.difficulty <= 2) score += 6;

  // —— 发质问卷（需求3）——
  // ① 打理时长：时间少者强偏好低难度、免打理款
  if (metrics.styleTime === 'quick') {
    if (style.difficulty <= 2) score += 14; else if (style.difficulty >= 4) score -= 16;
  } else if (metrics.styleTime === 'patient') {
    if (style.difficulty >= 4) score += 6; // 愿意花时间者可驾驭高难度
  }
  // ② 是否接受烫染：不接受则大幅降权需烫染款
  if (metrics.acceptPerm === false && needsPerm(style)) score -= 22;
  if (metrics.acceptPerm === true && needsPerm(style)) score += 4;
  // ③ 发质类型
  if (metrics.hairType === 'fine') { // 细软：偏好蓬松层次/短款，长直大波浪撑不住
    if (/蓬松|层次|颅顶|渐变|寸/.test(style.feature + style.modifies)) score += 8;
    if (style.length === 'long' && style.curl !== 'straight') score -= 8;
  } else if (metrics.hairType === 'thick') { // 粗硬多：偏好打薄层次，厚重直发显头大
    if (/打薄|层次|碎/.test(style.modifies + style.careTip)) score += 8;
  } else if (metrics.hairType === 'curly') { // 自然卷：偏好卷发造型或利落短
    if (needsPerm(style) || style.length === 'short') score += 6;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

// 智能推荐：返回按分数排序的前 N 款（已按顾客性别筛选）
function recommendStyles(metrics, n = 8) {
  const pool = stylesForGender(metrics.gender);
  const scored = pool.map(s => ({ style: s, score: scoreStyle(s, metrics) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n);
}

// 三套优选方案：日常百搭 / 改变大 / 保守稳妥（均已按顾客性别筛选，三款互不重复）
function generatePlans(metrics) {
  const pool = stylesForGender(metrics.gender);
  const scored = pool.map(s => ({ style: s, score: scoreStyle(s, metrics) }));
  const byScore = [...scored].sort((a, b) => b.score - a.score);
  const takenIds = new Set();  // 已选发型 id，保证三款互不重复

  // 日常百搭款：高匹配 + 难度低/中 + 偏通勤简约
  const dailyEntry = byScore
    .filter(x => !takenIds.has(x.style.id) && x.style.difficulty <= 3 && (x.style.styleTags.includes('通勤') || x.style.styleTags.includes('简约')))
    .slice(0, 1)[0] || byScore.filter(x => !takenIds.has(x.style.id))[0];
  const daily = dailyEntry.style;
  takenIds.add(daily.id);

  // 改变大款：与当前发长反差最大 + 卷度/发色更鲜明
  const curLen = metrics.currentLength || 'medium';
  const oppositeLen = curLen === 'short' ? 'long' : (curLen === 'long' ? 'short' : 'long');
  const boldEntry = [...pool]
    .filter(s => !takenIds.has(s.id))
    .map(s => ({ style: s, score: (s.length === oppositeLen ? 25 : 0) + (s.curl !== 'straight' ? 10 : 0) + scoreStyle(s, metrics) * 0.4 }))
    .sort((a, b) => b.score - a.score)[0];
  const bold = boldEntry ? boldEntry.style : pool.filter(s => !takenIds.has(s.id))[0];
  if(bold) takenIds.add(bold.id);

  // 保守稳妥款：匹配好 + 难度低 + 接近当前发长 + 自然发色
  const safeEntry = [...pool]
    .filter(s => !takenIds.has(s.id))
    .map(s => ({ style: s, score: (s.length === curLen ? 20 : 0) + (s.difficulty <= 2 ? 20 : 0) + scoreStyle(s, metrics) * 0.5 }))
    .sort((a, b) => b.score - a.score)[0];
  const safe = safeEntry ? safeEntry.style : pool.filter(s => !takenIds.has(s.id))[0];

  return {
    daily: daily,
    bold: bold,
    safe: safe
  };
}

// 工具
function getColorById(id) { return HAIR_COLORS.find(c => c.id === id) || HAIR_COLORS[0]; }
function getStyleById(id) { return HAIRSTYLES.find(s => s.id === id); }
