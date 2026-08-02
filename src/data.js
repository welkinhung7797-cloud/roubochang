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

/* ---------- 招式 ----------
   三類，對應三種行動狀態，全職業通用、商店可買可換：
   dash  衝刺技：按 Space 發動，衝刺的瞬間帶一個攻擊，有冷卻
   move  移動技：持續移動時自動生效／週期觸發
   still 站樁技：站定不動 0.5 秒後自動生效／週期觸發
   命名一律用真實武術通用詞。short 是戰鬥介面上的單字圖示。
*/
const MOVES = [
  /* ---- 衝刺技 ---- */
  { id: 'tackle', name: '擒抱衝刺', short: '擒', slot: 'dash', color: '#c2703c', cd: 8, price: 42,
    desc: '低身衝刺，擒住撞上的第一個敵人，一路扛到牆上撞碎並震盪周圍。衝刺中受傷加重六成，撞空會踉蹌。',
    dashSpd: 860, dashDur: 0.5 },
  { id: 'grab_spin', name: '迴旋抓摔', short: '抓', slot: 'dash', color: '#b07a4a', cd: 9, price: 44,
    desc: '衝刺抓住碰到的第一個敵人，當武器掄一圈半再扔出去撞牆。抓不動頭目，但能絆他一跤。',
    dashSpd: 700, dashDur: 0.24, dur: 1.5, orbitR: 64, spinSpd: 7.5 },
  { id: 'flash_step', name: '縮地', short: '縮', slot: 'dash', color: '#79d9c0', cd: 6, price: 38,
    desc: '一瞬踏到最近敵人的背後，下一擊必定爆擊，短暫加快出手。' },
  { id: 'mountain_bash', name: '鐵山靠', short: '靠', slot: 'dash', color: '#8a8f99', cd: 5, price: 34,
    desc: '短距離肩撞，把正面的敵人整排撞飛，並短暫硬化自身護甲。',
    lunge: 130 },
  { id: 'knee_dash', name: '飛膝突進', short: '膝', slot: 'dash', color: '#d97a5a', cd: 7, price: 40,
    desc: '飛身衝刺，落點一記飛膝：範圍傷害並讓命中的敵人僵直。',
    dashSpd: 830, dashDur: 0.3 },
  { id: 'drunk_roll', name: '醉步翻滾', short: '醉', slot: 'dash', color: '#d9a441', cd: 6, price: 38,
    desc: '看似跌倒的翻滾衝刺，全程無敵，滾完甩尾掃倒周圍一圈。',
    dashSpd: 850, dashDur: 0.26 },

  /* ---- 移動技 ---- */
  { id: 'cyclone_kick', name: '旋風連腿', short: '旋', slot: 'move', color: '#c9d96a', interval: 2.2, price: 38,
    desc: '持續移動時，每 2.2 秒自動掃出一圈旋風腿，腿到之處全部命中。',
    radius: 100 },
  { id: 'sway_step', name: '搖擺身法', short: '搖', slot: 'move', color: '#e0a458', price: 38,
    desc: '移動中上身不停搖擺：閃避 +18%，每閃掉一下就自動回敬一記刺拳。' },
  { id: 'gale_step', name: '疾風步', short: '疾', slot: 'move', color: '#8fd4e0', price: 36,
    desc: '越跑越快的手：持續移動時攻擊速度最多 +30%，一停下就歸零。' },
  { id: 'tail_wake', name: '曳尾勁', short: '尾', slot: 'move', color: '#8fa89a', interval: 0.45, price: 36,
    desc: '奔跑時尾巴甩出氣勁，持續掃傷身後跟著的敵人。回頭路就是攻擊路。' },
  { id: 'phantom_press', name: '威壓步', short: '壓', slot: 'move', color: '#c9576b', price: 40,
    desc: '移動時周身帶著壓迫氣場：碰到的敵人持續受傷並被推開。' },

  /* ---- 站樁技 ---- */
  { id: 'counter_stance', name: '化勁架式', short: '化', slot: 'still', color: '#5a8ac9', price: 45,
    desc: '站定後自動進入架式：挨打化為零並把攻擊者過肩摔到身後砸傷別人（每 1.2 秒最多化解一次）。' },
  { id: 'iron_bell', name: '金鐘罩', short: '罩', slot: 'still', color: '#d9b06a', price: 42,
    desc: '站定後運氣：護甲 +20，打你的人被氣勁反震八成傷害。' },
  { id: 'quake_pulse', name: '震腳', short: '震', slot: 'still', color: '#8c6239', interval: 2.6, price: 40,
    desc: '站定後每 2.6 秒踏地一次，震波掀翻周圍敵人並定身。',
    radius: 125 },
  { id: 'focus_strike', name: '寸勁蓄力', short: '蓄', slot: 'still', color: '#e8964a', price: 40,
    desc: '站定時凝聚勁力：每 0.6 秒下一次武器攻擊 +25% 傷害，最多疊到 +150%，出手就釋放。' },
  { id: 'palm_flurry', name: '千手張打', short: '掌', slot: 'still', color: '#e8d8b0', interval: 3.0, price: 38,
    desc: '站定後每 3 秒自動朝最近的敵群連推三掌，把人群推開。' },
  { id: 'breath_heal', name: '吐納', short: '吐', slot: 'still', color: '#77c47f', price: 42,
    desc: '站定後調息：每秒回復最大生命的 1.2%。站著不動就是在練功。' },
];
const MOVE_MAP = {};
MOVES.forEach(m => MOVE_MAP[m.id] = m);
function moveDef(id) { return MOVE_MAP[id]; }
function movesBySlot(slot) { return MOVES.filter(m => m.slot === slot); }
const SLOT_NAME = { dash: '衝刺技', move: '移動技', still: '站樁技' };
const SLOT_KEY = { dash: 'Space 衝刺', move: '移動中自動', still: '站定時自動' };

