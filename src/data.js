/* ============================================================
   Penguin Can Fight — 資料表
   波次生存 × 自動攻擊 × 商店 build 類型，全近戰特化版
   所有數值為本專案自行重建，非引用任何既有作品數據
   ============================================================ */

/* ---------- 即時調參（F2 面板） ----------
   總監直接改數字即時試玩微調，不用等工程改版。
   值存 localStorage（penguin_tune_v1），重載後保留；「重置」回官方預設。
   模擬量測環境沒有 localStorage，永遠用官方預設——平衡數據不會被面板污染。
*/
const TUNE_DEFS = [
  { g: '玩家', k: 'playerHp',       n: '初始生命',       def: 60,    min: 10,  max: 300,  step: 5 },
  { g: '玩家', k: 'playerSpeed',    n: '移動速度',       def: 190,   min: 80,  max: 400,  step: 10 },
  { g: '玩家', k: 'playerDmgMul',   n: '傷害倍率',       def: 0.8,   min: 0.2, max: 5,    step: 0.1 },
  { g: '玩家', k: 'playerAtkSpdMul', n: '攻速倍率',      def: 1.0,   min: 0.2, max: 5,    step: 0.1 },
  { g: '玩家', k: 'playerRangeMul', n: '攻擊範圍倍率',   def: 1.0,   min: 0.3, max: 3,    step: 0.1 },
  { g: '玩家', k: 'levelHp',        n: '升級送生命',     def: 3,     min: 0,   max: 30,   step: 1 },
  { g: '玩家', k: 'levelDmg',       n: '升級送傷害%',    def: 2,     min: 0,   max: 20,   step: 1 },
  { g: '敵人', k: 'enemyHpBase',    n: '血量基礎倍率',   def: 3.0,   min: 0.5, max: 10,   step: 0.25 },
  { g: '敵人', k: 'enemyHpGrowth',  n: '血量成長指數',   def: 1.065, min: 1.0, max: 1.3,  step: 0.005 },
  { g: '敵人', k: 'enemyDmgMul',    n: '傷害倍率',       def: 1.3,   min: 0.3, max: 5,    step: 0.1 },
  { g: '敵人', k: 'enemyCountMul',  n: '數量倍率',       def: 1.0,   min: 0.3, max: 3,    step: 0.1 },
  { g: '敵人', k: 'enemySpeedMul',  n: '移速倍率',       def: 1.0,   min: 0.5, max: 2,    step: 0.05 },
  { g: '招式', k: 'dashCdMul',      n: '衝刺冷卻倍率',   def: 1.0,   min: 0.2, max: 3,    step: 0.1 },
  { g: '招式', k: 'techDmgMul',     n: '招式傷害倍率',   def: 1.0,   min: 0.2, max: 5,    step: 0.1 },
  { g: '手感', k: 'hitstopLight',   n: '輕頓幀秒',       def: 0.035, min: 0,   max: 0.15, step: 0.005 },
  { g: '手感', k: 'hitstopHeavy',   n: '重頓幀秒',       def: 0.07,  min: 0,   max: 0.3,  step: 0.01 },
  { g: '經濟', k: 'matMul',         n: '素材掉落倍率',   def: 1.0,   min: 0.3, max: 5,    step: 0.1 },
  { g: '經濟', k: 'waveDurMul',     n: '波長倍率',       def: 1.0,   min: 0.5, max: 2,    step: 0.1 },
];
const TUNE = {};
TUNE_DEFS.forEach(d => TUNE[d.k] = d.def);
(function loadTune() {
  try {
    if (typeof localStorage === 'undefined') return;
    const saved = JSON.parse(localStorage.getItem('penguin_tune_v1') || '{}');
    for (const k in saved) if (k in TUNE && typeof saved[k] === 'number') TUNE[k] = saved[k];
  } catch (e) {}
})();

