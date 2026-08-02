/* ============================================================
   肉搏場 — 資料表
   波次生存 × 自動攻擊 × 商店 build 類型，全近戰特化版
   所有數值為本專案自行重建，非引用任何既有作品數據
   ============================================================ */

/* ---------- 屬性定義 ---------- */
const STAT_DEFS = [
  { key: 'maxHp',   name: '最大生命', suffix: '',  color: '#e05c5c', desc: '生命上限' },
  { key: 'regen',   name: '生命回復', suffix: '/秒', color: '#6fbf73', desc: '每秒回復的生命' },
  { key: 'lifesteal', name: '吸血',   suffix: '%', color: '#c0567a', desc: '造成傷害時依比例回血' },
  { key: 'dmg',     name: '近戰傷害', suffix: '%', color: '#e08b3c', desc: '所有武器傷害倍率' },
  { key: 'atkSpd',  name: '攻擊速度', suffix: '%', color: '#e0c341', desc: '縮短武器冷卻' },
  { key: 'crit',    name: '爆擊率',   suffix: '%', color: '#e0e0e0', desc: '爆擊機率（上限 100）' },
  { key: 'range',   name: '攻擊範圍', suffix: '%', color: '#7ab8e0', desc: '近戰判定的長度與角度' },
  { key: 'armor',   name: '護甲',     suffix: '',  color: '#9aa4b2', desc: '遞減式減傷，越疊效益越低' },
  { key: 'block',   name: '格擋',     suffix: '%', color: '#8fb0d9', desc: '觸發時傷害減半並反彈' },
  { key: 'dodge',   name: '閃避',     suffix: '%', color: '#79d9c0', desc: '完全免傷（上限 60）' },
  { key: 'speed',   name: '移動速度', suffix: '%', color: '#b3d97a', desc: '走位快慢' },
  { key: 'luck',    name: '幸運',     suffix: '%', color: '#d9b06a', desc: '影響掉落、寶箱與商店稀有度' },
  { key: 'harvest', name: '收成',     suffix: '',  color: '#77c47f', desc: '每波結束額外獲得素材' },
];
const STAT_MAP = {};
STAT_DEFS.forEach(s => STAT_MAP[s.key] = s);

function blankStats() {
  const o = {};
  STAT_DEFS.forEach(s => o[s.key] = 0);
  return o;
}