/* ---------- 奧義 ----------
   遊戲的醍醐味：走位本身就是搓招。
   站定滿 0.7 秒記一個「站」拍、持續移動滿 0.7 秒記一個「移」拍，
   湊齊自家指令後按 Space，衝刺技會變成奧義。
   奧義綁職業（不可換），是每隻功夫貓的身份。
   seq 由畫面下方的節拍條顯示，S＝站、M＝移。
   kind 決定引擎用哪個效果模板，數值在 params。
*/
const OUGI = {
  boxer:     { name: '無影連打', seq: ['M', 'M', 'S'],
    kind: 'burst_multi', params: { hits: 10, dmg: 14, arc: 100, range: 130 },
    desc: '衝進去之後原地爆發十連拳，快到只剩殘影。' },
  wrestler:  { name: '巨螺旋墜擊', seq: ['S', 'S', 'S'],
    kind: 'grab_super', params: { spins: 3, dmg: 30 },
    desc: '擒抱衝刺的完成型：抓住敵人掄三大圈，扔出去的瞬間砸出全場震盪。' },
  karate:    { name: '一擊必倒', seq: ['S', 'S', 'S'],
    kind: 'burst_single', params: { dmg: 110 },
    desc: '縮地貼身，正拳灌進要害。一擊，必倒。' },
  kenshi:    { name: '拔刀燕返', seq: ['S', 'S', 'M'],
    kind: 'line_pierce', params: { dmg: 45, width: 70, len: 520 },
    desc: '瞬身掠過一直線，刀光過處全部挨一斬，收刀才聽見聲音。' },
  judo:      { name: '巴投連環', seq: ['M', 'S', 'M'],
    kind: 'throw_chain', params: { count: 5, dmg: 35 },
    desc: '連續過肩摔周圍最多五個敵人，一個接一個砸在地上。' },
  sumo:      { name: '橫綱張手', seq: ['S', 'S', 'M'],
    kind: 'aoe_push', params: { dmg: 40, radius: 220, knock: 420 },
    desc: '雙掌齊出的超大張手，把整個場面推回去，撞牆的另外再痛一次。' },
  muaythai:  { name: '箍頸膝蓮', seq: ['M', 'M', 'S'],
    kind: 'throw_chain', params: { count: 1, dmg: 22, hits: 6 },
    desc: '箍住最近敵人的頸，六連膝直到放手。' },
  monk:      { name: '百八掌', seq: ['S', 'S', 'S'],
    kind: 'burst_multi', params: { hits: 12, dmg: 12, arc: 360, range: 150 },
    desc: '周身開掌，每個方向都是掌影，數不清就對了。' },
  ninja:     { name: '分身亂舞', seq: ['M', 'M', 'M'],
    kind: 'rush_multi', params: { count: 6, dmg: 40 },
    desc: '殘影同時出現在六個敵人背後，全部斬完才落地。' },
  thug:      { name: '垃圾場亂鬥', seq: ['M', 'S', 'M'],
    kind: 'burst_multi', params: { hits: 8, dmg: 15, arc: 360, range: 140, loot: true },
    desc: '沒有章法的一頓亂毆，打完地上多了一堆素材。' },
  nunchaku:  { name: '旋棍風暴', seq: ['M', 'M', 'S'],
    kind: 'spin_storm', params: { dur: 2.0, dmg: 8, radius: 120 },
    desc: '雙節棍轉成一圈風暴，靠近的都被捲進去。' },
  ironhead:  { name: '隕石頭槌', seq: ['S', 'M', 'M'],
    kind: 'line_pierce', params: { dmg: 55, width: 90, len: 640 },
    desc: '頭最硬的貓化身砲彈，貫穿全場一直線。' },
  taichi:    { name: '大迴環', seq: ['S', 'S', 'M'],
    kind: 'vortex', params: { dmg: 30, radius: 200 },
    desc: '把周圍的敵人全部牽進圓裡，轉一圈，再一起甩出去。' },
  berserker: { name: '血祭', seq: ['M', 'M', 'M'],
    kind: 'aoe_blast', params: { dmg: 60, radius: 190, hpCost: 0.12 },
    desc: '割開自己一成二的血當祭品，換全場一次狂暴爆發。' },
  strongman: { name: '大地粉碎', seq: ['S', 'S', 'S'],
    kind: 'aoe_blast', params: { dmg: 50, radius: 230, stun: 1.5 },
    desc: '跳起、落下、大地裂開。全場定身。' },
  aikido:    { name: '圓相返技', seq: ['S', 'M', 'S'],
    kind: 'counter_field', params: { dur: 3.0 },
    desc: '三秒的完全化勁領域：期間打你的每一個敵人都會被自動摔飛。' },
};