/* 職業覆寫（F2 面板的職業調整存這裡，啟動時蓋回 CHARACTERS） */
function loadCharTune() {
  try {
    if (typeof localStorage === 'undefined') return;
    const saved = JSON.parse(localStorage.getItem('penguin_char_tune_v1') || '{}');
    for (const id in saved) {
      const ch = CHARACTERS.find(c => c.id === id);
      if (!ch) continue;
      if (saved[id].stats) ch.stats = saved[id].stats;
      if (saved[id].moves) ch.moves = saved[id].moves;
    }
  } catch (e) {}
}

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
  { id: 'tackle', name: '衝撞', short: '撞', slot: 'dash', color: '#c2703c', cd: 4, price: 42,
    desc: '低身衝刺，撞上的第一個敵人被一路推到牆上撞碎並震盪周圍。衝刺中受傷加重六成，撞空會踉蹌。',
    dashSpd: 860, dashDur: 0.5 },
  { id: 'grab_spin', name: '迴旋抓摔', short: '抓', slot: 'dash', color: '#b07a4a', cd: 4, price: 44,
    desc: '衝刺抓住碰到的第一個敵人，當武器掄一圈半再扔出去撞牆。抓不動頭目，但能絆他一跤。',
    dashSpd: 700, dashDur: 0.24, dur: 1.5, orbitR: 64, spinSpd: 7.5 },
  { id: 'flash_step', name: '縮地', short: '縮', slot: 'dash', color: '#79d9c0', cd: 4, price: 38,
    desc: '一瞬踏到最近敵人的背後，下一擊必定爆擊，短暫加快出手。' },
  { id: 'mountain_bash', name: '鐵山靠', short: '靠', slot: 'dash', color: '#8a8f99', cd: 4, price: 34,
    desc: '短距離肩撞，把正面的敵人整排撞飛，並短暫硬化自身護甲。',
    lunge: 130 },
  { id: 'knee_dash', name: '飛膝突進', short: '膝', slot: 'dash', color: '#d97a5a', cd: 4, price: 40,
    desc: '飛身衝刺，落點一記飛膝：範圍傷害並讓命中的敵人僵直。',
    dashSpd: 830, dashDur: 0.3 },
  { id: 'drunk_roll', name: '醉步翻滾', short: '醉', slot: 'dash', color: '#d9a441', cd: 4, price: 38,
    desc: '看似跌倒的翻滾衝刺，滾完甩尾掃倒周圍一圈。跌得瀟灑，但沒有無敵。',
    dashSpd: 850, dashDur: 0.26 },
  { id: 'suplex_grab', name: '擒抱', short: '擒', slot: 'dash', color: '#b07a4a', cd: 4, price: 46,
    desc: '滑行擒抱住撞到的第一個敵人。抓住之後：移動＝掄著他甩打周遭；站定＝炸彈摔砸出範圍重擊。抓不住頭目。',
    dashSpd: 800, dashDur: 0.35, holdDur: 3.5 },
  { id: 'iai_slash', name: '拔刀斬', short: '拔', slot: 'dash', color: '#4f5d75', cd: 4, price: 42,
    desc: '三段式居合：先甩刀掃前方，反手把刀水平收回鞘——整整一秒，這是居合的代價——然後瞬身到方向鍵指的位置，路徑閃過一道白光，光上的敵人在半拍之後才裂開，連中三刀。',
    dashSpd: 900, dashDur: 0.22 },
  { id: 'lunge_thrust', name: '飛込正拳', short: '突', slot: 'dash', color: '#e8e4dc', cd: 4, price: 42,
    desc: '踏進去的一記正拳，只打碰到的第一個敵人，把他釘在原地——落地後的下一拳必定爆擊。',
    dashSpd: 900, dashDur: 0.26 },
  { id: 'shadow_dash', name: '影遁', short: '影', slot: 'dash', color: '#33384a', cd: 4, price: 38,
    desc: '所有衝刺技裡距離最遠的瞬身，穿過敵人但不造成傷害。純機動——記住，衝刺沒有無敵。',
    dashSpd: 1300, dashDur: 0.4 },
  { id: 'sumo_press', name: '橫綱推壓', short: '推', slot: 'dash', color: '#c9576b', cd: 4, price: 40,
    desc: '短距離衝壓，把周遭一整圈的敵人撞飛震傷。人群管理的答案。',
    lunge: 130 },

  /* ---- 移動技 ---- */
  { id: 'cyclone_kick', name: '旋風連腿', short: '旋', slot: 'move', color: '#c9d96a', interval: 2.2, price: 38,
    desc: '持續移動時，每 2.2 秒自動掃出一圈旋風腿，腿到之處全部命中。',
    radius: 100 },
  { id: 'jodan_kick', name: '上段迴蹴', short: '蹴', slot: 'move', color: '#c9d96a', interval: 1.7, price: 40,
    desc: '移動中每 1.7 秒踢出一記上段迴旋踢，掃過面前一個扇形，踢中的人會被掀開。',
    radius: 118, arc: 150, dmg: 13, knock: 90 },
  { id: 'twin_slash', name: '二連斬', short: '連', slot: 'move', color: '#8fa8d4', interval: 1.8, price: 40,
    desc: '走位的時候刀也沒閒著：每 1.8 秒朝最近的敵人補上兩刀，一刀橫掃、一刀反手，腳步完全不用停。' },
  { id: 'lariat_run', name: '金臂勾', short: '勾', slot: 'move', color: '#c98a3c', interval: 1.6, price: 42,
    desc: '奔跑時整條手臂橫掃出去，跑得越久掛得越飛。停下來就要重新助跑。',
    radius: 108, arc: 160, dmg: 13, knock: 170, stun: 0.3 },
  { id: 'sway_step', name: '搖擺身法', short: '搖', slot: 'move', color: '#e0a458', price: 38,
    desc: '移動中上身不停搖擺：閃避 +18%，每閃掉一下就自動回敬一記刺拳。' },
  { id: 'gale_step', name: '疾風步', short: '疾', slot: 'move', color: '#8fd4e0', price: 36,
    desc: '越跑越快的手：持續移動時攻擊速度最多 +30%，一停下就歸零。' },
  { id: 'tail_wake', name: '曳尾勁', short: '尾', slot: 'move', color: '#8fa89a', interval: 0.45, price: 36,
    desc: '奔跑時尾巴甩出氣勁，持續掃傷身後跟著的敵人。回頭路就是攻擊路。' },
  { id: 'phantom_press', name: '威壓步', short: '壓', slot: 'move', color: '#c9576b', price: 40,
    desc: '移動時周身帶著壓迫氣場：碰到的敵人持續受傷並被推開。' },

  /* ---- 站樁技 ---- */
  { id: 'sanchin', name: '三戰立', short: '戰', slot: 'still', color: '#e8e4dc', tick: 0.5, max: 5, price: 44,
    desc: '站定後扎根調息，每 0.5 秒凝聚一分勁，最多五分；勁滿的那一擊必定爆擊，連周圍一起震。' },
  { id: 'triple_slash', name: '三連斬', short: '斬', slot: 'still', color: '#b8c6dc', interval: 2.6, price: 44,
    desc: '站定就進入自己的間合：每 2.6 秒踏前連斬三刀，前兩刀壓住對方的重心，第三刀袈裟直劈把人劈退。' },
  { id: 'elbow_drop', name: '肘擊墜落', short: '肘', slot: 'still', color: '#b8453c', interval: 2.2, price: 40,
    desc: '站定後每 2.2 秒騰空落下一記肘擊，砸到的人連同旁邊的一起趴下。',
    radius: 112, dmg: 17, stun: 0.7, knock: 70 },
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
/* ---------- 連段樹 ----------
   前兩拍是前綴（打中才記），第三個「動作」本身決定放哪一招——不用按 Space：
     seq 結尾 S ＝ 站定的下一次普攻打中，那一下自動變招
     seq 結尾 M ＝ 移動中的下一次普攻打中，那一下自動變招
     seq 結尾 D ＝ 按 Space 那一下，衝刺技被連段招取代
   sig: true 的是招牌招（有橫幅演出與較長冷卻）。
   沒有 COMBOS 條目的職業自動退回 OUGI 表（同一套語意）。
*/
const COMBOS = {
  /* 空手道連段樹：摔角手是位移破壞（把人搬走），空手道是定點破壞（人留原地、動的是力量）。
     三種形態＝貫通(pierce_line)／震盪擴散(shock_nova)／釘身(全招不給 launch)。
     釘身讓敵人聚成一團，聚團讓貫通線串更多人、震盪環圈更多人——這是正回饋，
     轟飛反而會把自己的收益來源打散。 */
  karate: [
    { seq: ['S', 'S', 'S'], name: '貫手', kind: 'strike_heavy',
      params: { dmg: 40, range: 140, stun: 0.4, radius: 70, cleaveMul: 0.35, lunge: 14,
        critNext: true, pose: 'jab' },
      ext: 'atemi', extName: '當身',
      desc: 'AAA：兩拳定住對手，第三下五指併攏直接貫進去。馬上按 C＝當身，插進去的那一點從裡面炸開。' },
    { seq: ['S', 'S', 'M'], name: '後迴蹴', kind: 'sweep_ring',
      params: { dmg: 22, radius: 130, knock: 240, stun: 0.35, color: '#c9d96a', img: 'fx_geri_arc' },
      ext: 'empi', extName: '肘當',
      desc: 'AAB：站穩兩拳之後踏出去，整個人轉一圈，腳背從背後掃回來。馬上按 C＝把掃攏的人用手肘一個一個頂穿。' },
    { seq: ['M', 'M', 'M'], name: '橫蹴込', kind: 'pierce_line',
      params: { dmg: 36, len: 230, width: 64, stun: 0.85, pose: 'kekomi' },
      ext: 'tobi_ushiro', extName: '飛後迴蹴',
      desc: 'BBB：跑動兩下之後側身把腳直直踹出去，一條線上的人全部被穿過去釘住。馬上按 C＝跳起來旋身把整圈掃平。' },
    { seq: ['M', 'M', 'S'], name: '鐵槌打', kind: 'strike_heavy',
      params: { dmg: 60, range: 140, stun: 1.0, radius: 100, cleaveMul: 0.5, lunge: 10,
        pose: 'tettsui', img: 'fx_kime_burst' },
      ext: 'tettsui_otoshi', extName: '鐵槌落',
      desc: 'BBA：衝過來急停扎根，拳背當鐵鎚整個人的重量砸下去，地上震開一圈。馬上按 C＝再砸一次，這次連地板一起。' },
    /* ---- C 結尾：全部零轟飛（釘身/貫通/震盪） ---- */
    { seq: ['S', 'S', 'D'], name: '極正拳', kind: 'burst_single', sig: true,
      params: { dmg: 110, critNext: true },
      desc: 'AAC：不動如山之後的那一步——全身的勁收在一個拳頭上，灌進要害。' },
    { seq: ['S', 'M', 'D'], name: '二段蹴', kind: 'burst_multi',
      params: { hits: 2, dmg: 29, arc: 90, range: 140 },
      desc: 'ABC：站定蓄好之後假意踏開一步，再借那一步跳起來，空中前踢兩腳。' },
    { seq: ['M', 'S', 'D'], name: '一本拳', kind: 'shock_nova',
      params: { dmg: 66, rings: 2, radius: 70, falloff: 0.3, critNext: true, pose: 'jab' },
      desc: 'BAC：衝過來急停站死，食指節突出的一拳點進要害，勁在他身體裡面擴開。' },
    { seq: ['M', 'M', 'D'], name: '飛蹴', kind: 'flying_kick',
      params: { dmg: 58, spd: 1150, len: 430, width: 46, pierce: 3, falloff: 0.6,
        stun: 1.0, slowPerHit: 0.8, knock: 60, pose: 'tobiushiro' },
      desc: 'BBC：跑滿兩拍之後整個人離地飛出去，腳尖過處一個一個被穿過去——但人擋得夠多，飛行會被生生擋下來。' },
    { seq: ['S', 'D'], name: '寄足突', kind: 'pierce_line',
      params: { dmg: 30, len: 150, width: 52, stun: 0.5, pose: 'jab' },
      desc: 'AC：後腳滑上半步，人跟拳一起到——最短的距離，最快的一下。' },
    { seq: ['M', 'D'], name: '前蹴', kind: 'strike_heavy',
      params: { dmg: 28, range: 130, stun: 0.6, lunge: 16, pose: 'kekomi' },
      desc: 'BC：跑動中直接抬膝把腳掌蹬出去，最基本的一腳，也是最不會落空的一腳。' },
  ],
  /* 劍豪連段樹：刀的破壞是累積的——每一刀留痕，痕滿三道就一刀兩斷，
     斷開的十字刀光還會把斬痕傳染給旁邊的人。拔刀斬的收刀窗內斬痕加倍。 */
  kenshi: [
    { seq: ['S', 'S', 'S'], name: '袈裟斬', kind: 'strike_heavy',
      params: { dmg: 45, range: 150, stun: 0.9, radius: 96, cleaveMul: 0.5, charge: 3, cuts: 2,
        img: 'fx_slash_kesa', pose: 'chop' },
      ext: 'jumonji', extName: '十文字斬',
      desc: 'AAA：站定的第三刀不再試探，刀從肩線斜劈下去，留下兩道斬痕。馬上按 C＝十文字斬。' },
    { seq: ['S', 'S', 'M'], name: '弧月斬', kind: 'sweep_ring',
      params: { dmg: 32, radius: 165, knock: 130, stun: 0.3, cuts: 1, color: '#b8c6dc', img: 'fx_slash_crescent' },
      ext: 'ninotachi', extName: '二之太刀',
      desc: 'AAB：踏出去那一步順勢把刀帶成一輪弧月，身邊一圈全部掛彩。馬上按 C＝二之太刀。' },
    { seq: ['M', 'M', 'M'], name: '橫一文字', kind: 'line_pierce',
      params: { dmg: 58, width: 70, len: 280, stun: 0.3, cuts: 1, pose: 'yokoichi' },
      ext: 'issen', extName: '一閃',
      desc: 'BBB：跑起來的那一刀不收，橫著劃過去，站在那條線上的人全都掛了彩。馬上按 C＝一閃。' },
    { seq: ['M', 'M', 'S'], name: '切落', kind: 'strike_heavy',
      params: { dmg: 66, range: 130, stun: 1.0, radius: 70, cleaveMul: 0.35, cuts: 3, pose: 'kiriotoshi', img: 'fx_slash_kesa' },
      ext: 'karatake', extName: '唐竹割',
      desc: 'BBA：衝到面前才停，腳一釘住刀就直直落下——三道斬痕直接推到引爆線。馬上按 C＝唐竹割。' },
    /* ---- C 結尾：拔刀的距離/方向/段數/延遲四軸，鋪痕組與引爆組分工 ---- */
    { seq: ['S', 'S', 'D'], name: '一足一刀', kind: 'pierce_line',
      params: { dmg: 62, len: 420, width: 48, cuts: 2, stun: 0.5, pose: 'yokoichi' },
      desc: 'AAC：他以為那個距離安全。站在原地，一步跨出去，刀就到了——人不動，只有刀到得了。' },
    { seq: ['M', 'M', 'D'], name: '切返', kind: 'charge_line',
      params: { dmg: 16, len: 240, width: 90, knock: 60, stun: 0.3, cuts: 1,
        pulses: 4, alternate: true, pose: 'yokoichi', chargeSpd: 620 },
      desc: 'BBC：刀不收回去，左一刀右一刀交互往前推——被夾在中間的人身上會多出四道痕。' },
    { seq: ['S', 'M', 'D'], name: '霞斬', kind: 'area_delayed',
      params: { dmg: 52, radius: 130, delay: 1.2, cuts: 2, severInArea: true, reach: 130, pose: 'kiriotoshi' },
      desc: 'ABC：刀已經揮過去了，那邊卻還站著。過了一會兒，那一整片才想起來自己被砍了。' },
    { seq: ['M', 'S', 'D'], name: '三段突', kind: 'multi_thrust',
      params: { dmg: 18, thrusts: 3, range: 150, cuts: 1, severOnLast: true, pose: 'yokoichi' },
      desc: 'BAC：跑到面前才煞住，刀不劈了，直直刺出去三次——第三次是為了讓前兩次算數。' },
    { seq: ['S', 'D'], name: '小手斬', kind: 'strike_heavy',
      params: { dmg: 24, range: 90, stun: 0.3, cuts: 1, slow: 1.2, pose: 'chop' },
      desc: 'AC：一拍都不用等，刀出鞘只走最短的那一段，砍手腕。他不會馬上倒，但接下來全都慢了半拍。' },
    { seq: ['M', 'D'], name: '拔胴', kind: 'charge_line',
      params: { dmg: 30, len: 200, width: 60, knock: 40, stun: 0.3, cuts: 1, pose: 'issen', chargeSpd: 760 },
      desc: 'BC：不停下來，貼著他的身側劃過去——等他轉過來，你已經在他背後了。' },
  ],
  /* 摔角手連段樹（總監 2026-08-03 定案，A=原地 B=移動 C=DASH）：
     純拍＝普通傷害、混拍變體較強；每條收尾後 0.4 秒內按 C＝延伸技（有冷卻高威力）。
     螺旋摔投退出拍序表，改掛在擒抱掄甩滿 3 秒按 C 的獎勵。 */
  wrestler: [
    { seq: ['S', 'S', 'S'], name: '頭槌', kind: 'strike_heavy',
      params: { dmg: 38, stun: 1.8, radius: 78, cleaveMul: 0.5, pose: 'head', img: 'fx_slam' },
      // 頭槌不把人頂飛，改成原地暈眩（總監 2026-08-04）：
      // 頂上去的力道是往下壓不是往外推，而且轟飛會把你自己的飯磗推走
      // （摔角手射程只有 66）。損失的位移換成定身 0.6 → 1.8 秒。
      ext: 'running_ddt', extName: '衝刺DDT',
      desc: 'AAA：兩記手刀之後站定用頭撞上去。馬上按 C＝衝向最近的人接移動 DDT。' },
    { seq: ['M', 'M', 'M'], name: '大足踢', kind: 'knock_cone',
      params: { dmg: 34, knock: 260, arc: 90, range: 128, stun: 0.7, launch: 760 },
      ext: 'clothesline', extName: '飛奔金臂勾',
      desc: 'BBB：跑動兩下手刀之後抬腿硬踢，正面的人整個被踢飛出去——撞到牆或撞到大隻的還會彈回來。馬上按 C＝再接飛奔金臂勾。' },
    { seq: ['M', 'M', 'S'], name: '德式背摔', kind: 'suplex',
      params: { dmg: 62, stun: 1.2 },
      ext: 'toss_powerbomb', extName: '拋高炸彈摔',
      desc: 'BBA：移動兩下之後站定環抱住對手，整個人向後仰把他從頭頂翻到身後。馬上按 C＝把人拋高，追上去空中接住轉炸彈摔。' },
    { seq: ['S', 'S', 'M'], name: '腰投', kind: 'hip_toss',
      params: { dmg: 55, stun: 0.9 },
      ext: 'gut_roll', extName: '抱腰翻滾',
      desc: 'AAB：站定兩下之後踏步勾住手臂，以腰為支點把人往前摔。馬上按 C＝抱著他在地上連續翻滾輾過去。' },
    /* ---- C 結尾（2 拍前綴在前：matchCombo 取最長匹配，順序只是保險） ---- */
    { seq: ['S', 'S', 'D'], name: '矛頭衝撞', kind: 'charge_line',
      params: { dmg: 72, len: 165, width: 52, knock: 0, stun: 1.6, pose: 'lariat', chargeSpd: 900, single: true },
      desc: 'AAC：壓低身體對著腹部正面撞進去，把人從腰部折成兩半帶倒——他不會飛走，會在原地被折斷。' },
    { seq: ['M', 'M', 'D'], name: '繩索反彈衝刺', kind: 'rebound_line',
      params: { out: 260, backMul: 1.35, width: 70, dmg: 34, knock: 200, stun: 0.5 },
      desc: 'BBC：衝向場邊彈回來，去程回程各輾一次——被夾在中間的人要被輾兩趟。' },
    { seq: ['S', 'M', 'D'], name: '飛踢', kind: 'knock_cone',
      params: { dmg: 62, knock: 420, arc: 60, range: 105, stun: 0.9, launch: 820, selfProne: 0.5 },
      desc: 'ABC：站定、起步、起跳，雙腳同時蹬出去——全場最大的擊退，代價是自己也摔在地上。' },
    { seq: ['M', 'S', 'D'], name: '背後擒摔', kind: 'suplex',
      params: { dmg: 68, stun: 1.4, seekRange: 220, behind: true },
      desc: 'BAC：跑過去讓他以為要正面撞，矮身繞到背後環抱住腰往後摔。' },
    { seq: ['S', 'D'], name: '肉彈壓', kind: 'dive_splash',
      params: { dmg: 26, len: 55, radius: 74, stun: 0.6, selfProne: 0.2 },
      desc: 'AC：站定往前一跳，用整個身體的重量壓上去——被壓的人原地扁掉。' },
    { seq: ['M', 'D'], name: '飛身撲壓', kind: 'dive_splash',
      params: { dmg: 30, len: 180, radius: 88, stun: 0.7, prone: true, selfProne: 0.25 },
      desc: 'BC：帶著助跑橫著飛出去撲上去，兩個人一起摔在地上。' },
  ],
};