/* ---------- 職業 ----------
   設計原則：每個職業都有明顯的正面與負面，逼出不同 build 路線。
   special 為引擎讀取的機制旗標。
*/
const CHARACTERS = [
  {
    id: 'boxer', name: '拳擊手', tag: '快拳短程',
    color: '#d9564f', skin: '#e8b48a',
    stats: { atkSpd: 30, crit: 8, range: -25, maxHp: -5 },
    weapon: 'jab', slots: 6,
    special: 'combo_boxer',
    desc: '出手極快但打不遠。連續命中同一個敵人時，每段追加 8% 傷害，最多五段。',
  },
  {
    id: 'wrestler', name: '摔角手', tag: '抓取控場',
    color: '#c2703c', skin: '#d9a273',
    stats: { maxHp: 30, dmg: 15, armor: 3, speed: -10, atkSpd: -20 },
    weapon: 'suplex', slots: 6,
    special: 'grab_master',
    desc: '厚實但遲鈍。所有抓取類武器的定身時間延長 50%，抓取傷害 +25%。',
  },
  {
    id: 'karate', name: '空手道家', tag: '一擊必殺',
    color: '#e8e4dc', skin: '#e8b48a',
    stats: { crit: 15, dmg: 10, maxHp: -20, armor: -2 },
    weapon: 'reverse_punch', slots: 6,
    special: 'crit_shock',
    desc: '紙糊的身體，致命的拳。爆擊時對周圍 90 範圍內所有敵人追加一次半傷震盪。',
  },
  {
    id: 'kenshi', name: '劍豪', tag: '重斬慢刀',
    color: '#4f5d75', skin: '#e0c0a0',
    stats: { dmg: 30, range: 15, atkSpd: -25, maxHp: -15 },
    weapon: 'katana', slots: 6,
    special: 'iai',
    desc: '一刀勝過十拳。爆擊時觸發居合追斬，對同一目標再補一次 70% 傷害。',
  },
  {
    id: 'judo', name: '柔道家', tag: '借力打力',
    color: '#3c6ea5', skin: '#e8b48a',
    stats: { dodge: 18, block: 12, dmg: -15, maxHp: 10 },
    weapon: 'shoulder_throw', slots: 6,
    special: 'dodge_momentum',
    desc: '不硬碰硬。每次閃避成功立刻回復 15 點氣勢，並讓下一擊必定爆擊。',
  },
  {
    id: 'sumo', name: '相撲力士', tag: '肉山推進',
    color: '#c9576b', skin: '#e8c0a0',
    stats: { maxHp: 90, armor: 8, speed: -28, range: -15, atkSpd: -10 },
    weapon: 'harite', slots: 6,
    special: 'body_check',
    desc: '走得慢，但撞上去就是傷害。與敵人接觸時每秒造成 12 點碰撞傷害並推開對方。',
  },
  {
    id: 'muaythai', name: '泰拳士', tag: '肘膝吸血',
    color: '#b8453c', skin: '#c99368',
    stats: { lifesteal: 10, atkSpd: 12, dmg: 5, armor: -3, maxHp: -10 },
    weapon: 'elbow', slots: 6,
    special: 'no_regen',
    desc: '完全不會自然回血，只能靠打人回血。吸血量額外 +50%。',
  },
  {
    id: 'monk', name: '武僧', tag: '氣勢流轉',
    color: '#c9803c', skin: '#dcb089',
    stats: { regen: 5, luck: 20, dmg: -10, maxHp: 15 },
    weapon: 'palm', slots: 6,
    special: 'fast_momentum',
    desc: '氣勢累積速度加倍，爆發狀態延長 3 秒。修得慢，但氣一起來就停不下。',
  },
  {
    id: 'ninja', name: '忍者', tag: '游走亂鬥',
    color: '#33384a', skin: '#d9b48a',
    stats: { speed: 28, dodge: 20, crit: 5, maxHp: -35, armor: -4 },
    weapon: 'tanto', slots: 6,
    special: 'move_haste',
    desc: '一被抓到就死。移動中每秒累積攻速，最高 +40%，停下來立刻歸零。',
  },
  {
    id: 'thug', name: '街頭混混', tag: '撿破爛致富',
    color: '#6b7a4a', skin: '#c99368',
    stats: { harvest: 5, luck: 30, dmg: -20, maxHp: 10 },
    weapon: 'pipe', slots: 6,
    special: 'scrap_rush',
    desc: '每撿一份素材，攻速 +6% 持續 3 秒，可疊到 +60%。錢比拳頭重要。',
  },
  {
    id: 'nunchaku', name: '雙節棍手', tag: '密集連打',
    color: '#d9a441', skin: '#d9a273',
    stats: { atkSpd: 45, range: 10, dmg: -28, maxHp: -5 },
    weapon: 'nunchaku', slots: 6,
    special: 'flurry',
    desc: '單發很軟，但每一擊都會多打一次影子攻擊（40% 傷害）。',
  },
  {
    id: 'ironhead', name: '鐵頭功', tag: '硬碰硬',
    color: '#8a8f99', skin: '#e0b48a',
    stats: { armor: 12, block: 22, maxHp: 25, atkSpd: -28, speed: -8 },
    weapon: 'headbutt', slots: 6,
    special: 'thorns',
    desc: '受到的每次傷害都會反彈 150% 給攻擊者，格擋成功時反彈翻倍。',
  },
  {
    id: 'taichi', name: '太極', tag: '四兩撥千斤',
    color: '#5a7a6b', skin: '#dcb089',
    stats: { block: 30, armor: 4, dmg: -12, speed: -8, maxHp: 15 },
    weapon: 'pushhand', slots: 6,
    special: 'reflect_master',
    desc: '格擋成功時完全免傷，並把 250% 傷害反彈回去。',
  },
  {
    id: 'berserker', name: '狂人', tag: '殘血爆發',
    color: '#a33c3c', skin: '#d9a08a',
    stats: { dmg: 10, atkSpd: 10, armor: -4, maxHp: 10 },
    weapon: 'cleaver', slots: 6,
    special: 'rage',
    desc: '每失去 10% 生命，傷害 +10%、攻速 +5%。生命永遠不會自然回復。',
  },
  {
    id: 'strongman', name: '大力士', tag: '雙手極重',
    color: '#8c6239', skin: '#e0b48a',
    stats: { dmg: 60, maxHp: 25, atkSpd: -15, speed: -12 },
    weapon: 'sledge', slots: 2,
    special: 'two_slots',
    desc: '武器欄只有 2 格，換來壓倒性的單發威力。走精不走多。',
  },
];