/* ---------- 格鬥家裝備 ----------
   升級四選一給的是裝備而不是裸數字。
   效果以觸發型與條件型為主；unique=true 的整局只會出現一次。
*/
const GEAR = [
  { id: 'oni_gauntlet', name: '鬼手甲', unique: true,
    desc: '移動技與站樁技造成的傷害 +35%。' },
  { id: 'fist_wrap', name: '拳峰纏帶', unique: true,
    desc: '每次衝刺技發動後，下一次攻擊必定爆擊。' },
  { id: 'iron_jaw', name: '鐵下巴', unique: true,
    desc: '每波一次，受到致命傷時咬牙撐住，保留 1 點生命。' },
  { id: 'swift_tabi', name: '韋馱天足袋', unique: true,
    desc: '每次擊殺後，移動速度 +40% 持續 2 秒。' },
  { id: 'anchor_sandal', name: '千斤墜草鞋', unique: true,
    desc: '站定不動 0.8 秒後護甲 +8，一移動就消失。站樁流的核心。' },
  { id: 'tiger_claw', name: '虎爪套', unique: true,
    desc: '爆擊會撕裂傷口，讓敵人流血 3 秒。' },
  { id: 'rebound_belt', name: '迴力腰帶', unique: true,
    desc: '擊退 +50%，而且被打飛撞牆的敵人會受到撞擊傷害。' },
  { id: 'shura_mask', name: '修羅假面', unique: true,
    desc: '生命低於四成時，攻擊速度 +30%。' },
  { id: 'master_obi', name: '師範腰帶', unique: true,
    desc: '衝刺技冷卻 -20%。' },
  { id: 'bell_plate', name: '鳴鐘護胸', unique: true,
    desc: '被打中時發出鐘鳴震波，把周圍的敵人推開（2 秒內只響一次）。' },
  { id: 'bedrock_belt', name: '磐石之帶', unique: true,
    desc: '摔投與衝刺技傷害 +25%。' },
  { id: 'drunken_gourd', name: '醉仙葫蘆', unique: true,
    desc: '每波開始時隨機獲得一項大強化，持續整波。醉拳沒有劇本。' },
  { id: 'swallow_step', name: '燕返足', unique: true,
    desc: '閃避成功後，下一擊必定爆擊。' },
  { id: 'training_gi', name: '精進道服', unique: true,
    desc: '每撿起一份素材回復 1 點生命。苦練就是最好的補品。' },
  { id: 'hundred_knuckle', name: '百鍊指虎', unique: true,
    desc: '武器每第 4 次命中造成雙倍傷害。' },
  { id: 'immovable_sash', name: '不動金剛帶', unique: true,
    desc: '氣勢衰退速度減半，爆發時間延長 1 秒。' },
  { id: 'gale_elbowguard', name: '疾風肘甲', unique: true,
    desc: '拳類與肘膝類武器攻速 +15%。' },
  { id: 'famed_koshirae', name: '名刀拵', unique: true,
    desc: '刃類武器的爆擊倍率 +0.4。' },
  { id: 'snake_legwrap', name: '蛇形纏腿', unique: true,
    desc: '腿類武器命中時使敵人減速。' },
  { id: 'thunder_tattoo', name: '雷紋刺青', unique: true,
    desc: '衝刺技發動時，周圍爆出一圈雷勁震盪。' },
  { id: 'sand_shinguard', name: '沙袋護脛', stats: { armor: 2 },
    desc: '承受的每次傷害固定再 -1。基本功。' },
  { id: 'blood_headband', name: '血染頭帶', stats: { lifesteal: 4 },
    desc: '見血就興奮。吸血 +4%。' },
  { id: 'keen_eyepatch', name: '慧眼眼罩', stats: { crit: 8, range: -5 },
    desc: '遮住一眼反而看得更準。爆擊 +8%，攻擊範圍 -5%。' },
  { id: 'void_palmwrap', name: '破空勁纏布', stats: { range: 12, dmg: -6 },
    desc: '掌風破空。攻擊範圍 +12%，傷害 -6%。' },
];
const GEAR_MAP = {};
GEAR.forEach(g => GEAR_MAP[g.id] = g);