/* 延伸技表（資料驅動；摔角手的專屬摔投走引擎硬編碼分支） */
const EXT_MOVES = {
  /* 空手道：摔角手的延伸是「把人變成道具」，空手道的延伸是「把一擊變成一個形狀」
     ——點(當身)／面(飛後迴蹴)／地(鐵槌落)／貼身(肘當)，四個形狀不重複，全部零轟飛。 */
  atemi: { name: '當身', kind: 'shock_nova', shake: 13, hitstop: 0.12, sfx: 'ougi_hit',
    params: { dmg: 88, rings: 3, radius: 90, falloff: 0.35, critNext: true, pose: 'jab' } },
  tobi_ushiro: { name: '飛後迴蹴', kind: 'sweep_ring', shake: 12, hitstop: 0.1, sfx: 'swing_leg',
    params: { dmg: 72, radius: 175, knock: 200, stun: 1.2, color: '#ffd44a', img: 'fx_geri_arc',
      pose: 'tobiushiro' } },
  tettsui_otoshi: { name: '鐵槌落', kind: 'aoe_blast', shake: 15, hitstop: 0.13, sfx: 'quake',
    params: { dmg: 85, radius: 200, stun: 1.6, pose: 'otoshi' } },
  empi: { name: '肘當', kind: 'strike_heavy', shake: 12, hitstop: 0.13, sfx: 'hit_heavy',
    params: { dmg: 90, range: 110, stun: 1.2, radius: 85, cleaveMul: 0.5,
      lunge: 26, critNext: true, pose: 'elbow' } },

  jumonji: { name: '十文字斬', kind: 'line_pierce', shake: 12, hitstop: 0.12, sfx: 'ougi_cast',
    params: { dmg: 40, width: 76, len: 480, cross: true, crossLen: 300, crossMul: 0.8,
      cuts: 2, crossCuts: 2, forceSever: true } },
  ninotachi: { name: '二之太刀', kind: 'sweep_ring', shake: 11, hitstop: 0.1, sfx: 'swing_blade',
    params: { dmg: 46, radius: 230, knock: 150, stun: 0.4, cuts: 2, severAll: true,
      color: '#e8f2ff', img: 'fx_slash_crescent' } },
  issen: { name: '一閃', kind: 'delayed_cuts', shake: 12, hitstop: 0.1, sfx: 'flash',
    params: { len: 560, width: 64, cuts: 2, delay: 0.3, dmgPerCut: 16, n: 3, blink: true, stun: 0.5, pose: 'issen' } },
  karatake: { name: '唐竹割', kind: 'execute_cut', shake: 15, hitstop: 0.14, sfx: 'swing_blade',
    params: { dmg: 88, cutsBonus: 2, pose: 'karatake' } },
};