/* ---------- 武器 ----------
   type：arc 扇形揮擊 / thrust 直線突刺 / spin 環繞 / grab 抓取 / slam 落點衝擊
   數值為第 1 階；升階以 TIER_SCALE 乘算，另有部分武器的階級特效。
*/
const TIER_SCALE = [
  null,
  { dmg: 1.00, cd: 1.00, range: 1.00, price: 1.0 },
  { dmg: 1.75, cd: 0.94, range: 1.06, price: 2.6 },
  { dmg: 2.85, cd: 0.88, range: 1.12, price: 6.0 },
  { dmg: 4.40, cd: 0.80, range: 1.20, price: 13.0 },
];
const TIER_NAME = [null, '普通', '精良', '稀有', '傳說'];
const TIER_COLOR = [null, '#b9bcc4', '#5b9bd5', '#a06fd0', '#d98a3c'];

const WEAPONS = [
  { id: 'jab', name: '直拳', klass: '拳', type: 'thrust', icon: 'fist', color: '#e0a458',
    dmg: 9, cd: 0.42, range: 86, arc: 34, knock: 40, critMult: 1.5, crit: 5, price: 9,
    desc: '出手最快的基礎攻擊，範圍窄。' },
  { id: 'hook', name: '勾拳', klass: '拳', type: 'arc', icon: 'fist', color: '#e08a58',
    dmg: 14, cd: 0.62, range: 91, arc: 95, knock: 70, critMult: 1.6, crit: 6, price: 14,
    desc: '橫掃半圈，能同時揍到兩三個。' },
  { id: 'uppercut', name: '上鉤拳', klass: '拳', type: 'slam', icon: 'fist', color: '#e06858',
    dmg: 26, cd: 1.05, range: 80, arc: 360, knock: 150, critMult: 2.0, crit: 8, price: 20,
    desc: '把貼身的敵人整個掀開，擊退極高。' },
  { id: 'reverse_punch', name: '正拳', klass: '拳', type: 'thrust', icon: 'fist', color: '#e8e4dc',
    dmg: 18, cd: 0.72, range: 102, arc: 26, knock: 55, critMult: 2.2, crit: 12, price: 16,
    desc: '瞄準要害的直線一擊，爆擊倍率很高。' },
  { id: 'palm', name: '鐵砂掌', klass: '掌', type: 'thrust', icon: 'palm', color: '#d9b06a',
    dmg: 22, cd: 0.9, range: 127, arc: 30, knock: 90, critMult: 1.7, crit: 6, price: 18,
    pierce: true, desc: '掌風貫穿一直線上的所有敵人。' },
  { id: 'pushhand', name: '推手', klass: '掌', type: 'arc', icon: 'palm', color: '#8fb0d9',
    dmg: 11, cd: 0.7, range: 108, arc: 130, knock: 190, critMult: 1.5, crit: 4, price: 15,
    desc: '傷害低但推得極遠，是保命的距離管理工具。' },
  { id: 'roundhouse', name: '迴旋踢', klass: '腿', type: 'arc', icon: 'leg', color: '#c9d96a',
    dmg: 19, cd: 0.85, range: 121, arc: 120, knock: 95, critMult: 1.6, crit: 6, price: 18,
    desc: '大角度掃擊，兼顧範圍與威力。' },
  { id: 'sweep', name: '掃堂腿', klass: '腿', type: 'spin', icon: 'leg', color: '#a8c95a',
    dmg: 8, cd: 0.5, range: 97, arc: 360, knock: 60, critMult: 1.4, crit: 4, price: 16,
    slow: 0.35, desc: '整圈掃倒，命中的敵人會被減速。' },
  { id: 'knee', name: '飛膝', klass: '腿', type: 'thrust', icon: 'leg', color: '#d97a5a',
    dmg: 30, cd: 1.15, range: 83, arc: 40, knock: 110, critMult: 1.8, crit: 7, price: 21,
    desc: '短距離高衝擊，越貼身越划算。' },
  { id: 'elbow', name: '肘擊', klass: '肘膝', type: 'arc', icon: 'elbow', color: '#b8453c',
    dmg: 24, cd: 0.8, range: 75, arc: 80, knock: 60, critMult: 1.7, crit: 6, price: 19,
    lifesteal: 6, desc: '貼臉才打得到，附帶 6% 吸血。' },
  { id: 'headbutt', name: '頭槌', klass: '肘膝', type: 'slam', icon: 'head', color: '#9aa4b2',
    dmg: 34, cd: 1.3, range: 63, arc: 360, knock: 130, critMult: 1.9, crit: 5, price: 22,
    selfArmor: 2, desc: '極短範圍的重擊，命中時自身護甲短暫 +2。' },
  { id: 'harite', name: '張手', klass: '相撲', type: 'arc', icon: 'palm', color: '#c9576b',
    dmg: 20, cd: 0.95, range: 132, arc: 150, knock: 210, critMult: 1.5, crit: 4, price: 20,
    desc: '相撲的推擠掌擊，範圍大、擊退最兇。' },
  { id: 'suplex', name: '過肩摔', klass: '摔技', type: 'grab', icon: 'grab', color: '#c2703c',
    dmg: 40, cd: 1.5, range: 94, arc: 50, knock: 30, critMult: 1.8, crit: 5, price: 24,
    stun: 1.1, desc: '抓住敵人砸向地面，命中後定身 1.1 秒。' },
  { id: 'shoulder_throw', name: '背負投', klass: '摔技', type: 'grab', icon: 'grab', color: '#3c6ea5',
    dmg: 28, cd: 1.1, range: 86, arc: 60, knock: 160, critMult: 1.7, crit: 6, price: 21,
    stun: 0.7, desc: '把對手甩出去撞開後面的敵人。' },
  { id: 'chokehold', name: '鎖喉', klass: '摔技', type: 'grab', icon: 'grab', color: '#7a5c8a',
    dmg: 16, cd: 1.4, range: 77, arc: 45, knock: 0, critMult: 2.0, crit: 8, price: 23,
    stun: 2.0, dot: 12, desc: '定身 2 秒並持續流失生命，處理精英的答案。' },
  { id: 'katana', name: '打刀', klass: '刃', type: 'arc', icon: 'blade', color: '#4f5d75',
    dmg: 32, cd: 1.0, range: 144, arc: 110, knock: 70, critMult: 2.0, crit: 9, price: 25,
    desc: '長、狠、慢。一刀掃過整排雜兵。' },
  { id: 'tanto', name: '短刀', klass: '刃', type: 'thrust', icon: 'blade', color: '#33384a',
    dmg: 12, cd: 0.36, range: 80, arc: 28, knock: 25, critMult: 2.4, crit: 14, price: 17,
    desc: '極快的刺擊，爆擊流的核心零件。' },
  { id: 'cleaver', name: '砍刀', klass: '刃', type: 'arc', icon: 'blade', color: '#a33c3c',
    dmg: 27, cd: 0.88, range: 113, arc: 100, knock: 80, critMult: 1.8, crit: 7, price: 20,
    bleed: 8, desc: '造成流血，敵人在 3 秒內持續掉血。' },
  { id: 'bokken', name: '木刀', klass: '刃', type: 'arc', icon: 'blade', color: '#b08a5a',
    dmg: 21, cd: 0.75, range: 127, arc: 105, knock: 100, critMult: 1.6, crit: 5, price: 15,
    desc: '不開鋒但夠長夠穩，新手最好用的一把。' },
  { id: 'nunchaku', name: '雙節棍', klass: '棍', type: 'spin', icon: 'nunchaku', color: '#d9a441',
    dmg: 7, cd: 0.3, range: 91, arc: 360, knock: 35, critMult: 1.5, crit: 6, price: 19,
    desc: '不停旋轉的多段打擊，數量取勝。' },
  { id: 'pipe', name: '鋼管', klass: '棍', type: 'arc', icon: 'pipe', color: '#6b7a4a',
    dmg: 17, cd: 0.7, range: 119, arc: 90, knock: 120, critMult: 1.7, crit: 5, price: 12,
    desc: '路邊撿的，便宜大碗。' },
  { id: 'staff', name: '長棍', klass: '棍', type: 'thrust', icon: 'pipe', color: '#8c6239',
    dmg: 20, cd: 0.68, range: 177, arc: 24, knock: 90, critMult: 1.6, crit: 5, price: 20,
    pierce: true, desc: '近戰裡射程最長的一把，貫穿直線。' },
  { id: 'sledge', name: '大鎚', klass: '重械', type: 'slam', icon: 'hammer', color: '#8c6239',
    dmg: 58, cd: 1.9, range: 102, arc: 360, knock: 220, critMult: 2.0, crit: 5, price: 28,
    desc: '慢到令人絕望，但砸下去周圍全部躺平。' },
  { id: 'chainsaw', name: '鏈鋸', klass: '重械', type: 'spin', icon: 'saw', color: '#c9484a',
    dmg: 6, cd: 0.16, range: 80, arc: 360, knock: 15, critMult: 1.4, crit: 3, price: 30,
    desc: '持續高頻切割，貼著敵人不放就會融化。' },
];
const WEAPON_MAP = {};
WEAPONS.forEach(w => WEAPON_MAP[w.id] = w);