/* ---------- 職業 ----------
   設計原則：每個職業都有明顯的正面與負面，逼出不同 build 路線。
   special 為引擎讀取的機制旗標。moves 為預設三招（衝刺／移動／站樁）。
*/
const CHARACTERS = [
  {
    id: 'boxer', name: '拳擊手', tag: '快拳短程',
    color: '#d9564f', skin: '#e8964a',
    stats: { atkSpd: 30, crit: 8, range: -25, maxHp: -5 },
    weapon: 'jab', slots: 6,
    special: 'combo_boxer',
    moves: { dash: 'flash_step', move: 'sway_step', still: 'focus_strike' },
    desc: '出手極快但打不遠。連續命中同一個敵人時，每段追加 8% 傷害，最多五段。',
  },
  {
    id: 'wrestler', name: '摔角手', tag: '抓取控場',
    color: '#c2703c', skin: '#b07a4a',
    stats: { maxHp: 30, dmg: 15, armor: 3, speed: -10, atkSpd: -20 },
    weapon: 'suplex', slots: 6,
    special: 'grab_master',
    moves: { dash: 'tackle', move: 'phantom_press', still: 'counter_stance' },
    desc: '厚實但遲鈍。所有抓取類武器的定身時間延長 50%，抓取傷害 +25%。',
  },
  {
    id: 'karate', name: '空手道家', tag: '一擊必殺',
    color: '#e8e4dc', skin: '#ece8e0',
    stats: { crit: 15, dmg: 10, maxHp: -20, armor: -2 },
    weapon: 'reverse_punch', slots: 6,
    special: 'crit_shock',
    moves: { dash: 'mountain_bash', move: 'gale_step', still: 'focus_strike' },
    desc: '紙糊的身體，致命的拳。爆擊時對周圍 90 範圍內所有敵人追加一次半傷震盪。',
  },
  {
    id: 'kenshi', name: '劍豪', tag: '重斬慢刀',
    color: '#4f5d75', skin: '#4a4f5c',
    stats: { dmg: 30, range: 15, atkSpd: -25, maxHp: -15 },
    weapon: 'katana', slots: 6,
    special: 'iai',
    moves: { dash: 'flash_step', move: 'gale_step', still: 'focus_strike' },
    desc: '一刀勝過十拳。爆擊時觸發居合追斬，對同一目標再補一次 70% 傷害。',
  },
  {
    id: 'judo', name: '柔道家', tag: '借力打力',
    color: '#3c6ea5', skin: '#9aa2ad',
    stats: { dodge: 18, block: 12, dmg: -15, maxHp: 10 },
    weapon: 'shoulder_throw', slots: 6,
    special: 'dodge_momentum',
    moves: { dash: 'grab_spin', move: 'sway_step', still: 'counter_stance' },
    desc: '不硬碰硬。每次閃避成功立刻回復 15 點氣勢，並讓下一擊必定爆擊。',
  },
  {
    id: 'sumo', name: '相撲力士', tag: '肉山推進',
    color: '#c9576b', skin: '#e8d8b0',
    stats: { maxHp: 90, armor: 8, speed: -28, range: -15, atkSpd: -10 },
    weapon: 'harite', slots: 6,
    special: 'body_check',
    moves: { dash: 'tackle', move: 'phantom_press', still: 'palm_flurry' },
    desc: '走得慢，但撞上去就是傷害。與敵人接觸時每秒造成 12 點碰撞傷害並推開對方。',
  },
  {
    id: 'muaythai', name: '泰拳士', tag: '肘膝吸血',
    color: '#b8453c', skin: '#d9c49a',
    stats: { lifesteal: 10, atkSpd: 12, dmg: 5, armor: -3, maxHp: -10 },
    weapon: 'elbow', slots: 6,
    special: 'no_regen',
    moves: { dash: 'knee_dash', move: 'cyclone_kick', still: 'focus_strike' },
    desc: '完全不會自然回血，只能靠打人回血。吸血量額外 +50%。',
  },
  {
    id: 'monk', name: '武僧', tag: '氣勢流轉',
    color: '#c9803c', skin: '#e0a860',
    stats: { regen: 5, luck: 20, dmg: -10, maxHp: 15 },
    weapon: 'palm', slots: 6,
    special: 'fast_momentum',
    moves: { dash: 'mountain_bash', move: 'tail_wake', still: 'breath_heal' },
    desc: '氣勢累積速度加倍，爆發狀態延長 3 秒。修得慢，但氣一起來就停不下。',
  },
  {
    id: 'ninja', name: '忍者', tag: '游走亂鬥',
    color: '#33384a', skin: '#2e3340',
    stats: { speed: 28, dodge: 20, crit: 5, maxHp: -35, armor: -4 },
    weapon: 'tanto', slots: 6,
    special: 'move_haste',
    moves: { dash: 'flash_step', move: 'gale_step', still: 'focus_strike' },
    desc: '一被抓到就死。移動中每秒累積攻速，最高 +40%，停下來立刻歸零。',
  },
  {
    id: 'thug', name: '街頭混混', tag: '撿破爛致富',
    color: '#6b7a4a', skin: '#b08a50',
    stats: { harvest: 5, luck: 30, dmg: -20, maxHp: 10 },
    weapon: 'pipe', slots: 6,
    special: 'scrap_rush',
    moves: { dash: 'drunk_roll', move: 'tail_wake', still: 'palm_flurry' },
    desc: '每撿一份素材，攻速 +6% 持續 3 秒，可疊到 +60%。錢比拳頭重要。',
  },
  {
    id: 'nunchaku', name: '雙節棍手', tag: '密集連打',
    color: '#d9a441', skin: '#e0b45a',
    stats: { atkSpd: 45, range: 10, dmg: -28, maxHp: -5 },
    weapon: 'nunchaku', slots: 6,
    special: 'flurry',
    moves: { dash: 'drunk_roll', move: 'cyclone_kick', still: 'focus_strike' },
    desc: '單發很軟，但每一擊都會多打一次影子攻擊（40% 傷害）。',
  },
  {
    id: 'ironhead', name: '鐵頭功', tag: '硬碰硬',
    color: '#8a8f99', skin: '#aab2bd',
    stats: { armor: 12, block: 22, maxHp: 25, atkSpd: -28, speed: -8 },
    weapon: 'headbutt', slots: 6,
    special: 'thorns',
    moves: { dash: 'tackle', move: 'phantom_press', still: 'iron_bell' },
    desc: '受到的每次傷害都會反彈 150% 給攻擊者，格擋成功時反彈翻倍。',
  },
  {
    id: 'taichi', name: '太極', tag: '四兩撥千斤',
    color: '#5a7a6b', skin: '#8fa89a',
    stats: { block: 30, armor: 4, dmg: -12, speed: -8, maxHp: 15 },
    weapon: 'pushhand', slots: 6,
    special: 'reflect_master',
    moves: { dash: 'mountain_bash', move: 'tail_wake', still: 'counter_stance' },
    desc: '格擋成功時完全免傷，並把 250% 傷害反彈回去。',
  },
  {
    id: 'berserker', name: '狂人', tag: '殘血爆發',
    color: '#a33c3c', skin: '#c05a3c',
    stats: { dmg: 10, atkSpd: 10, lifesteal: 8, armor: -4, maxHp: 10 },
    weapon: 'cleaver', slots: 6,
    special: 'rage',
    moves: { dash: 'tackle', move: 'cyclone_kick', still: 'quake_pulse' },
    desc: '每失去 10% 生命，傷害 +10%、攻速 +5%。生命永遠不會自然回復，只能靠打人吸血。',
  },
  {
    id: 'strongman', name: '大力士', tag: '雙手極重',
    color: '#8c6239', skin: '#9a6a3c',
    stats: { dmg: 60, maxHp: 25, atkSpd: -15, speed: -12 },
    weapon: 'sledge', slots: 2,
    special: 'two_slots',
    moves: { dash: 'mountain_bash', move: 'phantom_press', still: 'quake_pulse' },
    desc: '武器欄只有 2 格，換來壓倒性的單發威力。走精不走多。',
  },
  {
    id: 'aikido', name: '合氣道師範', tag: '後發制人',
    color: '#4a6b8a', skin: '#7a90a8',
    stats: { block: 20, dodge: 12, dmg: -25, atkSpd: -10, maxHp: 5 },
    weapon: 'shoulder_throw', slots: 6,
    special: 'counter_master',
    moves: { dash: 'grab_spin', move: 'sway_step', still: 'counter_stance' },
    desc: '自己不主動出重手。借力化勁的冷卻縮短三成，摔投成功回復 5 生命且摔擊傷害加五成。',
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
  { id: 'lariat', name: '金臂勾', klass: '摔技', type: 'arc', icon: 'fist', color: '#c98a3c',
    dmg: 24, cd: 0.95, range: 99, arc: 170, knock: 250, critMult: 1.7, crit: 6, price: 22,
    desc: '整條手臂橫掃出去，把正面一整排掛在臂彎上帶飛。' },
  { id: 'powerbomb', name: '破碎落下', klass: '摔技', type: 'grab', icon: 'grab', color: '#8a5a3c',
    dmg: 50, cd: 1.7, range: 88, arc: 50, knock: 60, critMult: 1.9, crit: 6, price: 27,
    stun: 0.9, splash: 70, desc: '舉起來倒栽砸地，落點周圍的敵人一起遭殃。' },
  { id: 'meteor', name: '流星錘', klass: '軟兵', type: 'spin', icon: 'meteor', color: '#7a6bb0',
    dmg: 13, cd: 0.85, range: 215, arc: 360, knock: 80, critMult: 1.6, crit: 4, price: 26,
    desc: '鎖鏈甩出去畫大圈。全遊戲唯一打得到遠處的武器，僅此一把。' },
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
    bleed: base.bleed || 0, slow: base.slow || 0, splash: base.splash || 0,
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
  { lv: 4, name: '危險 4', hp: 2.25, dmg: 1.52, count: 1.66, mat: 1.20 },
  { lv: 5, name: '危險 5', hp: 2.80, dmg: 1.72, count: 1.92, mat: 1.25 },
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