/* 同拍共鳴／三段勁的職業版顯示名（機制共用，只換字；查無此職業就用通用名） */
const RESON_NAME = {
  karate:   { SSS: '氣合', MMM: '運足', DASH3: '連突', TRI: '殘心' },
  kenshi:   { SSS: '殘心', MMM: '流水', DASH3: '連拔', TRI: '輪斬' },
  wrestler: { SSS: '壓制', MMM: '助跑', DASH3: '連撞', TRI: '亂鬥' },
};

/* 三種行為模式的唯一詞彙表——UI 只准查這裡，不准各講各的。
   （之前站/移/衝在不同畫面有四五種叫法，玩家得自己在腦內做對照表。） */
const SLOT_UI = {
  still: { beat: '站', trig: '站定 0.5 秒自動', act: '站定時打中', full: '站樁技', color: '#e8964a' },
  move:  { beat: '移', trig: '移動中自動',     act: '移動中打中', full: '移動技', color: '#8fd4e0' },
  dash:  { beat: '衝', trig: '按 SPACE',       act: '按 SPACE',   full: '衝刺技', color: '#ffd44a' },
};
const SLOT_ORDER = ['still', 'move', 'dash'];   // 資料層仍保留三槽
// 站樁技已停用（總監 2026-08-04：站著就只是站著，不要自動造成傷害），介面只列運作中的兩槽
const SLOT_ORDER_ACTIVE = ['move', 'dash'];

const MOVE_BRIEF = {
  tackle: '把敵人推去撞牆，撞空會踉蹌',
  grab_spin: '抓住一個掄一圈半再扔出去',
  flash_step: '閃到背後，下一擊必爆擊',
  mountain_bash: '肩撞撞飛正面一排，順便硬化',
  knee_dash: '落點一記飛膝，命中會僵直',
  drunk_roll: '翻滾後甩尾掃倒一圈，沒有無敵',
  suplex_grab: '抓住後移動甩打、站定砸地',
  iai_slash: '收刀一秒，換瞬身三連斬',
  lunge_thrust: '釘住第一個，下一拳必爆擊',
  shadow_dash: '衝最遠但沒傷害，純機動',
  sumo_press: '把周圍一整圈撞飛震傷',
  cyclone_kick: '每 2.2 秒自動掃一圈旋風腿',
  jodan_kick: '每 1.7 秒踢一記，把人掀開',
  twin_slash: '每 1.8 秒朝最近敵人補兩刀',
  lariat_run: '每 1.6 秒橫掃，跑越久掛越飛',
  sway_step: '閃避 +18%，每閃掉一下回敬刺拳',
  gale_step: '跑越久攻速越快，最多 +30%',
  tail_wake: '尾巴持續掃傷身後的追兵',
  phantom_press: '碰到的敵人持續受傷並被推開',
  sanchin: '每 0.5 秒蓄一分，滿五分必爆擊',
  triple_slash: '每 2.6 秒踏前連斬三刀',
  elbow_drop: '每 2.2 秒砸一記肘擊，範圍趴下',
  counter_stance: '挨打歸零並過肩摔砸傷別人',
  iron_bell: '護甲 +20，反震八成傷害',
  quake_pulse: '每 2.6 秒震一次，掀翻並定身',
  focus_strike: '每 0.6 秒 +25% 傷害，最多 +150%',
  palm_flurry: '每 3 秒推三掌，把人群推開',
  breath_heal: '每秒回復最大生命 1.2%',
};