function makeWeapon(id, tier) {
  const base = WEAPON_MAP[id];
  const s = TIER_SCALE[tier];
  return {
    uid: 'w' + (makeWeapon._n = (makeWeapon._n || 0) + 1),
    id: base.id, name: base.name, klass: base.klass, type: base.type,
    icon: base.icon, color: base.color, tier: tier,
    dmg: Math.round(base.dmg * s.dmg * 10) / 10,
    cd: base.cd * s.cd,
    range: Math.round(base.range * s.range),
    arc: base.arc, knock: base.knock,
    critMult: base.critMult, crit: base.crit,
    pierce: !!base.pierce, stun: base.stun || 0, dot: base.dot || 0,
    bleed: base.bleed || 0, slow: base.slow || 0,
    lifesteal: base.lifesteal || 0, selfArmor: base.selfArmor || 0,
    desc: base.desc,
    cdLeft: 0, angle: 0, swing: 0, swingDir: 1, target: null,
  };
}
function weaponPrice(id, tier) {
  const base = WEAPON_MAP[id];
  return Math.round(base.price * TIER_SCALE[tier].price);
}

/* ---------- 道具 ----------
   tier 決定商店出現波次與價格；stats 為直接加成；special 為引擎特效旗標。
*/
const ITEMS = [
  { id: 'bandage',   name: '繃帶',       tier: 1, price: 10, stats: { maxHp: 8, regen: 1 } },
  { id: 'brassknuckle', name: '指虎',    tier: 1, price: 12, stats: { dmg: 8 } },
  { id: 'jumprope',  name: '跳繩',       tier: 1, price: 11, stats: { atkSpd: 8, speed: 5 } },
  { id: 'sandbag',   name: '沙袋',       tier: 1, price: 12, stats: { dmg: 6, atkSpd: -4, maxHp: 6 } },
  { id: 'mouthguard', name: '護齒',      tier: 1, price: 10, stats: { armor: 2 } },
  { id: 'wristwrap', name: '手綁帶',     tier: 1, price: 11, stats: { atkSpd: 10, range: -5 } },
  { id: 'sneaker',   name: '破球鞋',     tier: 1, price: 10, stats: { speed: 10 } },
  { id: 'lucky_coin', name: '幸運銅板',  tier: 1, price: 12, stats: { luck: 15 } },
  { id: 'work_glove', name: '工作手套',  tier: 1, price: 11, stats: { harvest: 2 } },
  { id: 'stone',     name: '磨刀石',     tier: 1, price: 13, stats: { crit: 5 } },
  { id: 'towel',     name: '汗巾',       tier: 1, price: 10, stats: { regen: 2, maxHp: 5 } },
  { id: 'chalk',     name: '止滑粉',     tier: 1, price: 12, stats: { block: 6 } },

  { id: 'weight_vest', name: '負重背心', tier: 2, price: 24, stats: { maxHp: 25, dmg: 10, speed: -12 } },
  { id: 'steel_toe', name: '鋼頭靴',     tier: 2, price: 26, stats: { dmg: 12, armor: 2 } },
  { id: 'protein',   name: '高蛋白',     tier: 2, price: 25, stats: { maxHp: 30, regen: 2 } },
  { id: 'adrenaline', name: '腎上腺素',  tier: 2, price: 27, stats: { atkSpd: 18, regen: -2 } },
  { id: 'leather_belt', name: '皮腰帶',  tier: 2, price: 24, stats: { armor: 4, block: 8 } },
  { id: 'sharp_ring', name: '尖刺戒指',  tier: 2, price: 26, stats: { crit: 8, dmg: 6 } },
  { id: 'reach_pad', name: '護臂',       tier: 2, price: 25, stats: { range: 15, armor: 1 } },
  { id: 'vampire_fang', name: '吸血牙',  tier: 2, price: 28, stats: { lifesteal: 6 } },
  { id: 'magnet',    name: '磁鐵',       tier: 2, price: 24, stats: { harvest: 3 }, special: 'magnet' },
  { id: 'oil_can',   name: '潤滑油',     tier: 2, price: 25, stats: { atkSpd: 14, block: -4 } },
  { id: 'shin_guard', name: '護脛',      tier: 2, price: 26, stats: { dodge: 8, speed: 5 } },
  { id: 'gambler',   name: '賭徒骰子',   tier: 2, price: 27, stats: { luck: 25, maxHp: -10 } },

  { id: 'iron_will', name: '鋼鐵意志',   tier: 3, price: 52, stats: { armor: 8, maxHp: 20 }, special: 'lastStand' },
  { id: 'berserk_mask', name: '狂化面具', tier: 3, price: 55, stats: { dmg: 25, armor: -4 }, special: 'lowHpDmg' },
  { id: 'combo_meter', name: '連段計數器', tier: 3, price: 54, stats: { atkSpd: 12 }, special: 'comboBoost' },
  { id: 'reflex_chip', name: '反射晶片', tier: 3, price: 56, stats: { dodge: 12, block: 10 } },
  { id: 'exec_blade', name: '處刑刻印',  tier: 3, price: 58, stats: { crit: 12 }, special: 'execute' },
  { id: 'blood_pact', name: '血之契約',  tier: 3, price: 55, stats: { lifesteal: 10, maxHp: -20, dmg: 15 } },
  { id: 'titan_grip', name: '巨人握把',  tier: 3, price: 57, stats: { dmg: 20, range: 12, atkSpd: -10 } },
  { id: 'spike_armor', name: '尖刺護甲', tier: 3, price: 54, stats: { armor: 6 }, special: 'thorns' },
  { id: 'harvest_drum', name: '收成鼓',  tier: 3, price: 52, stats: { harvest: 8, luck: 10 } },
  { id: 'second_wind', name: '二段呼吸', tier: 3, price: 56, stats: { regen: 6, maxHp: 15 } },

  { id: 'demon_arm', name: '鬼腕',       tier: 4, price: 105, stats: { dmg: 45, atkSpd: 15, maxHp: -30 } },
  { id: 'unbreakable', name: '不壞之身', tier: 4, price: 110, stats: { armor: 14, maxHp: 45, speed: -10 } },
  { id: 'flash_step', name: '縮地',      tier: 4, price: 108, stats: { speed: 25, dodge: 15 }, special: 'dashHit' },
  { id: 'blood_moon', name: '血月',      tier: 4, price: 112, stats: { lifesteal: 15, dmg: 15 } },
  { id: 'zen_stone',  name: '禪石',      tier: 4, price: 106, stats: { block: 25, armor: 5 }, special: 'reflect' },
  { id: 'godspeed',   name: '神速',      tier: 4, price: 115, stats: { atkSpd: 40, dmg: -10 } },
  { id: 'crown',      name: '王者之證',  tier: 4, price: 120, stats: { dmg: 20, maxHp: 20, crit: 10, harvest: 5 } },
];
const ITEM_MAP = {};
ITEMS.forEach(i => ITEM_MAP[i.id] = i);

/* 道具說明文字（由 stats 與 special 自動組出，special 需要人話補充） */
const SPECIAL_DESC = {
  magnet: '素材吸取範圍大幅提升。',
  lastStand: '生命低於 25% 時護甲 +10。',
  lowHpDmg: '每失去 10% 生命，傷害額外 +6%。',
  comboBoost: '連續命中同一目標時，每段 +5% 傷害（最多五段）。',
  execute: '對生命低於 20% 的敵人傷害翻倍。',
  thorns: '受傷時反彈 80% 傷害給攻擊者。',
  reflect: '格擋成功時完全免傷。',
  dashHit: '移動速度越快，傷害越高（每 10% 移速換 3% 傷害）。',
};

/* ---------- 敵人 ----------
   behavior：chase 直衝 / charger 蓄力衝撞 / thrower 遠程投擲 / bomber 自爆
             splitter 死後分裂 / shielder 正面免傷 / healer 治療同伴
             summoner 召喚 / spiker 接觸反傷 / boss 頭目
*/
const ENEMIES = [
  { id: 'grunt',   name: '雜兵',   behavior: 'chase',   hp: 12,  dmg: 6,  speed: 81, size: 13, color: '#8a5a4a', mat: 1, wave: 1 },
  { id: 'runner',  name: '快腿',   behavior: 'chase',   hp: 9,   dmg: 5,  speed: 125, size: 10, color: '#b9704a', mat: 1, wave: 2 },
  { id: 'brute',   name: '壯漢',   behavior: 'chase',   hp: 46,  dmg: 13, speed: 55, size: 20, color: '#6b4a3a', mat: 2, wave: 3 },
  { id: 'thrower', name: '投擲手', behavior: 'thrower', hp: 16,  dmg: 9,  speed: 62, size: 13, color: '#4a6b7a', mat: 2, wave: 3,
    keepDist: 220, shotCd: 2.1, shotSpd: 200 },
  { id: 'charger', name: '衝刺犬', behavior: 'charger', hp: 22,  dmg: 14, speed: 72, size: 14, color: '#a8563c', mat: 2, wave: 5,
    dashSpd: 330, dashCd: 2.6 },
  { id: 'spiker',  name: '刺蝟',   behavior: 'spiker',  hp: 30,  dmg: 8,  speed: 65, size: 15, color: '#7a5a8a', mat: 2, wave: 5,
    thorns: 4 },
  { id: 'bomber',  name: '自爆蟲', behavior: 'bomber',  hp: 12,  dmg: 26, speed: 101, size: 12, color: '#c9a03c', mat: 2, wave: 7,
    fuse: 0.85, blast: 78 },
  { id: 'splitter', name: '分裂體', behavior: 'splitter', hp: 34, dmg: 9, speed: 75, size: 17, color: '#5a8a6b', mat: 3, wave: 8,
    splitInto: 'splitling', splitN: 3 },
  { id: 'splitling', name: '碎片',  behavior: 'chase',   hp: 8,   dmg: 5,  speed: 120, size: 8,  color: '#5a8a6b', mat: 0, wave: 99 },
  { id: 'shielder', name: '盾兵',   behavior: 'shielder', hp: 40, dmg: 11, speed: 60, size: 16, color: '#6b7a8a', mat: 3, wave: 9,
    shieldArc: 130, shieldCut: 0.85 },
  { id: 'healer',  name: '治療師', behavior: 'healer',  hp: 26,  dmg: 4,  speed: 70, size: 13, color: '#7ac9a0', mat: 3, wave: 11,
    healCd: 2.4, healAmt: 14, healRange: 190 },
  { id: 'summoner', name: '召喚者', behavior: 'summoner', hp: 44, dmg: 8, speed: 52, size: 17, color: '#8a6bb0', mat: 4, wave: 13,
    sumCd: 4.0, sumN: 2 },
];
const ENEMY_MAP = {};
ENEMIES.forEach(e => ENEMY_MAP[e.id] = e);