const MOVE_MAP = {};
MOVES.forEach(m => MOVE_MAP[m.id] = m);
function moveDef(id) { return MOVE_MAP[id]; }
function movesBySlot(slot) { return MOVES.filter(m => m.slot === slot); }
const SLOT_NAME = { dash: '衝刺技', move: '移動技', still: '站樁技' };
const SLOT_KEY = { dash: 'Space 衝刺', move: '移動中自動', still: '站定時自動' };

/* ---------- 奧義 ----------
   遊戲的醍醐味：連段是「打」出來的。
   原地打中敵人記 S 拍、移動中打中記 M 拍、衝刺技打中記 D 拍——
   光走不打不算數。湊齊自家指令後按 Space，衝刺技會變成奧義。
   另外任意湊齊 S、M、D 各一拍，會自動爆出通用小招「三段勁」。
   奧義綁職業（不可換），是每隻功夫企鵝的身份。
   seq 由畫面下方的節拍條顯示，S＝站、M＝移。
   kind 決定引擎用哪個效果模板，數值在 params。
*/
const OUGI = {
  boxer:     { name: '無影連打', seq: ['M', 'M', 'S'],
    kind: 'burst_multi', params: { hits: 10, dmg: 14, arc: 100, range: 130 },
    desc: '衝進去之後原地爆發十連拳，快到只剩殘影。' },
  wrestler:  { name: '螺旋摔投', seq: ['D', 'M', 'S'],
    kind: 'grab_super', params: { dur: 2.1, orbitR: 76, spinSpd: 9, bossDmg: 80, blastDmg: 20 },
    desc: '擒抱衝刺的完成型：抓住一個人掄成螺旋，轉三大圈之後扔出去，落點炸出一圈震盪。' },
  karate:    { name: '極正拳', seq: ['D', 'S', 'S'],
    kind: 'burst_single', params: { dmg: 110 },
    desc: '不動如山之後的那一步——全身的勁收在一個拳頭上，灌進要害。' },
  kenshi:    { name: '十文字斬', seq: ['M', 'S', 'S'],
    kind: 'line_pierce', params: { dmg: 40, width: 76, len: 480, cross: true, crossLen: 300, crossMul: 0.8 },
    desc: '先一刀貫穿整條直線衝到底，落地再反手橫掃一刀——兩道刀光在地上交成一個十字。' },
  judo:      { name: '巴投連環', seq: ['M', 'S', 'M'],
    kind: 'throw_chain', params: { count: 5, dmg: 35 },
    desc: '連續過肩摔周圍最多五個敵人，一個接一個砸在地上。' },
  sumo:      { name: '橫綱張手', seq: ['D', 'S', 'S'],
    kind: 'aoe_push', params: { dmg: 40, radius: 220, knock: 420 },
    desc: '雙掌齊出的超大張手，把整個場面推回去，撞牆的另外再痛一次。' },
  muaythai:  { name: '箍頸膝蓮', seq: ['M', 'M', 'D'],
    kind: 'throw_chain', params: { count: 1, dmg: 22, hits: 6 },
    desc: '箍住最近敵人的頸，六連膝直到放手。' },
  monk:      { name: '百八掌', seq: ['S', 'M', 'S'],
    kind: 'burst_multi', params: { hits: 12, dmg: 12, arc: 360, range: 150 },
    desc: '周身開掌，每個方向都是掌影，數不清就對了。' },
  ninja:     { name: '分身亂舞', seq: ['M', 'M', 'M'],
    kind: 'rush_multi', params: { count: 6, dmg: 40 },
    desc: '殘影同時出現在六個敵人背後，全部斬完才落地。' },
  thug:      { name: '垃圾場亂鬥', seq: ['M', 'S', 'D'],
    kind: 'burst_multi', params: { hits: 8, dmg: 15, arc: 360, range: 140, loot: true },
    desc: '沒有章法的一頓亂毆，打完地上多了一堆素材。' },
  nunchaku:  { name: '旋棍風暴', seq: ['M', 'M', 'S'],
    kind: 'spin_storm', params: { dur: 2.0, dmg: 8, radius: 120 },
    desc: '雙節棍轉成一圈風暴，靠近的都被捲進去。' },
  ironhead:  { name: '隕石頭槌', seq: ['D', 'D', 'D'],
    kind: 'line_pierce', params: { dmg: 55, width: 90, len: 640 },
    desc: '頭最硬的貓化身砲彈，貫穿全場一直線。' },
  taichi:    { name: '大迴環', seq: ['S', 'S', 'M'],
    kind: 'vortex', params: { dmg: 30, radius: 200 },
    desc: '把周圍的敵人全部牽進圓裡，轉一圈，再一起甩出去。' },
  berserker: { name: '血祭', seq: ['D', 'M', 'D'],
    kind: 'aoe_blast', params: { dmg: 60, radius: 190, hpCost: 0.12 },
    desc: '割開自己一成二的血當祭品，換全場一次狂暴爆發。' },
  strongman: { name: '大地粉碎', seq: ['S', 'S', 'D'],
    kind: 'aoe_blast', params: { dmg: 50, radius: 230, stun: 1.5 },
    desc: '跳起、落下、大地裂開。全場定身。' },
  aikido:    { name: '圓相返技', seq: ['S', 'D', 'S'],
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
    stats: { maxHp: 30, dmg: 15, armor: 3, speed: -18, range: -15, atkSpd: -25 },
    weapon: 'chop_reverse', slots: 6,
    special: 'grab_master',
    moves: { dash: 'suplex_grab', move: 'lariat_run', still: 'elbow_drop' },
    desc: '厚實但遲鈍。所有抓取類武器的定身時間延長 50%，抓取傷害 +25%。',
  },
  {
    id: 'karate', name: '空手道家', tag: '一擊必殺',
    color: '#e8e4dc', skin: '#ece8e0',
    stats: { crit: 15, dmg: 10, range: -12, maxHp: -20, armor: -2 },
    weapon: 'reverse_punch', slots: 6,
    special: 'crit_shock',
    moves: { dash: 'lunge_thrust', move: 'jodan_kick', still: 'sanchin' },
    desc: '紙糊的身體，拳腳皆兵。爆擊時對周圍 90 範圍內所有敵人追加一次半傷震盪。',
  },
  {
    id: 'kenshi', name: '劍豪', tag: '重斬慢刀',
    color: '#4f5d75', skin: '#4a4f5c',
    stats: { dmg: 30, range: 15, atkSpd: -25, maxHp: -15 },
    weapon: 'katana', slots: 6,
    special: 'iai',
    moves: { dash: 'iai_slash', move: 'twin_slash', still: 'triple_slash' },
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
    moves: { dash: 'sumo_press', move: 'phantom_press', still: 'palm_flurry' },
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
    moves: { dash: 'shadow_dash', move: 'gale_step', still: 'focus_strike' },
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
    dmg: 18, cd: 0.72, range: 102, arc: 22, knock: 135, critMult: 2.2, crit: 12, price: 16, strikeSpd: 1100,
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
  { id: 'chop_reverse', name: '逆水平手刀', klass: '摔技', type: 'arc', icon: 'palm', color: '#8fd4e0',
    dmg: 23, cd: 0.8, range: 66, arc: 120, knock: 0, critMult: 1.7, crit: 6, stun: 0.25, price: 20,
    desc: '整條手臂反手橫劈，聲音比傷害還嚇人。' },
  { id: 'lariat', name: '金臂勾', klass: '摔技', type: 'arc', icon: 'fist', color: '#c98a3c',
    dmg: 27, cd: 0.95, range: 78, arc: 170, knock: 250, critMult: 1.7, crit: 6, price: 22,
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
  { id: 'wisp', name: '狙擊鬼火', behavior: 'thrower', hp: 10, dmg: 11, speed: 60, size: 10, color: '#7ab8e0', mat: 2, wave: 6,
    keepDist: 300, shotCd: 2.6, shotSpd: 360 },
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
  { id: 'ironhead_b', name: '鐵頭王', behavior: 'boss', hp: 1100, dmg: 18, speed: 66, size: 30,
    color: '#c98a3c', mat: 26, phase: 'champ',
    desc: '第一個擋路的。頭比拳硬，衝起來不轉彎。' },
  { id: 'twinfist', name: '雙拳鬼', behavior: 'boss', hp: 4200, dmg: 26, speed: 62, size: 36,
    color: '#a06fd0', mat: 55, phase: 'champ',
    desc: '兩隻手各打各的，突進之後還有回手。' },
  { id: 'stonewall', name: '磐石', behavior: 'boss', hp: 16000, dmg: 34, speed: 40, size: 48,
    color: '#7a8a9a', mat: 100, phase: 'yokozuna',
    desc: '站著就是一堵牆。踏震範圍比橫綱更大。' },
  { id: 'thunderking', name: '雷王', behavior: 'boss', hp: 24000, dmg: 40, speed: 54, size: 46,
    color: '#e0c341', mat: 140, phase: 'yokozuna',
    desc: '最後一關。震波帶麻痺，血越低打得越快。' },
];
const BOSS_MAP = {};
BOSSES.forEach(b => BOSS_MAP[b.id] = b);

/* ---------- 波次 / 難度 ---------- */
/* 總監 2026-08-04 定案：退回 20 關。實測 30 關版本的後段（22-29 波）最低生命 98%、
   低於一半生命的時間 0.0 秒——多出來的那十關玩家是無風險走完的，只是把謝幕演出
   從 8 關拉長到 18 關，一局還變成 36 分鐘。等「剝奪型」結構驗證過再擴回去。 */
const MAX_WAVE = 20;
const DANGER_LEVELS = [
  { lv: 0, name: '危險 0', hp: 1.00, dmg: 1.00, count: 1.00, mat: 1.00 },
  { lv: 1, name: '危險 1', hp: 1.20, dmg: 1.10, count: 1.12, mat: 1.05 },
  { lv: 2, name: '危險 2', hp: 1.45, dmg: 1.22, count: 1.26, mat: 1.10 },
  { lv: 3, name: '危險 3', hp: 1.75, dmg: 1.35, count: 1.42, mat: 1.15 },
  { lv: 4, name: '危險 4', hp: 2.25, dmg: 1.52, count: 1.66, mat: 1.20 },
  { lv: 5, name: '危險 5', hp: 2.80, dmg: 1.72, count: 1.92, mat: 1.25 },
];

/* 一輪的「出兵時間」。時間到只是停止生怪，場上剩下的要殺光才過關（總監 2026-08-04 指令），
   所以實際的一輪長度＝這個數字＋清場時間，會比帳面更長。
   舊值 20 秒起跳太短，一波還沒進入狀況就結束了。 */
function waveDuration(w) { return (34 + (w - 1) * 2.6) * TUNE.waveDurMul; }
/* 每 5 關一個特殊頭目（總監 2026-08-04）。打完頭目才給特性抉擇——
   特性是會改變打法的東西，放在升級四選一裡會把那個介面撐爆，
   而升級四選一已經定案要維持樸素（一張卡一個屬性）。 */
// 20 關＝四隻頭目（5/10/15/20）。橫綱維持最終王，它的 10000 血是照 20 關調過的；
// 磐石與雷王留在 BOSSES 表裡，等 30 關模式再啟用。
const BOSS_ORDER = ['ironhead_b', 'champ', 'twinfist', 'yokozuna'];
function isBossWave(w) { return w % 5 === 0 && w <= MAX_WAVE; }
function bossOfWave(w) { return BOSS_ORDER[Math.min(BOSS_ORDER.length - 1, Math.floor(w / 5) - 1)]; }

/* ---------- 武器流派套裝 ----------
   同流派湊 2 把＝小成、湊 3 把以上＝大成。逼出「走流派」的 build 決策。
   bonus 直接疊進屬性；摔技與掌另有專屬接點（摔投傷害／擊退）。 */
const KLASS_BONUS = {
  '拳':   { name: '拳法',  s2: { atkSpd: 10 }, s3: { atkSpd: 25 } },
  '刃':   { name: '刀劍',  s2: { crit: 8 },    s3: { crit: 20 } },
  '腿':   { name: '腿功',  s2: { range: 8 },   s3: { range: 18 } },
  '棍':   { name: '棍術',  s2: { dmg: 8 },     s3: { dmg: 18 } },
  '重械': { name: '重械',  s2: { dmg: 10 },    s3: { dmg: 25 } },
  '肘膝': { name: '肘膝',  s2: { lifesteal: 3 }, s3: { lifesteal: 8 } },
  '相撲': { name: '相撲',  s2: { maxHp: 15 },  s3: { maxHp: 35 } },
  '軟兵': { name: '軟兵',  s2: { range: 10 },  s3: { range: 20 } },
  '摔技': { name: '摔投',  s2: { throwMul: 0.15 }, s3: { throwMul: 0.35 } },
  '掌':   { name: '掌勁',  s2: { knockMul: 0.30 }, s3: { knockMul: 0.60 } },
};

/* ---------- 角色解鎖 ----------
   三傑起手，其餘按順序用「累積波數」解鎖——每一局打到的波數都算進度。 */
const START_CHARS = ['karate', 'wrestler', 'kenshi'];
const UNLOCK_ORDER = ['boxer', 'sumo', 'muaythai', 'judo', 'ninja', 'taichi',
  'ironhead', 'thug', 'nunchaku', 'monk', 'berserker', 'strongman', 'aikido'];
function unlockNeed(idx) { return (idx + 1) * 8; }   // 第 N 隻要累積 8N 波

/* 敵人成長：「前期格鬥、後期割草」的成長曲線。
   基礎血量拉高 2.2 倍讓前期單怪扛得住一整套連段（有東西可以 COMBO），
   成長指數壓到 1.065——玩家 build 成型的速度遠快於此，
   後期相對輾壓，割草的爽感是「配好了」的獎勵而不是開場白。 */
function enemyScale(wave, danger) {
  const d = DANGER_LEVELS[danger];
  return {
    hp: TUNE.enemyHpBase * Math.pow(TUNE.enemyHpGrowth, wave - 1) * d.hp,
    dmg: TUNE.enemyDmgMul * (1 + (wave - 1) * 0.10) * d.dmg,
    speed: (1 + (wave - 1) * 0.010) * TUNE.enemySpeedMul,
  };
}

function isEliteWave(w) { return w === 7 || w === 13 || w === 17; }

/* 每波生成預算：決定同時在場的壓力。
   走平方成長是刻意的——單體血量壓低、數量拉高，才有「被淹沒」的手感；
   血量與數量的乘積（整波總血量）維持在玩家該波總輸出的七成左右。 */
function waveBudget(wave, danger) {
  const d = DANGER_LEVELS[danger];
  // 波長從 20+(w-1)*1.5 拉到 34+(w-1)*2.6（約 ×1.7）之後，同樣的兵力攤在 1.7 倍的時間裡，
  // 同屏密度掉到約 59%。這裡把密度乘回去、再加三成——實測那是死亡分布最健康的一組
  //（死亡散到 4～12 波、第 1～3 波零死亡）。
  //★ 反直覺但實測如此：把預算調「大」反而讓後期更安全，因為敵人多＝經驗與素材多＝玩家更強。
  //  所以增壓要靠減兵不是加兵，這裡的 1.3 是密度補償不是加難度。
  const durOld = 20 + (wave - 1) * 1.5;
  const durNew = waveDuration(wave) / TUNE.waveDurMul;
  // 總監 2026-08-04 回報「小怪生太少」。1.3 → 2.1：波長拉長後密度補償再加碼。
  //（實測加兵反而讓後期更安全，所以這是體感補償不是加難度——前段才是它真正影響的地方。）
  // 總監 2026-08-04：怪數量再變兩倍。2.1 → 4.2。
  const density = (durOld / durNew) * 4.2;
  return (14 + 3.0 * wave + 0.8 * wave * wave) * density * d.count * TUNE.enemyCountMul;
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

/* ---------- 連段盤（總監 2026-08-04 定案，見 規格/爽度軸與50波成長設計.md §9） ----------
   拍譜前綴收斂成三族 × 收尾三種 = 九格，每格是一個可以塞收尾招的插槽。
   開局只開「站站」「移移」兩排（六格），混拍那排後期解鎖——不要讓玩家一開始就苦惱招式障礙。
   收尾招從原本寫死的 COMBOS 轉出來當池子，玩家自己決定哪一招放哪一格。 */
/* 連段盤 2×2（總監 2026-08-04 二次簡化）。
   兩個定案：
   (1) 每個角色最多 4 種連段——實測十條裡有兩條吃掉 96% 的使用率，另外五到七條是 0 次，
       而且十條共用同一個 2.5 秒冷卻，本來就不是十條招，是一個招的十種外觀。
   (2) 看「站」與「移」的數量決定，不看順序——移站站站 跟 站站站 是同一條。
       這把「第三下要在 0.34 秒內放開方向鍵」那個手忙腳亂的要求整個拿掉
       （實測那是德式背摔 39 次誤觸的來源）。 */
const BOARD_ROWS = [
  { key: 'S', name: 'A', hint: '第三下站著不動打中' },
  { key: 'M', name: 'B', hint: '第三下一邊移動打中' },
];
const BOARD_COLS = [
  { key: 'H', name: '打中', act: '第三下打中就變招' },
  { key: 'D', name: 'C', act: '第三下按 SPACE' },
];
const BOARD_ROW_KEYS = BOARD_ROWS.map(r => r.key);
/* 第三下換一個狀態打中＝變體加成。同一格同一招，但獎勵你在收尾那下變一下——
   複雜度從「記十條表」變成「四招＋一個手感技巧」（沿用總監 8/3 的純拍/混拍精神）。 */
const BOARD_MIX_MUL = 1.25;
const BOARD_OFFHOME_MUL = 0.7;
/* 收尾招池：從既有連段表轉出來（params 與 kind 都是已經調過、測過的，不重寫） */
const FINISHER_POOL = {};
const FINISHER_MAP = {};
(function buildFinisherPool() {
  const PRICE = [0, 18, 30, 46, 68];
  for (const cls in COMBOS) {
    FINISHER_POOL[cls] = COMBOS[cls].map((c, i) => {
      const f = {
        id: cls + '_f' + i, cls,
        name: c.name, kind: c.kind, params: c.params,
        ext: c.ext, extName: c.extName, desc: c.desc, sig: !!c.sig,
        home: c.seq[c.seq.length - 1],   // 本命格＝它原本的收尾拍
        tier: 1, price: PRICE[1],
      };
      FINISHER_MAP[f.id] = f;
      return f;
    });
  }
})();

/* 開局盤面：把原本的三拍連段放回它原本的位置，兩拍的（實測結構性打不出來）改成池子裡的備品 */
function defaultBoard(clsId) {
  // 四格各挑一招：站多→打／站多→衝／移多→打／移多→衝。
  // 用原本連段表裡對應收尾拍的招來填，玩家原本的肌肉記憶不作廢。
  const b = {};
  const list = COMBOS[clsId] || [];
  const find = (pre, last) => {
    const i = list.findIndex(c => c.seq.length === 3 && c.seq[0] === pre && c.seq[2] === last);
    return i >= 0 ? clsId + '_f' + i : null;
  };
  b['S_H'] = find('S', 'S') || find('S', 'M');
  b['S_D'] = find('S', 'D');
  b['M_H'] = find('M', 'M') || find('M', 'S');
  b['M_D'] = find('M', 'D');
  for (const k in b) if (!b[k]) delete b[k];
  return b;
}

/* 招式池擴充（總監 2026-08-04：每職 12～15 招才有得挑又不會選擇癱瘓）。
   kind 全部沿用已經測過的，只換參數與命名——新 kind 要另外驗，這裡不冒那個險。 */
const EXTRA_FINISHERS = {
  wrestler: [
    { name: '斷頭台', kind: 'strike_heavy', home: 'S', tier: 2,
      params: { dmg: 46, stun: 1.1, radius: 70, cleaveMul: 0.4, pose: 'elbow', lunge: 14 },
      desc: '夾住脖子往下坐，體重全壓在那一點上。站定收尾的重擊型。' },
    { name: '獄門固', kind: 'strike_heavy', home: 'M', tier: 2,
      params: { dmg: 40, stun: 1.6, radius: 60, cleaveMul: 0.3, pose: 'hold', lunge: 26 },
      desc: '踏進去把手臂反鎖，定身時間特別長，適合把人釘住給下一招。' },
    { name: '衝角', kind: 'charge_line', home: 'D', tier: 2,
      params: { dmg: 52, len: 260, width: 78, knock: 120, stun: 0.7, chargeSpd: 900, pose: 'head' },
      desc: '低頭直線撞穿，撞到誰誰飛。比矛頭衝撞短，但推得更遠。' },
    { name: '鐵山靠', kind: 'knock_cone', home: 'S', tier: 3,
      params: { dmg: 58, radius: 96, arc: 150, knock: 300, launch: 520, stun: 0.5, pose: 'slam' },
      desc: '整個背撞出去，正面一片全被掀飛。' },
  ],
  karate: [
    { name: '掌底', kind: 'strike_heavy', home: 'S', tier: 2,
      params: { dmg: 44, stun: 0.9, radius: 62, cleaveMul: 0.35, pose: 'jab', lunge: 12, critNext: true },
      desc: '掌根頂上下巴，打完下一擊必爆。' },
    { name: '迴し受け', kind: 'sweep_ring', home: 'M', tier: 2,
      params: { dmg: 38, radius: 128, knock: 90, stun: 0.8, color: '#e8e4dc' },
      desc: '轉身把貼上來的人一圈撥開，不轟飛只定住。' },
    { name: '踏込突', kind: 'pierce_line', home: 'D', tier: 2,
      params: { dmg: 50, len: 240, width: 52, stun: 0.6, pose: 'kekomi' },
      desc: '踏進去一記直突，貫穿一條線上的人。' },
    { name: '正拳一閃', kind: 'burst_single', home: 'S', tier: 3,
      params: { dmg: 128 }, desc: '全身的勁收在一個拳頭上，只打一個人，但那一下很痛。' },
  ],
  kenshi: [
    { name: '逆袈裟', kind: 'sweep_ring', home: 'S', tier: 2,
      params: { dmg: 40, radius: 138, knock: 60, stun: 0.4, cuts: 1, color: '#e8f2ff' },
      desc: '由下往上反手斬，留一道斬痕。' },
    { name: '燕返', kind: 'delayed_cuts', home: 'M', tier: 2,
      params: { len: 420, width: 58, cuts: 1, delay: 0.24, dmgPerCut: 14, n: 2, stun: 0.3, pose: 'issen' },
      desc: '一刀揮出去，第二刀在同一條線上晚半拍到。' },
    { name: '刺突', kind: 'multi_thrust', home: 'D', tier: 2,
      params: { dmg: 22, n: 3, len: 190, width: 44, cuts: 1, pose: 'issen' },
      desc: '直線連刺三次，每一次都留痕。' },
    { name: '真向斬', kind: 'execute_cut', home: 'S', tier: 3,
      params: { dmg: 96, cutsBonus: 2, pose: 'karatake' },
      desc: '正上方劈下來的一刀，斬痕夠多就直接斷。' },
  ],
};
(function addExtraFinishers() {
  const PRICE = [0, 18, 30, 46, 68];
  for (const cls in EXTRA_FINISHERS) {
    EXTRA_FINISHERS[cls].forEach((e, i) => {
      const f = Object.assign({}, e, {
        id: cls + '_x' + i, cls, price: PRICE[e.tier] || 30,
      });
      FINISHER_POOL[cls].push(f);
      FINISHER_MAP[f.id] = f;
    });
  }
})();
/* 混拍那排的解鎖波次：前五波先讓玩家把兩排六格玩熟 */
const BOARD_MX_UNLOCK_WAVE = 6;

/* ---------- 特性（打完頭目三選一，總監 2026-08-04 定案） ----------
   會改變打法的東西放這裡，不放升級四選一——那個介面已經定案維持樸素。
   30 關 = 6 個頭目 = 6 次抉擇，玩家有一條講得出來的成長線。
   全部沿用引擎已經有的鉤子，不發明新機制。 */
const TRAITS = [
  { id: 'small', name: '縮骨', tag: '體型',
    desc: '體型縮小三成，移動速度 +25%。打得到的距離也跟著變短。',
    stats: { speed: 25 }, size: 0.7 },
  { id: 'big', name: '巨軀', tag: '體型',
    desc: '體型放大三成，攻擊距離 +18%、護甲 +3。移動速度 -12%。',
    stats: { range: 18, armor: 3, speed: -12 }, size: 1.3 },
  { id: 'longarm', name: '長臂', tag: '攻擊',
    desc: '攻擊距離 +25%。夠得到，就是最強的加成。',
    stats: { range: 25 } },
  { id: 'quick', name: '快手', tag: '攻擊',
    desc: '攻擊速度 +30%。',
    stats: { atkSpd: 30 } },
  { id: 'triple_dash', name: '三段身法', tag: '位移',
    desc: '衝刺可以連續使用 3 次，但冷卻拉長到 12 秒。',
    dashCharges: 3, dashCdMul: 2.0 },
  { id: 'sprint', name: '疾走', tag: '位移',
    desc: '移動速度 +100%。受到傷害後失效 6 秒。',
    sprint: { mul: 2.0, lockout: 6 } },
  { id: 'burn_stack', name: '烈火拳', tag: '狀態',
    desc: '普攻命中造成燃燒，持續傷害且可以無限累加。',
    onHit: { burn: 1 } },
  { id: 'chain_bolt', name: '雷紋', tag: '狀態',
    desc: '每隔 6 秒，下一次命中會在附近炸開連鎖閃電，造成傷害與減速。',
    proc: { every: 6, kind: 'chain', dmg: 26, jumps: 3, slow: 1.2 } },
  { id: 'dash_trail', name: '殘軌', tag: '位移',
    desc: '衝刺經過的路徑會留下軌跡，0.75 秒後爆炸。',
    dashTrail: { delay: 0.75, dmg: 34, r: 62 } },
  { id: 'stun_shield', name: '制勝', tag: '控場',
    desc: '每次把敵人定身或擒抱住，獲得一層護盾（最多 3 層）。',
    onControl: { shield: 1, max: 3 } },
  { id: 'comet', name: '流星', tag: '控場',
    desc: '定身或擒抱敵人時，召喚一顆短暫延遲後墜落的彗星。',
    onControl: { comet: { delay: 0.8, dmg: 58, r: 84 } } },
  { id: 'blood_pact', name: '血契', tag: '代價',
    desc: '最大生命 -30%，但所有傷害額外造成真實傷害。',
    stats: { maxHp: -30 }, trueDmg: 0.25 },
  { id: 'ward', name: '結界', tag: '防禦',
    desc: '每 30 秒獲得一道護盾，可以完全擋下一次傷害。',
    ward: { every: 30 } },
  { id: 'pace', name: '腳程', tag: '防禦',
    desc: '移動累積到一定距離就回復生命。走位本身變成資源。',
    paceHeal: { per: 900, hp: 6 } },
  { id: 'pulse', name: '念動', tag: '範圍',
    desc: '每 6 秒自動在周圍炸開一次念力衝擊。',
    proc: { every: 6, kind: 'nova', dmg: 32, r: 108 } },
  { id: 'reap', name: '斬返', tag: '範圍',
    desc: '每 8 秒自動放出一次大範圍斬擊，命中會回血。',
    proc: { every: 8, kind: 'reap', dmg: 40, r: 150, heal: 4 } },
];
const TRAIT_MAP = {};
TRAITS.forEach(t => TRAIT_MAP[t.id] = t);

/* ---------- 元素屬性（總監 2026-08-04） ----------
   商店道具可以帶一種元素，命中時對敵人附加狀態。
   六種各有各的用處，不是同一個減益換皮：
   雷＝硬控最短但完全停止／冰＝停久但受擊解除／火＝高傷短時可疊／毒＝低傷長時且會傳染／
   土＝壓住腳步（移速）／風＝打亂動作（攻速＋受擊退加倍）。
   ★土與風都是「緩速」，但一個讓它走不動、一個讓它打不出來——總監指定要有區別。 */
const ELEMENTS = [
  { key: 'thunder', name: '雷', color: '#ffd44a', icon: '⚡',
    brief: '麻痺 0.45 秒——完全不能動，最短但最硬的控。',
    apply: { paralyze: 0.45 }, cd: 2.2 },
  { key: 'ice', name: '冰', color: '#8fd4e0', icon: '❄',
    brief: '凍結 1.4 秒，但再被打到就碎。適合拉開距離。',
    apply: { freeze: 1.4 }, cd: 4.0 },
  { key: 'fire', name: '火', color: '#e0913c', icon: '🔥',
    brief: '燃燒：每層 4/秒、持續 3 秒，最多疊 8 層。傷害高但時間短。',
    apply: { burn: { per: 4, dur: 3, max: 8 } } },
  { key: 'poison', name: '毒', color: '#8fc47f', icon: '☠',
    brief: '中毒：每層 1.6/秒、持續 8 秒，最多疊 12 層。目標死亡時傳染給附近的人。',
    apply: { poison: { per: 1.6, dur: 8, max: 12, spread: 90 } } },
  { key: 'earth', name: '土', color: '#b08a5a', icon: '⛰',
    brief: '沉重：移動速度 -45%，持續 2.5 秒。疊到第 3 層直接定身 1 秒。',
    apply: { heavy: { mul: 0.55, dur: 2.5, stunAt: 3 } } },
  { key: 'wind', name: '風', color: '#9fd8c8', icon: '🌀',
    brief: '亂流：攻擊速度 -40%，持續 3 秒，而且受到的擊退加倍。',
    apply: { gust: { atk: 0.6, knock: 2.0, dur: 3 } } },
];
const ELEMENT_MAP = {};
ELEMENTS.forEach(e => ELEMENT_MAP[e.key] = e);
/* 帶元素的道具在商店的加價倍率——元素是行為不是數值，值得貴一點 */
const ELEMENT_PRICE_MUL = 1.45;