const BOSSES = [
  { id: 'champ', name: '拳王', behavior: 'boss', hp: 2200, dmg: 22, speed: 58, size: 34,
    color: '#d9564f', mat: 40, phase: 'champ',
    desc: '會做出三連拳突進，拳風本身也會傷人。' },
  { id: 'yokozuna', name: '橫綱', behavior: 'boss', hp: 10000, dmg: 30, speed: 46, size: 44,
    color: '#c9576b', mat: 80, phase: 'yokozuna',
    desc: '張手震波與地面踏震，血量越低越暴躁。' },
];
const BOSS_MAP = {};
BOSSES.forEach(b => BOSS_MAP[b.id] = b);

/* ---------- 波次 / 難度 ---------- */
const MAX_WAVE = 20;
const DANGER_LEVELS = [
  { lv: 0, name: '危險 0', hp: 1.00, dmg: 1.00, count: 1.00, mat: 1.00 },
  { lv: 1, name: '危險 1', hp: 1.20, dmg: 1.10, count: 1.12, mat: 1.05 },
  { lv: 2, name: '危險 2', hp: 1.45, dmg: 1.22, count: 1.26, mat: 1.10 },
  { lv: 3, name: '危險 3', hp: 1.75, dmg: 1.35, count: 1.42, mat: 1.15 },
  { lv: 4, name: '危險 4', hp: 2.10, dmg: 1.50, count: 1.62, mat: 1.20 },
  { lv: 5, name: '危險 5', hp: 2.55, dmg: 1.68, count: 1.85, mat: 1.25 },
];

function waveDuration(w) { return 20 + (w - 1) * 1.5; }
function isBossWave(w) { return w === 10 || w === 20; }
function bossOfWave(w) { return w === 10 ? 'champ' : 'yokozuna'; }

/* 敵人成長：血量走指數、傷害走線性，避免後期一擊必殺
   指數底數是全域難度的主旋鈕；玩家整局輸出成長約 25 至 30 倍，
   所以血量成長壓在 18 倍上下才留得住build的成就感。 */
function enemyScale(wave, danger) {
  const d = DANGER_LEVELS[danger];
  return {
    hp: Math.pow(1.10, wave - 1) * d.hp,
    dmg: (1 + (wave - 1) * 0.10) * d.dmg,
    speed: 1 + (wave - 1) * 0.010,
  };
}

/* 每波生成預算：決定同時在場的壓力。
   走平方成長是刻意的——單體血量壓低、數量拉高，才有「被淹沒」的手感；
   血量與數量的乘積（整波總血量）維持在玩家該波總輸出的七成左右。 */
function waveBudget(wave, danger) {
  const d = DANGER_LEVELS[danger];
  return (14 + 3.0 * wave + 0.8 * wave * wave) * d.count;
}

/* 升級所需經驗 */
function xpNeeded(lv) { return Math.floor(4 + lv * 3 + lv * lv * 0.55); }

/* 護甲減傷：遞減曲線，永遠打不到 100% */
function armorCut(armor) {
  if (armor <= 0) return Math.max(-0.6, armor * 0.04);
  return armor / (armor + 22);
}

/* 商店價格通膨 */
function shopInflation(wave) { return 1 + (wave - 1) * 0.11; }

/* 各波可出現的道具/武器最高階級 */
function tierUnlock(wave) {
  if (wave >= 16) return 4;
  if (wave >= 10) return 3;
  if (wave >= 5) return 2;
  return 1;
}
