/* ============================================================
   Penguin Can Fight — 遊戲引擎
   ============================================================ */

/* 音效空殼替身：瀏覽器端由 audio.js 覆寫成真實引擎；Node 模擬環境維持無聲 */
if (typeof window === 'undefined' || !window.AudioContext) {
  var sfx = function () {};
  var sfxBeat = function () {};
  var sfxComboReady = function () {};
  var bgmPlay = function () {};
  var bgmStop = function () {};
  var sfxHit = function () {};
  var sfxThrow = function () {};
  var sfxComboBreak = function () {};
  var sfxWallCrash = function () {};
  var sfxSever = function () {};
}

/* ---------- 亂數（可設種子，方便自動化測試重現） ---------- */
let _seed = (Math.random() * 1e9) | 0;
function setSeed(s) { _seed = s | 0; }
function rng() {
  _seed = (_seed * 1664525 + 1013904223) | 0;
  return ((_seed >>> 8) & 0xffffff) / 0x1000000;
}
function rnd(a, b) { return a + rng() * (b - a); }
function rndInt(a, b) { return Math.floor(rnd(a, b + 1)); }
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function chance(p) { return rng() < p; }

/* ---------- 全域狀態 ---------- */
const ARENA = { w: 1560, h: 980 };
const G = {
  mode: 'menu',           // menu | select | playing | levelup | shop | gameover | victory
  char: null,
  danger: 0,
  wave: 1,
  waveTime: 0,
  waveDur: 0,
  waveEnding: 0,          // 波末素材回收倒數
  time: 0,
  player: null,
  enemies: [],
  projectiles: [],
  pickups: [],
  fx: [],
  damageNums: [],
  materials: 0,
  totalMaterials: 0,
  xp: 0,
  level: 1,
  levelQueue: 0,
  levelChoices: null,
  shop: null,
  keys: {},
  cam: { x: 0, y: 0 },
  spawnBudget: 0,
  spawnTimer: 0,
  spawnPool: [],
  screenShake: 0,
  strikes: [],      // 實體化的攻擊：拳影／刀光／掌風，碰到敵人那一幀才結算
  hitstop: 0,       // 頓幀：命中瞬間的全場凍結（秒），打擊感的靈魂
  walls: [],        // 場地障礙牆：擋移動不擋氣勁，撞牆技的地形武器
  hazards: [],      // 地刺陷阱：敵我皆傷
  iceblocks: [],    // 可打破的冰塊：打碎噴素材
  kills: 0,
  stats: { dmgDealt: 0, dmgTaken: 0, src: {} },
  paused: false,
};

/* 傷害來源統計：平衡調整用，同時也是死因診斷 */
function noteDmg(tag, amt) {
  if (!G.stats.src) G.stats.src = {};
  G.stats.src[tag] = (G.stats.src[tag] || 0) + amt;
}

/* ---------- 玩家 ---------- */
function createPlayer(charDef) {
  const p = {
    x: ARENA.w / 2, y: ARENA.h / 2, r: 15,
    vx: 0, vy: 0, face: 1,
    hp: 0, maxHp: 0,
    perm: blankStats(),        // 職業 + 升級選擇累積
    items: [],
    weapons: [],
    slots: charDef.slots,
    stats: blankStats(),
    iframe: 0,
    regenAcc: 0,
    momentum: 0, burst: 0, hitIdle: 0,
    combo: { id: null, n: 0 },
    guaranteedCrit: false,
    moveTime: 0, scrapStacks: 0, scrapTimer: 0,
    armorBuff: 0,
    walkAnim: 0,
    dead: false,
    // 三態招式：dash＝Space、move＝移動中自動、still＝站樁自動
    moves: { dash: charDef.moves.dash, move: charDef.moves.move, still: charDef.moves.still },
    knownMoves: [...new Set(Object.values(charDef.moves))],
    dashCd: 0, pose: null,
    grabState: null, dashState: null, flurry: null,
    moveTechTimer: 0, stillTechTimer: 0, counterProcCd: 0,
    focusStacks: 0, focusT: 0, breathAcc: 0, lastMoveX: 1, lastMoveY: 0,
    flashHasteT: 0, staggerT: 0,
    // 節拍與奧義
    beatLog: [], beatT: 0, beatState: null, beatCd: 0, triCd: 0, stillHold: 0,
    burstMulti: null, rushMulti: null, kneeChain: null, ougiField: 0,
    // 裝備觸發狀態
    jawUsed: false, killHasteT: 0, stillT: 0, bellPlateCd: 0, hitCount: 0,
    waveStats: null,
  };
  p.perm.maxHp = 30;   // 全職業共同基礎值之外的起始生命由此決定
  for (const k in charDef.stats) p.perm[k] += charDef.stats[k];
  p.weapons.push(makeWeapon(charDef.weapon, 1));
  recalcStats(p);
  p.hp = p.maxHp;
  return p;
}

function BASE_HP_F() { return TUNE.playerHp; }
function BASE_SPEED_F() { return TUNE.playerSpeed; }

function recalcStats(p) {
  const s = blankStats();
  for (const k in p.perm) s[k] += p.perm[k];
  p.items.forEach(it => {
    if (!it.stats) return;
    for (const k in it.stats) s[k] += it.stats[k];
  });
  if (p.waveStats) for (const k in p.waveStats) s[k] += p.waveStats[k];
  // 特性的屬性部分（體型、長臂、快手、血契…）跟道具走同一條加總路線
  let sizeMul = 1;
  (p.traits || []).forEach(id => {
    const t = TRAIT_MAP[id];
    if (t && t.stats) for (const k in t.stats) s[k] += t.stats[k];
    if (t && t.size) sizeMul *= t.size;   // 縮骨/巨軀：體型真的變
  });
  if (p.baseR) p.r = p.baseR * sizeMul;
  // 武器流派套裝：同 klass 2 把小成、3 把大成
  const kc = {};
  p.weapons.forEach(w => kc[w.klass] = (kc[w.klass] || 0) + 1);
  p.setBonus = {};
  for (const klass in kc) {
    const kb = KLASS_BONUS[klass];
    if (!kb || kc[klass] < 2) continue;
    const tier = kc[klass] >= 3 ? kb.s3 : kb.s2;
    p.setBonus[klass] = kc[klass] >= 3 ? 3 : 2;
    for (const k in tier) {
      if (k === 'throwMul' || k === 'knockMul') continue;
      s[k] += tier[k];
    }
  }
  // 職業硬性覆寫
  const sp = G.char ? G.char.special : null;
  if (sp === 'no_regen' || sp === 'rage') s.regen = 0;   // 買再多回復道具也沒用，這是他們的代價
  s.dodge = Math.min(s.dodge, 60);
  s.block = Math.min(s.block, 75);
  s.crit = Math.min(s.crit, 100);
  p.stats = s;
  const newMax = Math.max(1, BASE_HP_F() + s.maxHp);
  const ratio = p.maxHp > 0 ? p.hp / p.maxHp : 1;
  p.maxHp = newMax;
  p.hp = Math.min(p.maxHp, Math.max(1, Math.round(newMax * ratio)));
}

function hasItem(id) { return G.player.items.some(i => i.id === id); }
function itemCount(id) { return G.player.items.filter(i => i.id === id).length; }

/* 動態加成：把暫時性效果集中在這裡，避免散落各處 */
function liveDamageMult() {
  const p = G.player, sp = G.char.special;
  let m = 1 + p.stats.dmg / 100;
  m += p.momentum / 100 * 0.30;
  if (p.burst > 0) m += 0.50;
  const missing = 1 - p.hp / p.maxHp;
  if (sp === 'rage') m += Math.floor(missing * 10) * 0.10;
  if (hasItem('berserk_mask')) m += Math.floor(missing * 10) * 0.06 * itemCount('berserk_mask');
  if (hasItem('flash_step')) m += (p.stats.speed / 10) * 0.03;
  return Math.max(0.1, m) * TUNE.playerDmgMul;
}
function liveAtkSpdMult() {
  const p = G.player, sp = G.char.special;
  let m = 1 + p.stats.atkSpd / 100;
  m += p.momentum / 100 * 0.20;
  if (sp === 'move_haste') m += Math.min(0.40, p.moveTime * 0.20);
  if (sp === 'rage') m += Math.floor((1 - p.hp / p.maxHp) * 10) * 0.05;
  if (sp === 'scrap_rush') m += Math.min(0.60, p.scrapStacks * 0.06);
  if (p.flashHasteT > 0) m += 0.30;
  if (p.moves.move === 'gale_step' && movingActive()) m += Math.min(0.30, p.moveTime * 0.30);
  if (p.flowT > 0) m += 0.10;
  if (hasItem('shura_mask') && p.hp < p.maxHp * 0.4) m += 0.30;
  return Math.max(0.2, m) * TUNE.playerAtkSpdMul;
}
function liveSpeedMult() {
  const p = G.player;
  let m = 1 + p.stats.speed / 100;
  m += p.momentum / 100 * 0.10;
  if (p.killHasteT > 0) m += 0.40;
  if (p.flowT > 0) m += 0.15;
  return Math.max(0.25, m);
}
function liveRangeMult() { return Math.max(0.4, 1 + G.player.stats.range / 100) * TUNE.playerRangeMul; }

/* ---------- 開局 ---------- */
function startRun(charId, danger) {
  const c = CHARACTERS.find(x => x.id === charId);
  G.char = c;
  G.danger = danger;
  G.wave = 1;
  // 開局給一點本錢：第一波固定只賺得到 8 素材，而商店最便宜的道具 10、武器 9——
  // 也就是「第一次進商店保證四張卡全部灰掉」。玩家第一次接觸商店就是「這東西壞了」，
  // 之後很可能整局都按 Enter 跳過。給 12 讓第一次一定買得起一件。
  G.materials = 12; G.totalMaterials = 12;
  G.xp = 0; G.level = 1; G.levelQueue = 0; G.levelChoices = null;
  G.enemies = []; G.projectiles = []; G.pickups = []; G.fx = []; G.damageNums = [];
  // 這些若不歸零會跨局殘留，讓同種子的兩局跑出不同結果，平衡量測就不可重現
  G.time = 0; G.screenShake = 0; G.paused = false; G.pendingShop = false;
  G.kills = 0; G.stats = { dmgDealt: 0, dmgTaken: 0, src: {} };
  G.player = createPlayer(c);
  // 連段盤是整局的資產（玩家買招、換格都存在這裡），不跨波重建。
  // 開局只開「站站」「移移」兩排六格且全部填滿——不要讓玩家一開始就苦惱空格。
  G.player.comboBoard = defaultBoard(charId);
  G.player.boardRows = ['S', 'M'];
  G.player.traits = []; G.player.baseR = G.player.r;
  G.traitChoices = null;
  // 擁有池：盤上的六招開局就有，其餘靠商店買。同一招只能上一格，所以要記誰在盤上。
  G.player.ownedFinishers = Object.keys(G.player.comboBoard).map(k => G.player.comboBoard[k]);
  G.shop = null;
  startWave(1);
}

function startWave(w) {
  G.wave = w;
  G.waveTime = 0;
  G.spawnClosed = false;   // 出兵時間到了沒
  G.clearT = 0;
  G.waveKills = 0; G.waveMat = 0; G.waveDmg = 0;
  G.tally = null;
  G.waveDur = waveDuration(w);
  G.waveEnding = 0;
  G.enemies = []; G.projectiles = []; G.fx = []; G.strikes = [];
  G.hitstop = 0; G.hitstopCd = 0;
  G.comboHits = 0; G.comboT = 0; G.comboBest = 0;
  G.player.x = ARENA.w / 2; G.player.y = ARENA.h / 2;
  G.player.iframe = 1.0;
  G.player.momentum = 0; G.player.burst = 0;
  // 招式與奧義狀態不跨波：波開始一律乾淨，冷卻歸零當開波紅利
  const P = G.player;
  P.grabState = null; P.dashState = null; P.flurry = null;
  P.burstMulti = null; P.rushMulti = null; P.kneeChain = null; P.ougiField = 0;
  P.beatLog = []; P.beatT = 0; P.beatState = null; P.beatCd = 0; P.triCd = 0; P.stillHold = 0;
  P.dashChain = 0; P.dashChainT = 0; P.dashBeatCounted = false; P.ougiCd = 0;
  P.comboCd = 0; P.comboFiring = false; P.comboReadyCue = false; P.beatPopT = 0; P.comboStep = 0;
  P.comboSettle = 0; P.poseAfter = null; P.pendingCombo = null; P.comboFlash = 0; P.comboBreakT = 0;
  P.extWindow = null; P.extCd = 0; P.lastComboVictim = null; P.thrustChain = null;
  G.mistCuts = [];
  P.suplexAnim = null; P.hipTossAnim = null; P.ddtState = null; P.tossState = null; P.gutRoll = null;
  G.hitstopEcho = null;
  if (P.airSlam && P.airSlam.e) { P.airSlam.e.grabbed = false; P.airSlam.e.stun = 0.5; }
  P.airSlam = null;
  P.dashCd = 0; P.moveTechTimer = 0; P.stillTechTimer = 0; P.counterProcCd = 0;
  P.focusStacks = 0; P.focusT = 0; P.breathAcc = 0;
  P.flashHasteT = 0; P.staggerT = 0; P.pose = null;
  P.iaiPhase = null; P.sheathing = 0;
  P.jawUsed = false; P.killHasteT = 0; P.stillT = 0; P.bellPlateCd = 0;
  // 醉仙葫蘆：每波隨機一項大強化
  if (hasItem('drunken_gourd')) {
    const rolls = [
      { name: '猛勁', stats: { dmg: 18 } }, { name: '疾手', stats: { atkSpd: 18 } },
      { name: '飄步', stats: { speed: 18 } }, { name: '鐵膚', stats: { armor: 6 } },
      { name: '生息', stats: { regen: 4 } }, { name: '嗜血', stats: { lifesteal: 7 } },
      { name: '銳目', stats: { crit: 12 } },
    ];
    const r = pick(rolls);
    P.waveStats = r.stats;
    P.drunkName = r.name;
  } else {
    P.waveStats = null;
  }
  recalcStats(P);
  genArena(w);
  G.spawnBudget = waveBudget(w, G.danger);
  G.spawnBudgetTotal = G.spawnBudget;
  G.spawnTimer = 0;
  G.spawnPool = ENEMIES.filter(e => e.wave <= w && e.id !== 'splitling');
  G.mode = 'playing';
  if (isBossWave(w)) spawnBoss(bossOfWave(w));
}

/* ---------- 場地：牆、地刺、冰塊 ----------
   牆擋移動不擋氣勁——撞牆技（擒抱衝刺、迴力腰帶）因此變成地形武器。
   地刺敵我皆傷；冰塊打碎噴素材。每波隨機生成，位置避開中央出生區。 */
function genArena(w) {
  G.walls = []; G.hazards = []; G.iceblocks = [];
  const cx = ARENA.w / 2, cy = ARENA.h / 2;
  const nWalls = 2 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < nWalls; i++) {
    for (let t = 0; t < 24; t++) {
      const horiz = chance(0.5);
      const len = rnd(140, 260), thick = 26;
      const x = rnd(60, ARENA.w - 60 - (horiz ? len : thick));
      const y = rnd(60, ARENA.h - 60 - (horiz ? thick : len));
      const wl = { x, y, w: horiz ? len : thick, h: horiz ? thick : len };
      const wcx = wl.x + wl.w / 2, wcy = wl.y + wl.h / 2;
      if (dist2(wcx, wcy, cx, cy) < 320 * 320) continue;   // 讓開出生區
      G.walls.push(wl);
      break;
    }
  }
  const nSpikes = w >= 3 ? (1 + (rng() < 0.4 ? 1 : 0)) : 0;
  for (let i = 0; i < nSpikes; i++) {
    for (let t = 0; t < 24; t++) {
      const x = rnd(90, ARENA.w - 90), y = rnd(90, ARENA.h - 90);
      if (dist2(x, y, cx, cy) < 300 * 300) continue;
      G.hazards.push({ x, y, r: 36, tick: 0 });
      break;
    }
  }
  const nIce = 2 + (rng() < 0.5 ? 1 : 0);
  for (let i = 0; i < nIce; i++) {
    for (let t = 0; t < 24; t++) {
      const x = rnd(80, ARENA.w - 80), y = rnd(80, ARENA.h - 80);
      if (dist2(x, y, cx, cy) < 260 * 260) continue;
      G.iceblocks.push({ x, y, r: 20, hp: 50 + w * 6, maxHp: 50 + w * 6 });
      break;
    }
  }
}

/* 圓形實體被推出牆與冰塊；回傳 true＝這一幀有撞到（給撞牆技判定用） */
function pushOutOfWalls(o) {
  let hit = false;
  for (const wl of G.walls) {
    const nx = Math.max(wl.x, Math.min(wl.x + wl.w, o.x));
    const ny = Math.max(wl.y, Math.min(wl.y + wl.h, o.y));
    const dx = o.x - nx, dy = o.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < o.r * o.r) {
      const d = Math.sqrt(d2) || 0.001;
      o.x += dx / d * (o.r - d);
      o.y += dy / d * (o.r - d);
      hit = true;
    }
  }
  for (const ib of G.iceblocks) {
    const rr = o.r + ib.r;
    const dx = o.x - ib.x, dy = o.y - ib.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2) || 0.001;
      o.x += dx / d * (rr - d);
      o.y += dy / d * (rr - d);
      hit = true;
    }
  }
  return hit;
}

function hurtIceblock(ib, dmg) {
  ib.hp -= dmg;
  spawnFx('burst', ib.x, ib.y, '#bfe8f5', 10);
  if (ib.hp <= 0) {
    ib.dead = true;
    sfx('hit_blunt', { pitch: 1.3 });
    spawnFx('explode', ib.x, ib.y, '#bfe8f5', 46);
    const n = 3 + rndInt(0, 3);
    for (let i = 0; i < n; i++) {
      G.pickups.push({ type: 'mat', value: 1, x: ib.x + rnd(-10, 10), y: ib.y + rnd(-10, 10),
        vx: rnd(-80, 80), vy: rnd(-80, 80), t: 0 });
    }
    G.iceblocks = G.iceblocks.filter(b => !b.dead);
  }
}

function updateHazards(dt) {
  const p = G.player;
  for (const hz of G.hazards) {
    hz.tick -= dt;
    if (hz.tick > 0) continue;
    let fired = false;
    // 敵我皆傷：站上去的都被扎
    if (!p.dead && p.iframe <= 0 && dist2(p.x, p.y, hz.x, hz.y) < (hz.r + p.r * 0.5) * (hz.r + p.r * 0.5)) {
      hurtPlayer(Math.max(4, p.maxHp * 0.05), null);
      fired = true;
    }
    for (const e of G.enemies) {
      if (e.dead || e.grabbed || e.thrown) continue;
      if (dist2(e.x, e.y, hz.x, hz.y) < (hz.r + e.r * 0.5) * (hz.r + e.r * 0.5)) {
        hurtEnemy(e, Math.max(3, e.maxHp * 0.04), { trueDmg: true, noLifesteal: true });
        fired = true;
      }
    }
    if (fired) hz.tick = 0.5;
  }
}

/* ---------- 敵人生成 ---------- */
function spawnPointOffscreen() {
  const p = G.player;
  for (let i = 0; i < 20; i++) {
    const a = rng() * Math.PI * 2;
    // 剛好落在畫面外緣：視野半對角線約 367，太遠會讓玩家空等
    const d = rnd(385, 470);
    const x = p.x + Math.cos(a) * d;
    const y = p.y + Math.sin(a) * d;
    if (x > 30 && x < ARENA.w - 30 && y > 30 && y < ARENA.h - 30) return { x, y };
  }
  return { x: rnd(40, ARENA.w - 40), y: rnd(40, ARENA.h - 40) };
}

function enemyCost(def) { return 1 + def.hp * 0.06 + def.dmg * 0.12; }

function spawnEnemy(defId, x, y, elite) {
  const def = ENEMY_MAP[defId] || BOSS_MAP[defId];
  const sc = enemyScale(G.wave, G.danger);
  const pos = (x !== undefined) ? { x, y } : spawnPointOffscreen();
  const eliteMul = elite ? 3.2 : 1;
  const e = {
    def, id: def.id, name: def.name, behavior: def.behavior,
    x: pos.x, y: pos.y, vx: 0, vy: 0,
    r: def.size * (elite ? 1.45 : 1),
    hp: def.hp * sc.hp * eliteMul,
    maxHp: def.hp * sc.hp * eliteMul,
    dmg: def.dmg * sc.dmg * (elite ? 1.35 : 1),
    speed: def.speed * sc.speed * (elite ? 0.88 : 1),
    color: def.color, mat: Math.round(def.mat * (elite ? 5 : 1)),
    elite: !!elite,
    stun: 0, slow: 0, bleed: 0, bleedTime: 0, dot: 0, dotTime: 0,
    hitFlash: 0, cd: 0, state: 'idle', stateT: 0,
    face: 0, anim: rng() * 6, dead: false,
    knockX: 0, knockY: 0,
  };
  G.enemies.push(e);
  return e;
}

function spawnBoss(id) {
  const def = BOSS_MAP[id];
  const sc = enemyScale(G.wave, G.danger);
  const e = spawnEnemy(id, ARENA.w / 2, 120);
  e.hp = e.maxHp = def.hp * DANGER_LEVELS[G.danger].hp * (1 + G.danger * 0.1);
  e.dmg = def.dmg * DANGER_LEVELS[G.danger].dmg;
  e.speed = def.speed;
  e.boss = true;
  e.phase = def.phase;
  e.mat = def.mat;
  G.screenShake = 14;
  return e;
}

/* 生成池加權：越新解鎖的種類越稀有，雜兵永遠是背景音，
   否則後期會變成清一色特殊敵人，玩家讀不出威脅優先序 */
function pickSpawnDef() {
  let total = 0;
  const ws = G.spawnPool.map(d => {
    const age = G.wave - d.wave;          // 解鎖多久了
    const w = d.wave === 1 ? 3.0 : Math.min(2.2, 0.55 + age * 0.16);
    total += w;
    return w;
  });
  let r = rng() * total;
  for (let i = 0; i < G.spawnPool.length; i++) {
    r -= ws[i];
    if (r <= 0) return G.spawnPool[i];
  }
  return G.spawnPool[0];
}

function updateSpawning(dt) {
  if (G.waveEnding > 0) return;
  if (G.spawnBudget <= 0) return;
  G.spawnTimer -= dt;
  if (G.spawnTimer > 0) return;

  const groupN = rndInt(1, Math.min(4, 1 + Math.floor(G.wave / 5)));
  const base = spawnPointOffscreen();
  let spent = 0;
  for (let i = 0; i < groupN && G.spawnBudget > 0; i++) {
    const def = pickSpawnDef();
    const elite = G.wave >= 6 && chance(isEliteWave(G.wave) ? 0.28 : 0.035 + G.wave * 0.004);
    const ang = rng() * Math.PI * 2, dd = rnd(0, 60);
    spawnEnemy(def.id, base.x + Math.cos(ang) * dd, base.y + Math.sin(ang) * dd, elite);
    const c = enemyCost(def) * (elite ? 3 : 1);
    G.spawnBudget -= c;
    spent += c;
  }
  // 把預算平均攤在整波的前 78%，避免開場一次倒光、後半空場
  const spendRate = G.spawnBudgetTotal / (G.waveDur * 0.78);
  G.spawnTimer = Math.max(0.3, Math.min(2.6, spent / spendRate)) * rnd(0.75, 1.25);
}

/* ---------- 傷害 ---------- */
function addDmgNum(x, y, text, color, big) {
  G.damageNums.push({ x, y, text, color, big: !!big, t: 0, vy: -34 - rng() * 16, vx: rnd(-18, 18) });
  if (G.damageNums.length > 90) G.damageNums.shift();
}

function hurtEnemy(e, amount, opts) {
  opts = opts || {};
  if (e.dead) return 0;
  let dmg = amount;
  if (hasItem('exec_blade') && e.hp / e.maxHp < 0.20) dmg *= 2;
  if (e.behavior === 'shielder' && opts.fromAngle !== undefined && !opts.trueDmg) {
    const toPlayer = Math.atan2(G.player.y - e.y, G.player.x - e.x);
    let diff = Math.abs(angDiff(opts.fromAngle, toPlayer));
    if (diff < (e.def.shieldArc * Math.PI / 180) / 2) dmg *= (1 - e.def.shieldCut);
  }
  e.hp -= dmg;
  e.hitFlash = 0.12;
  // 打擊感：壓扁回彈＋火花＋頓幀分級（微量持續傷不觸發）
  if (dmg >= 3) {
    G.screenShake = Math.max(G.screenShake, Math.min(9, 1 + dmg * 0.12));
    G.comboHits = (G.comboHits || 0) + 1;
    if (G.comboHits > (G.comboBest || 0)) G.comboBest = G.comboHits;
    G.comboT = 2;
    G.comboPop = 0.18;
    e.hitSquash = 0.16;
    spawnFx('spark', e.x, e.y, opts.crit ? '#ffd44a' : '#ffffff', e.r,
      { angle: opts.fromAngle !== undefined ? opts.fromAngle : rng() * Math.PI * 2 });
    const heavy = opts.crit || dmg >= e.maxHp * 0.3;
    addHitstop(heavy ? TUNE.hitstopHeavy : TUNE.hitstopLight, heavy);
  }
  G.stats.dmgDealt += dmg;
  addDmgNum(e.x, e.y - e.r, Math.round(dmg).toString(), opts.crit ? '#ffd44a' : '#ffffff', opts.crit);

  // 玩家吸血
  const p = G.player;
  let ls = p.stats.lifesteal / 100;
  if (opts.weaponLifesteal) ls += opts.weaponLifesteal / 100;
  if (G.char.special === 'no_regen') ls *= 1.5;
  if (ls > 0 && !opts.noLifesteal) healPlayer(dmg * ls);

  if (e.hp <= 0) killEnemy(e);
  return dmg;
}

function killEnemy(e) {
  if (e.dead) return;
  e.dead = true;
  G.kills++;
  G.waveKills = (G.waveKills || 0) + 1;
  addHitstop(e.elite || e.boss ? 0.10 : 0.05, true);
  if (hasItem('swift_tabi')) G.player.killHasteT = 2;
  G.screenShake = Math.max(G.screenShake, e.boss ? 20 : (e.elite ? 6 : 2));
  spawnFx('burst', e.x, e.y, e.color, e.r);
  // 掉素材
  const luck = 1 + G.player.stats.luck / 200;
  let n = e.mat;
  if (n > 0) {
    // 素材收入要跟得上商店通膨（每波 +11%），否則後期買不起東西
    n = Math.max(1, Math.round(n * DANGER_LEVELS[G.danger].mat * (1 + G.wave * 0.05) * TUNE.matMul));
    for (let i = 0; i < Math.min(n, 14); i++) {
      const val = i === 13 ? n - 13 : 1;
      G.pickups.push({
        type: 'mat', value: val,
        x: e.x + rnd(-14, 14), y: e.y + rnd(-14, 14),
        vx: rnd(-70, 70), vy: rnd(-70, 70), t: 0,
      });
    }
  }
  // 寶箱
  if (chance((0.012 + G.wave * 0.0015) * luck) || e.boss) {
    G.pickups.push({ type: 'crate', x: e.x, y: e.y, vx: 0, vy: 0, t: 0 });
  }
  // 回血包
  if (chance(0.035 * luck)) {
    G.pickups.push({ type: 'heal', x: e.x, y: e.y, vx: rnd(-40, 40), vy: rnd(-40, 40), t: 0 });
  }
  if (e.behavior === 'splitter') {
    for (let i = 0; i < e.def.splitN; i++) {
      const a = (i / e.def.splitN) * Math.PI * 2;
      const c = spawnEnemy(e.def.splitInto, e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18);
      c.vx = Math.cos(a) * 120; c.vy = Math.sin(a) * 120;
    }
  }
  if (e.boss) {
    // 頭目死亡＝直接結束該波
    G.spawnBudget = 0;
    G.waveEnding = Math.max(G.waveEnding, 1.6);
  }
}

function healPlayer(amount) {
  const p = G.player;
  if (p.hp >= p.maxHp) return;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  const gain = p.hp - before;
  if (gain >= 1) addDmgNum(p.x, p.y - 26, '+' + Math.round(gain), '#6fbf73');
}

function hurtPlayer(amount, source) {
  const p = G.player;
  if (p.iframe > 0 || p.dead) return;
  // 疾走：挨打就失效 6 秒
  const _spT = traitOf('sprint');
  if (_spT) p.sprintLock = _spT.sprint.lockout;
  // 結界：完全擋下一次
  if (p.wardUp) { p.wardUp = false; p.iframe = 0.4; addDmgNum(p.x, p.y - 30, '結界擋下', '#8fd4e0'); spawnFx('shock', p.x, p.y, '#8fd4e0', 60); return; }
  // 制勝：控場累積的護盾
  if ((p.traitShield || 0) > 0) { p.traitShield--; p.iframe = 0.3; addDmgNum(p.x, p.y - 30, '護盾', '#8fb0d9'); return; }
  const sp = G.char.special;

  // 化勁：奧義領域全化、化勁架式站樁時每 1.2 秒化一次
  const counterField = p.ougiField > 0;
  const counterStance = p.moves.still === 'counter_stance' && stillActive() && p.counterProcCd <= 0;
  if (counterField || counterStance) {
    if (!counterField) p.counterProcCd = 1.2;
    addBeat('S');
    addDmgNum(p.x, p.y - 30, '化勁', '#5a8ac9');
    sfx('throw_hit');
    if (sp === 'counter_master') healPlayer(5);
    if (source && !source.dead && source.name) {
      if (source.boss) {
        hurtEnemy(source, throwDmg(20), { trueDmg: true });
        source.stun = Math.max(source.stun || 0, 0.5);
      } else {
        // 摔到玩家背後，落地砸傷周圍
        const a = Math.atan2(source.y - p.y, source.x - p.x) + Math.PI;
        source.x = Math.max(source.r, Math.min(ARENA.w - source.r, p.x + Math.cos(a) * 90));
        source.y = Math.max(source.r, Math.min(ARENA.h - source.r, p.y + Math.sin(a) * 90));
        hurtEnemy(source, throwDmg(18), { trueDmg: true });
        if (!source.dead) source.stun = Math.max(source.stun, 1.2);
        spawnFx('shock', source.x, source.y, '#5a8ac9', 80);
        for (const o of G.enemies) {
          if (o.dead || o === source) continue;
          if (dist2(o.x, o.y, source.x, source.y) < 80 * 80) {
            hurtEnemy(o, throwDmg(9), { trueDmg: true });
          }
        }
      }
    }
    p.iframe = 0.2;
    return;
  }

  // 閃避（搖擺身法：移動中 +18%，閃掉就回敬刺拳）
  const swaying = p.moves.move === 'sway_step' && movingActive();
  const dodgeBonus = swaying ? 18 : 0;
  if (rng() * 100 < Math.min(75, p.stats.dodge + dodgeBonus)) {
    addDmgNum(p.x, p.y - 30, '閃避', '#79d9c0');
    if (sp === 'dodge_momentum') { addMomentum(15); p.guaranteedCrit = true; }
    if (hasItem('swallow_step')) p.guaranteedCrit = true;
    if (swaying && source && !source.dead && source.name) {
      hurtEnemy(source, autoDmg(12), { crit: chance(0.3) });
      addBeat('M');
    }
    p.iframe = 0.25;
    return;
  }

  let dmg = amount;
  let blocked = false;
  if (rng() * 100 < p.stats.block) {
    blocked = true;
    const fullImmune = (sp === 'reflect_master') || hasItem('zen_stone');
    dmg = fullImmune ? 0 : dmg * 0.5;
    addDmgNum(p.x, p.y - 30, fullImmune ? '完全格擋' : '格擋', '#8fb0d9');
    let reflect = 0;
    if (sp === 'reflect_master') reflect = 2.5;
    else if (sp === 'thorns') reflect = 3.0;
    if (reflect > 0 && source && !source.dead) {
      hurtEnemy(source, amount * reflect, { trueDmg: true, noLifesteal: true });
    }
  }

  if (p.dashState && p.dashState.risk) dmg *= 1.6;   // 擒抱衝刺的風險
  const stillArmor = (hasItem('anchor_sandal') && p.stillT > 0.8) ? 8 : 0;
  const bellArmor = (p.moves.still === 'iron_bell' && stillActive()) ? 20 : 0;
  dmg *= (1 - armorCut(p.stats.armor + p.armorBuff + stillArmor + bellArmor));
  if (hasItem('sand_shinguard')) dmg -= itemCount('sand_shinguard');
  dmg = Math.max(0, dmg);

  // 反傷
  let thornMul = 0;
  if (sp === 'thorns' && !blocked) thornMul += 1.5;
  if (hasItem('spike_armor')) thornMul += 0.8 * itemCount('spike_armor');
  if (p.moves.still === 'iron_bell' && stillActive()) thornMul += 0.8;   // 金鐘罩氣勁反震
  if (thornMul > 0 && source && !source.dead) {
    hurtEnemy(source, amount * thornMul, { trueDmg: true, noLifesteal: true });
  }

  if (dmg > 0) {
    p.hp -= dmg;
    G.stats.dmgTaken += dmg;
    noteDmg(source && source.name ? source.name : '其他', dmg);
    sfx('hit_blunt', { pitch: 0.75, vol: 0.7 });
    p.hurtT = 0.3;   // 受擊動畫幀
    G.comboHits = 0; G.comboT = 0;   // 挨打斷 HITS 計數
    // 註：挨打不斷連段拍譜。這是自動戰鬥、玩家沒有防禦手段，挨打是常態；
    // 而且合氣道這類「借力打力」流派本來就靠挨打累積拍，斷了等於廢掉他的核心迴圈
    // （實測通關率從 100% 崩到 63%）。連段只由「停手 2.5 秒」中斷，那才是玩家控制得了的。
    addDmgNum(p.x, p.y - 18, '-' + Math.round(dmg), '#ff6b6b', true);
    G.screenShake = Math.max(G.screenShake, 5 + dmg * 0.25);
    spawnFx('hurt', p.x, p.y, '#ff6b6b', 20);
    // 鳴鐘護胸：挨打就震
    if (hasItem('bell_plate') && p.bellPlateCd <= 0) {
      p.bellPlateCd = 2;
      spawnFx('shock', p.x, p.y, '#d9b06a', 110);
      G.enemies.forEach(e => {
        if (e.dead) return;
        if (dist2(e.x, e.y, p.x, p.y) < 110 * 110) {
          const a = Math.atan2(e.y - p.y, e.x - p.x);
          const kb = e.boss ? 40 : 240;
          e.knockX += Math.cos(a) * kb; e.knockY += Math.sin(a) * kb;
        }
      });
    }
  }
  p.iframe = 0.5;
  if (p.hp <= 0) {
    // 鐵下巴：每波一次免死
    if (hasItem('iron_jaw') && !p.jawUsed) {
      p.jawUsed = true;
      p.hp = 1;
      p.iframe = 1.2;
      addDmgNum(p.x, p.y - 34, '咬牙撐住', '#e0c341', true);
      spawnFx('burst_start', p.x, p.y, '#e0c341', 44);
      return;
    }
    p.hp = 0; p.dead = true;
    G.mode = 'gameover';
    onRunEnd(false);
  }
}

function addMomentum(n) {
  const p = G.player;
  if (p.burst > 0) return;
  if (G.char.special === 'fast_momentum') n *= 2;
  p.momentum = Math.min(100, p.momentum + n);
  p.hitIdle = 0;
  if (p.momentum >= 100) {
    p.burst = (G.char.special === 'fast_momentum' ? 8 : 5) + (hasItem('immovable_sash') ? 1 : 0);
    p.momentum = 100;
    G.screenShake = Math.max(G.screenShake, 8);
    spawnFx('burst_start', p.x, p.y, '#ffd44a', 60);
  }
}

/* ============================================================
   絕技系統
   任何職業都能裝任何絕技（最多兩招），Space／E 施放。
   傷害統一乘 liveDamageMult 與波次係數 techWaveScale，
   讓絕技整局都有存在感而不是前期玩具。
   ============================================================ */
function techWaveScale() { return 1 + (G.wave - 1) * 0.08; }
function techDmg(base) {
  if (G.__comboDmgMul) return techDmgRaw(base) * G.__comboDmgMul;
  return techDmgRaw(base);
}
function techDmgRaw(base) { return base * liveDamageMult() * techWaveScale() * TUNE.techDmgMul; }
function grabMaster() { return G.char.special === 'grab_master'; }

/* 統一的「摔投傷害」入口：摔角手與合氣道師範的加成都收在這 */
function throwDmg(base) {
  let m = 1;
  const p = G.player;
  if (p.setBonus && p.setBonus['摔技']) m *= 1 + KLASS_BONUS['摔技'][p.setBonus['摔技'] >= 3 ? 's3' : 's2'].throwMul;
  if (grabMaster()) m *= 1.25;
  if (G.char.special === 'counter_master') m *= 1.5;
  if (hasItem('bedrock_belt')) m *= 1.25;
  return techDmg(base) * m;
}

/* ---------- 三態招式 ----------
   衝刺技＝Space 主動；移動技＝持續移動自動；站樁技＝站定 0.5 秒自動。
*/
/* 蓄好待發：招蓄滿但範圍內沒目標 → 扣住（計時器停在滿格），有人進圈立刻放。
   對空氣出招＝把演出的份量花在沒有意義的地方（總監明令禁止）。 */
function holdOrFire(timerKey, def, range) {
  const p = G.player;
  if (!nearestEnemy(p.x, p.y, range * 1.8)) {
    p[timerKey] = def.interval;   // 扣住：保持蓄滿
    return false;
  }
  p[timerKey] = 0;
  return true;
}

function stillActive() {
  const p = G.player;
  return p.stillT > 0.5 && !p.dashState && !p.grabState && !p.airSlam && !p.dead;
}
function movingActive() {
  const p = G.player;
  return p.moveTime > 0.15 && !p.dashState && !p.grabState && !p.airSlam && !p.dead;
}
/* 自動招式（移動技／站樁技）的傷害入口：鬼手甲加成收在這 */
function autoDmg(base) {
  return techDmg(base) * (hasItem('oni_gauntlet') ? 1.35 : 1);
}

function castDash() {
  const p = G.player;
  if (p.dead) return false;
  if (p.airSlam) { p.airSlam.slam = true; return true; }   // 扛跑中再按一次＝跳起來砸下去
  // 延伸窗口：窗內的 C＝延伸技，不看也不消耗衝刺冷卻（連段已付過成本）
  if (p.extWindow) {
    if (p.extWindow.delay > 0) {
      if (p.extWindow.delay <= 0.12) { p.extWindow.buffered = true; return true; }   // 輸入緩衝
    } else if (p.extWindow.t > 0) {
      const ew = p.extWindow;
      p.extWindow = null;
      return castExtension(ew.move, ew.victim);
    }
  }
  // 掄甩滿三秒的獎勵（總監定案）：這一下 C＝螺旋摔投
  if (p.grabState && p.grabState.mode === 'hold' && p.grabState.t >= 3.0) return castSpiralToss();
  if (p.grabState || p.dashState || p.staggerT > 0 || p.burstMulti || p.rushMulti || p.kneeChain ||
      p.suplexAnim || p.hipTossAnim || p.ddtState || p.tossState || p.gutRoll) return false;
  const id = p.moves.dash;
  const d = MOVE_MAP[id];

  // 連段判定：前綴湊齊時，這一下 Space 放的是連段招而不是衝刺技。
  // 連段招不是衝刺，不吃衝刺冷卻。
  const cd = matchCombo('D');
  if (cd) {
    const okC = castCombo(cd);
    if (okC) {
      p.dashCd = Math.max(p.dashCd, d.cd * 0.8 * TUNE.dashCdMul * (hasItem('master_obi') ? 0.8 : 1));
      return true;
    }
  }
  if (p.dashCd > 0) return false;

  // 通用節拍加成：站拍＝這次衝刺傷害 +25%／拍，移拍＝冷卻 -15%／拍
  const stillBeats = p.beatLog.filter(b => b === 'S').length;
  const moveBeats = p.beatLog.filter(b => b === 'M').length;
  const boost = 1 + stillBeats * 0.25;
  const cdMul = 1 - Math.min(0.45, moveBeats * 0.15);

  // 拍譜在出招前就結清（換成蓄勁/縮冷卻），switch 內命中記的 D 拍才能存活；
  // 出招失敗（例：縮地沒目標）就原封還原，不能白吃玩家的拍。
  const beatSnapshot = p.beatLog;
  p.beatLog = []; p.beatT = 0; p.dashBeatCounted = false;
  let ok = false;
  switch (id) {
    case 'tackle': ok = dashTackle(d); break;
    case 'grab_spin': ok = dashGrabSpin(d); break;
    case 'flash_step': ok = techFlashStep(d); break;
    case 'mountain_bash': ok = techMountainBash(d); break;
    case 'knee_dash': ok = dashGeneric(d, 'knee'); break;
    case 'drunk_roll': ok = dashGeneric(d, 'roll'); break;
    case 'suplex_grab': ok = dashGeneric(d, 'suplex'); break;
    case 'iai_slash': {
      // 居合三段式：甩刀（有傷害）→ 反拿水平收刀 → 瞬移閃光，線上敵人延遲連斬
      const ang0 = (() => {
        const t = nearestEnemy(p.x, p.y, 500);
        return t ? Math.atan2(t.y - p.y, t.x - p.x) : (p.face > 0 ? 0 : Math.PI);
      })();
      // 第一段：前方甩刀
      sfx('swing_blade');
      spawnFx('swing', p.x, p.y, '#bfd4e8', 90, { angle: ang0, arc: 100, type: 'arc' });
      p.pose = { type: 'chop', ang: ang0, t: 0, dur: 0.15, prio: 1 };
      for (const e of G.enemies) {
        if (e.dead || e.grabbed || e.thrown) continue;
        const dd = Math.hypot(e.x - p.x, e.y - p.y);
        if (dd > 90 + e.r) continue;
        const ea = Math.atan2(e.y - p.y, e.x - p.x);
        if (Math.abs(angDiff(ea, ang0)) > 0.95) continue;
        addBeat('D');
        hurtEnemy(e, techDmg(12), { fromAngle: ang0 });
      }
      // 進入收刀段，之後在 updateTechniques 走完整條鏈
      p.iaiPhase = { phase: 'sheath', t: 1.0, boost: 0 };
      ok = true;
      break;
    }
    case 'shadow_dash': ok = dashGeneric(d, 'shadow'); break;   // 穿人但不無敵——這遊戲的衝刺沒有無敵
    case 'lunge_thrust': ok = dashGeneric(d, 'seiken'); break;
    case 'sumo_press': ok = techSumoPress(d); break;
  }
  if (ok) {
    sfx(id === 'flash_step' ? 'flash' : 'dash');
    p.dashCd = d.cd * cdMul * TUNE.dashCdMul * (hasItem('master_obi') ? 0.8 : 1);
    if (p.dashState) p.dashState.boost = boost;
    if (boost > 1) addDmgNum(p.x, p.y - 34, '蓄勁 ×' + boost.toFixed(2), '#e8964a');
    p.pose = { type: 'dash', ang: 0, t: 0, dur: Math.max(0.25, d.dashDur || 0.25), prio: 1 };
    if (hasItem('fist_wrap')) p.guaranteedCrit = true;
    if (hasItem('thunder_tattoo')) {
      spawnFx('shock', p.x, p.y, '#e0c341', 100);
      G.enemies.forEach(e => {
        if (!e.dead && dist2(e.x, e.y, p.x, p.y) < 100 * 100) {
          hurtEnemy(e, techDmg(10), { trueDmg: true });
        }
      });
    }
  }
  if (!ok) { p.beatLog = beatSnapshot; }
  return ok;
}

function dashDir() {
  const p = G.player;
  // 方向盤在玩家手上：按著方向鍵就往那邊衝，沒按方向就照最後一次走的方向。
  // 以前是自動導向最近的敵人——那等於系統幫你決定要往哪跑，走位就不是玩家的事了。
  const k = G.keys || {};
  let dx = 0, dy = 0;
  if (k['a'] || k['arrowleft']) dx -= 1;
  if (k['d'] || k['arrowright']) dx += 1;
  if (k['w'] || k['arrowup']) dy -= 1;
  if (k['s'] || k['arrowdown']) dy += 1;
  let ax, ay;
  const l = Math.hypot(dx, dy);
  if (l > 0) { ax = dx / l; ay = dy / l; }
  else { const ml = Math.hypot(p.lastMoveX, p.lastMoveY) || 1; ax = p.lastMoveX / ml; ay = p.lastMoveY / ml; }
  // ★ 方位吸附（總監 2026-08-04）：鍵盤只給得出 8 個方向，而敵人不會剛好站在那 8 條線上。
  //   在按的方向 ±35 度的錐形內找最近的敵人，直接對準他。
  //   例：敵人在 10 點鐘、你只按得出 11 點鐘，照樣抓得到。
  //   （16 方位在鍵盤上做不到——WASD 就是只有 8 個向量，除非加滑鼠瞄準。）
  const aimA = Math.atan2(ay, ax);
  let best = null, bestD = 1e9;
  for (const e of G.enemies) {
    if (e.dead || e.grabbed || e.thrown) continue;
    const ex = e.x - p.x, ey = e.y - p.y;
    const d = Math.hypot(ex, ey);
    if (d < 12 || d > 460) continue;
    if (Math.abs(angDiff(Math.atan2(ey, ex), aimA)) > 0.61) continue;   // ±35 度
    if (d < bestD) { bestD = d; best = e; }
  }
  if (best) {
    const bx = best.x - p.x, by = best.y - p.y, bd = Math.hypot(bx, by) || 1;
    return { x: bx / bd, y: by / bd, lockOn: best };
  }
  return { x: ax, y: ay };
}

function dashTackle(d) {
  const p = G.player;
  const dir = dashDir();
  p.dashState = { id: 'tackle', dx: dir.x, dy: dir.y, lockOn: dir.lockOn, t: d.dashDur, spd: d.dashSpd,
    carried: null, hitAny: false, risk: true };
  return true;
}

function dashGrabSpin(d) {
  const p = G.player;
  const dir = dashDir();
  p.dashState = { id: 'grab_spin', dx: dir.x, dy: dir.y, lockOn: dir.lockOn, t: d.dashDur, spd: d.dashSpd, grabDef: d };
  return true;
}

function dashGeneric(d, kind) {
  const p = G.player;
  const dir = dashDir();
  p.dashState = { id: kind, dx: dir.x, dy: dir.y, lockOn: dir.lockOn, t: d.dashDur, spd: d.dashSpd };
  return true;
}

/* 相撲：橫綱推壓——短衝＋周遭一圈撞飛 */
function techSumoPress(d) {
  const p = G.player;
  const dir = dashDir();
  p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + dir.x * d.lunge));
  p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + dir.y * d.lunge));
  spawnFx('shock', p.x, p.y, '#c9576b', 130);
  G.screenShake = Math.max(G.screenShake, 8);
  let hitAny = false;
  for (const e of G.enemies) {
    if (e.dead || e.grabbed || e.thrown) continue;
    if (dist2(e.x, e.y, p.x, p.y) < (130 + e.r) * (130 + e.r)) {
      hitAny = true;
      hurtEnemy(e, techDmg(12), { trueDmg: true });
      if (!e.dead) {
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        const kb = e.boss ? 50 : 300;
        e.knockX += Math.cos(a) * kb; e.knockY += Math.sin(a) * kb;
      }
    }
  }
  if (hitAny) addBeat('D');
  return true;
}

/* 招式更換：同槽位循環切換已學的招 */
/* 招式更換：直接指定。輪換式選擇器在選項超過兩個時是最差解——
   玩家不知道池子裡有誰、要看第三個得點兩次、而且沒有回上一個。 */
function setMoveSlot(slot, id) {
  const p = G.player;
  if (!p.knownMoves.includes(id)) return false;
  if (moveDef(id).slot !== slot) return false;
  p.moves[slot] = id;
  return true;
}

function cycleMoveSlot(slot) {
  const p = G.player;
  const pool = movesBySlot(slot).map(m => m.id).filter(id => p.knownMoves.includes(id));
  if (pool.length < 2) return false;
  const cur = pool.indexOf(p.moves[slot]);
  p.moves[slot] = pool[(cur + 1) % pool.length];
  return true;
}

/* 抓住一個敵人開始掄圈（由衝刺技轉入） */
function startGrab(e, d) {
  const p = G.player;
  sfx('grab');
  addBeat('D');
  addHitstop(0.09, true);
  G.screenShake = Math.max(G.screenShake, 6);
  e.hitSquash = Math.max(e.hitSquash || 0, 0.24);
  e.hitFlash = Math.max(e.hitFlash || 0, 0.12);
  spawnFx('spark', e.x, e.y, '#ffd44a', e.r, { angle: Math.atan2(e.y - p.y, e.x - p.x) });
  e.grabbed = true;
  e.stun = 99;
  p.grabState = {
    e, t: 0, dur: d.dur * (grabMaster() ? 1.25 : 1),
    ang: Math.atan2(e.y - p.y, e.x - p.x),
    orbitR: d.orbitR, spinSpd: d.spinSpd, tick: 0,
  };
}

/* 飛天炸彈摔落地：把人砸進地板，落點炸一圈 */
function doAirSlam(a) {
  const p = G.player, e = a.e;
  p.airSlam = null;
  p.poseAfter = { type: 'slamland', t: 0.28 };   // 落地壓扁定格（slam_2）
  p.staggerT = Math.max(p.staggerT, 0.35 + 0.65 * (a.dizzy || 0));   // 掄越久，落地後越站不穩
  sfxThrow('suplex');
  if (a.bigDrop) sfxThrow('ddt');   // 大落差再疊一層尖銳撞擊
  addHitstop(0.16, true);
  addBeat('S');
  spawnFx('explode', p.x, p.y, '#b07a4a', 150);
  spawnFx('shock', p.x, p.y, '#b07a4a', 150, { img: 'fx_slam_ring', squash: 0.45 });
  G.screenShake = Math.max(G.screenShake, 16);
  e.grabbed = false;
  e.x = p.x; e.y = p.y + 6;
  hurtEnemy(e, throwDmg((26 + e.maxHp * 0.34) * (a.bigDrop ? 1.4 : 1)), { trueDmg: true });
  if (!e.dead) { e.stun = 1.4; e.flat = { t: 1.2, mode: 'back' }; e.knockX = 0; e.knockY = 0; e.lift = 0; }
  const RAD = a.bigDrop ? 190 : 150;
  for (const o of G.enemies) {
    if (o.dead || o === e) continue;
    if (dist2(o.x, o.y, p.x, p.y) < RAD * RAD) {
      hurtEnemy(o, throwDmg(a.bigDrop ? 30 : 22), { trueDmg: true });
      if (!o.dead) {
        o.stun = Math.max(o.stun, o.boss ? 0.4 : 1.0);
        const ang = Math.atan2(o.y - p.y, o.x - p.x);
        const kb = o.boss ? 40 : 180;
        o.knockX += Math.cos(ang) * kb; o.knockY += Math.sin(ang) * kb;
      }
    }
  }
}

/* 站樁技：震腳脈衝 */
function quakePulse(d) {
  const p = G.player;
  let hitAny = false;
  sfx('quake', { vol: 0.7 });
  spawnFx('shock', p.x, p.y, '#8c6239', d.radius);
  G.screenShake = Math.max(G.screenShake, 7);
  p.pose = { type: 'stomp', ang: 0, t: 0, dur: 0.3, prio: 1 };
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, p.x, p.y) < d.radius * d.radius) {
      hitAny = true;
      hurtEnemy(e, autoDmg(14), { trueDmg: true });
      if (!e.dead) {
        e.stun = Math.max(e.stun, e.boss ? 0.25 : 0.6);
        traitOnControl(e);
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.knockX += Math.cos(a) * 60; e.knockY += Math.sin(a) * 60;
      }
    }
  }
  if (hitAny) addBeat('S', true);
}

/* 移動技：旋風掃腿 */
function cycloneSweep(d) {
  const p = G.player;
  let hitAny = false;
  const full = !d.arc || d.arc >= 360;
  const tgt = full ? null : nearestEnemy(p.x, p.y, 200);
  const ang = full ? 0 : (tgt ? Math.atan2(tgt.y - p.y, tgt.x - p.x) : (p.face > 0 ? 0 : Math.PI));
  const half = full ? Math.PI * 2 : (d.arc * Math.PI / 180) / 2;
  spawnFx('swing', p.x, p.y, d.color || '#c9d96a', d.radius, { angle: ang, arc: full ? 360 : d.arc, type: full ? 'spin' : 'arc', img: d.img });
  p.pose = { type: 'kick', ang, t: 0, dur: 0.3, prio: 1 };
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, p.x, p.y) < (d.radius + e.r) * (d.radius + e.r)) {
      const ea = Math.atan2(e.y - p.y, e.x - p.x);
      if (!full && Math.abs(angDiff(ea, ang)) > half) continue;
      hitAny = true;
      hurtEnemy(e, autoDmg(d.dmg || 9), { trueDmg: true });
      if (!e.dead) {
        e.knockX += Math.cos(ea) * (d.knock || 50); e.knockY += Math.sin(ea) * (d.knock || 50);
      }
    }
  }
  if (hitAny) addBeat('M', true);
}

/* 移動技：金臂勾——朝奔跑方向橫掃，助跑越久掛得越飛 */
function lariatRun(d) {
  const p = G.player;
  const ml = Math.hypot(p.lastMoveX, p.lastMoveY) || 1;
  const ang = Math.atan2(p.lastMoveY / ml, p.lastMoveX / ml);
  const runK = Math.min(1, p.moveTime / 2.0);
  const half = (d.arc * Math.PI / 180) / 2;
  spawnFx('swing', p.x, p.y, d.color, d.radius, { angle: ang, arc: d.arc, type: 'arc' });
  p.pose = { type: 'lariat', ang, t: 0, dur: 0.25, prio: 1 };
  sfx('wind');
  let hitAny = false;
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, p.x, p.y) > (d.radius + e.r) * (d.radius + e.r)) continue;
    const ea = Math.atan2(e.y - p.y, e.x - p.x);
    if (Math.abs(angDiff(ea, ang)) > half) continue;
    hitAny = true;
    hurtEnemy(e, autoDmg(d.dmg) * (0.7 + 0.8 * runK), { fromAngle: ang });
    if (!e.dead) {
      const kb = (e.boss ? 40 : d.knock) * (0.6 + 0.9 * runK);
      e.knockX += Math.cos(ea) * kb; e.knockY += Math.sin(ea) * kb;
      if (!e.boss && d.stun) e.stun = Math.max(e.stun, d.stun * runK);
    }
  }
  if (hitAny) addBeat('M', true);
}

/* 站樁技：肘擊墜落——騰空落肘，砸到的連旁邊一起趴 */
function elbowDrop(d) {
  const p = G.player;
  const tgt = nearestEnemy(p.x, p.y, d.radius);
  const ang = tgt ? Math.atan2(tgt.y - p.y, tgt.x - p.x) : (p.face > 0 ? 0 : Math.PI);
  p.pose = { type: 'elbow', ang, t: 0, dur: 0.3, prio: 1 };
  spawnFx('shock', p.x, p.y, d.color, d.radius, { img: 'fx_elbow_drop' });
  sfx('throw_hit');
  addHitstop(0.05, false);
  G.screenShake = Math.max(G.screenShake, 6);
  let hitAny = false;
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, p.x, p.y) < (d.radius + e.r) * (d.radius + e.r)) {
      hitAny = true;
      hurtEnemy(e, autoDmg(d.dmg), { trueDmg: true });
      if (!e.dead) {
        e.stun = Math.max(e.stun, e.boss ? 0.28 : d.stun);
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.knockX += Math.cos(a) * d.knock; e.knockY += Math.sin(a) * d.knock;
      }
    }
  }
  if (hitAny) addBeat('S', true);
}

/* 移動技：曳尾勁——掃傷身後 */
function tailWake() {
  const p = G.player;
  const ml = Math.hypot(p.lastMoveX, p.lastMoveY) || 1;
  const bx = p.x - p.lastMoveX / ml * 30;
  const by = p.y - p.lastMoveY / ml * 30;
  let hit = false;
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, bx, by) < (46 + e.r) * (46 + e.r)) {
      hit = true;
      hurtEnemy(e, autoDmg(5), { trueDmg: true });
      if (!e.dead) {
        const a = Math.atan2(e.y - by, e.x - bx);
        e.knockX += Math.cos(a) * 70; e.knockY += Math.sin(a) * 70;
      }
    }
  }
  if (hit) { spawnFx('swing', bx, by, '#8fa89a', 46, { angle: 0, arc: 360, type: 'spin' }); addBeat('M'); }
}

/* 移動技：威壓步——移動中的碰撞氣場（累積結算避免傷害數字洗版） */
function phantomPress(dt) {
  const p = G.player;
  for (const e of G.enemies) {
    if (e.dead || e.grabbed || e.thrown) continue;
    const rr = p.r + e.r + 8;
    if (dist2(p.x, p.y, e.x, e.y) < rr * rr) {
      e.pressAcc = (e.pressAcc || 0) + autoDmg(7) * dt;
      if (e.pressAcc >= 4) {
        const dmg = e.pressAcc; e.pressAcc = 0;
        hurtEnemy(e, dmg, { trueDmg: true });
        addBeat('M');
      }
      if (!e.dead) {
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.knockX += Math.cos(a) * 130 * dt * 8;
        e.knockY += Math.sin(a) * 130 * dt * 8;
      }
    }
  }
}

/* 衝刺技落點效果 */
function kneeImpact() {
  const p = G.player;
  addBeat('D');
  spawnFx('explode', p.x, p.y, '#d97a5a', 95);
  G.screenShake = Math.max(G.screenShake, 8);
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, p.x, p.y) < 95 * 95) {
      hurtEnemy(e, techDmg(20), { trueDmg: true });
      if (!e.dead) e.stun = Math.max(e.stun, e.boss ? 0.3 : 0.8);
    }
  }
}
function rollSweep() {
  const p = G.player;
  addBeat('D');
  spawnFx('swing', p.x, p.y, '#d9a441', 95, { angle: 0, arc: 360, type: 'spin' });
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, p.x, p.y) < (95 + e.r) * (95 + e.r)) {
      hurtEnemy(e, techDmg(16), { trueDmg: true });
      if (!e.dead) {
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.knockX += Math.cos(a) * 140; e.knockY += Math.sin(a) * 140;
      }
    }
  }
}

function techFlashStep() {
  const p = G.player;
  const tgt = nearestEnemy(p.x, p.y, 320);
  if (!tgt) return false;
  const a = Math.atan2(tgt.y - p.y, tgt.x - p.x);
  p.x = Math.max(p.r, Math.min(ARENA.w - p.r, tgt.x + Math.cos(a) * (tgt.r + 26)));
  p.y = Math.max(p.r, Math.min(ARENA.h - p.r, tgt.y + Math.sin(a) * (tgt.r + 26)));
  p.guaranteedCrit = true;
  p.flashHasteT = 2;
  spawnFx('burst', p.x, p.y, '#79d9c0', 20);
  return true;
}

function techQuakeStomp(d) {
  const p = G.player;
  spawnFx('shock', p.x, p.y, '#8c6239', d.radius);
  G.screenShake = Math.max(G.screenShake, 10);
  let hit = false;
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, p.x, p.y) < d.radius * d.radius) {
      hit = true;
      hurtEnemy(e, techDmg(22), { trueDmg: true });
      if (!e.dead) {
        e.stun = Math.max(e.stun, e.boss ? 0.4 : 1.0);
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.knockX += Math.cos(a) * 60; e.knockY += Math.sin(a) * 60;
      }
    }
  }
  return true;  // 踏空也算施放，這是面技的代價
}

function techMountainBash() {
  const p = G.player;
  const tgt = nearestEnemy(p.x, p.y, 400);
  let dx = p.face, dy = 0;
  if (tgt) {
    const dd = Math.hypot(tgt.x - p.x, tgt.y - p.y) || 1;
    dx = (tgt.x - p.x) / dd; dy = (tgt.y - p.y) / dd;
  }
  p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + dx * 130));
  p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + dy * 130));
  const ang = Math.atan2(dy, dx);
  spawnFx('swing', p.x, p.y, '#8a8f99', 110, { angle: ang, arc: 100, type: 'arc' });
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dd = Math.hypot(e.x - p.x, e.y - p.y);
    if (dd > 110 + e.r) continue;
    const ea = Math.atan2(e.y - p.y, e.x - p.x);
    if (Math.abs(angDiff(ea, ang)) > 0.9) continue;
    hurtEnemy(e, techDmg(16), { fromAngle: ang });
    if (!e.dead) {
      const kb = e.boss ? 40 : 260;
      e.knockX += Math.cos(ea) * kb; e.knockY += Math.sin(ea) * kb;
    }
  }
  p.armorBuff = Math.max(p.armorBuff, 6);
  p.armorBuffT = 2;
  return true;
}

/* 每 tick 更新進行中的絕技狀態，在 updatePlayer 開頭呼叫 */
function updateTechniques(dt) {
  const p = G.player;
  if (p.dashCd > 0) p.dashCd -= dt * (1 + Math.max(0, p.stats.atkSpd) / 200);
  if (p.pose) {
    p.pose.t += dt;
    if (p.pose.t >= p.pose.dur) {
      if (p.pose.prio === 1 && p.comboSettle > 0) p.poseAfter = { type: p.pose.type, t: 0.18 };
      p.pose = null;
    }
  }
  if (p.poseAfter) { p.poseAfter.t -= dt; if (p.poseAfter.t <= 0) p.poseAfter = null; }
  // 排隊中的連段收尾：前一招接觸幀播完就放
  if (p.pendingCombo) p.pendingComboWait -= dt;
  if (p.pendingCombo && (!p.pose || p.pose.t >= 0.18 || p.pose.prio < 0 || p.pendingComboWait <= 0)) {
    const pc = p.pendingCombo;
    p.pendingCombo = null;
    p.comboFiring = true;
    const fired2 = castCombo(pc);
    p.comboFiring = false;
    if (fired2) p.comboStep = 0;
  }
  if (p.killHasteT > 0) p.killHasteT -= dt;
  if (p.bellPlateCd > 0) p.bellPlateCd -= dt;
  if (p.staggerT > 0) p.staggerT -= dt;
  if (p.flashHasteT > 0) p.flashHasteT -= dt;
  if (p.counterProcCd > 0) p.counterProcCd -= dt;
  if (p.ougiField > 0) p.ougiField -= dt;
  if (p.hurtT > 0) p.hurtT -= dt;
  // 居合鏈：收刀 → 瞬移閃光 → 線上敵人掛延遲連斬
  if (p.iaiPhase) {
    const ip = p.iaiPhase;
    ip.t -= dt;
    if (ip.phase === 'sheath' && ip.t <= 0) {
      sfx('sheathe');
      // 瞬移：方向鍵指定方向優先，沒按就朝面向
      const k = G.keys;
      let dx = 0, dy = 0;
      if (k['a'] || k['arrowleft']) dx -= 1;
      if (k['d'] || k['arrowright']) dx += 1;
      if (k['w'] || k['arrowup']) dy -= 1;
      if (k['s'] || k['arrowdown']) dy += 1;
      if (dx === 0 && dy === 0) {
        const dir = dashDir();
        dx = dir.x; dy = dir.y;
      } else {
        const l = Math.hypot(dx, dy); dx /= l; dy /= l;
      }
      const x0 = p.x, y0 = p.y;
      p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + dx * 400));
      p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + dy * 400));
      pushOutOfWalls(p);
      sfx('flash');
      addHitstop(0.08, true);
      spawnFx('iailine', x0, y0, '#ffffff', 0, { tx: p.x, ty: p.y });
      // 線廊道上的敵人：0.3 秒後裂開——延遲三連斬
      for (const e of G.enemies) {
        if (e.dead || e.grabbed || e.thrown) continue;
        const t2 = Math.max(0, Math.min(1,
          ((e.x - x0) * (p.x - x0) + (e.y - y0) * (p.y - y0)) / (dist2(x0, y0, p.x, p.y) || 1)));
        const lx = x0 + (p.x - x0) * t2, ly = y0 + (p.y - y0) * t2;
        if (dist2(e.x, e.y, lx, ly) < (36 + e.r) * (36 + e.r)) {
          e.iaiCut = { t: 0.3, n: 3, dmg: techDmg(16) * (1 + (ip.boost || 0)) };
          addBeat('D');
        }
      }
      p.iaiPhase = null;
    }
  }
  if (p.sheathing > 0) {
    p.sheathing -= dt;
    if (p.sheathing <= 0) {
      sfx('sheathe');
      spawnFx('spark', p.x + p.face * 10, p.y - 6, '#ffffff', 8, { angle: 0 });
    }
  }

  // ---- 節拍冷卻（節拍本體改由「命中」記錄，見 addBeat） ----
  if (p.beatCd > 0) p.beatCd -= dt;
  if (p.triCd > 0) p.triCd -= dt;
  if (p.resonCd > 0) p.resonCd -= dt;
  if (p.dashChainT > 0) p.dashChainT -= dt; else p.dashChain = 0;
  if (p.ougiCd > 0) p.ougiCd -= dt;
  if (p.comboCd > 0) p.comboCd -= dt;
  if (p.slotCd) for (const k in p.slotCd) if (p.slotCd[k] > 0) p.slotCd[k] -= dt;
  if (p.beatPopT > 0) p.beatPopT -= dt;
  if (p.comboFlash > 0) p.comboFlash -= dt;
  if (p.comboBreakT > 0) p.comboBreakT -= dt;
  if (p.comboSettle > 0) p.comboSettle -= dt;
  if (p.extCd > 0) p.extCd -= dt;
  if (p.extWindow) {
    const ew = p.extWindow;
    if (ew.delay > 0) {
      ew.delay -= dt;
      if (ew.delay <= 0 && ew.buffered) {   // 窗口一開就把緩衝的輸入放掉
        p.extWindow = null;
        castExtension(ew.move, ew.victim);
      }
    } else {
      ew.t -= dt;
      if (ew.t <= 0) p.extWindow = null;
    }
  }
  if (p.comboCdMsgT > 0) p.comboCdMsgT -= dt;
  // 連段拍譜不會過期（總監定案）：湊到的拍就是你的，不會因為停手而消失。
  // 拍譜只在「打出收尾招」時清空——玩家可以慢慢找位置、等時機，不必被碼表追著跑。
  if (p.beatLog.length) p.beatT += dt;
  if (p.flowT > 0) p.flowT -= dt;

  // ---- 站樁技 ----
  const stillId = p.moves.still;
  if (stillActive()) {
    p.stillTechTimer += dt;
    if (stillId === 'quake_pulse' && p.stillTechTimer >= MOVE_MAP.quake_pulse.interval) {
      if (holdOrFire('stillTechTimer', MOVE_MAP.quake_pulse, MOVE_MAP.quake_pulse.radius + 20))
        quakePulse(MOVE_MAP.quake_pulse);
    } else if (stillId === 'palm_flurry' && p.stillTechTimer >= MOVE_MAP.palm_flurry.interval && !p.flurry) {
      if (holdOrFire('stillTechTimer', MOVE_MAP.palm_flurry, 150))
        p.flurry = { t: 0.4, tick: 0, n: 0, max: 3 };
    } else if (stillId === 'sanchin') {
      // 三戰立：扎根調息，五分勁滿的那一擊必定爆擊（引爆空手道的爆擊震盪）
      p.focusT += dt;
      if (p.focusT >= (MOVE_MAP.sanchin.tick || 0.5) && p.focusStacks < (MOVE_MAP.sanchin.max || 5)) {
        p.focusT = 0; p.focusStacks++;
        addDmgNum(p.x, p.y - 30, '勁', '#e8964a');
        spawnFx('shock', p.x, p.y, '#e8964a', 46, { img: 'fx_kime' });
        if (p.focusStacks >= (MOVE_MAP.sanchin.max || 5)) p.guaranteedCrit = true;
      }
    } else if (stillId === 'triple_slash' && p.stillTechTimer >= MOVE_MAP.triple_slash.interval && !p.flurry) {
      if (holdOrFire('stillTechTimer', MOVE_MAP.triple_slash, 160))
      p.flurry = { t: 0.5, tick: 0, n: 0, max: 3, tickDur: 0.14, radius: 145, halfArc: 0.87,
        arc: 100, color: '#b8c6dc', pose: 'chop', beat: 'S', sfx: 'swing_blade',
        dmg: [10, 10, 20], knock: [40, 40, 130], stunLast: 0.6, img: 'fx_slash_triple', imgLast: 'fx_slash_kesa' };
    } else if (stillId === 'elbow_drop' && p.stillTechTimer >= MOVE_MAP.elbow_drop.interval) {
      if (holdOrFire('stillTechTimer', MOVE_MAP.elbow_drop, MOVE_MAP.elbow_drop.radius + 20))
        elbowDrop(MOVE_MAP.elbow_drop);
    } else if (stillId === 'focus_strike') {
      p.focusT += dt;
      if (p.focusT >= 0.6 && p.focusStacks < 6) {
        p.focusT = 0; p.focusStacks++;
        addDmgNum(p.x, p.y - 30, '蓄', '#e8964a');
      }
    } else if (stillId === 'breath_heal') {
      p.breathAcc += p.maxHp * 0.012 * dt;
      if (p.breathAcc >= 1) { const n = Math.floor(p.breathAcc); p.breathAcc -= n; healPlayer(n); }
    }
  } else {
    p.stillTechTimer = 0; p.focusT = 0;
  }

  // ---- 移動技 ----
  const moveId = p.moves.move;
  if (movingActive()) {
    p.moveTechTimer += dt;
    if (moveId === 'cyclone_kick' && p.moveTechTimer >= MOVE_MAP.cyclone_kick.interval) {
      if (holdOrFire('moveTechTimer', MOVE_MAP.cyclone_kick, MOVE_MAP.cyclone_kick.radius + 20))
        cycloneSweep(MOVE_MAP.cyclone_kick);
    } else if (moveId === 'tail_wake' && p.moveTechTimer >= MOVE_MAP.tail_wake.interval) {
      if (holdOrFire('moveTechTimer', MOVE_MAP.tail_wake, 130))
        tailWake();
    } else if (moveId === 'jodan_kick' && p.moveTechTimer >= MOVE_MAP.jodan_kick.interval) {
      if (holdOrFire('moveTechTimer', MOVE_MAP.jodan_kick, MOVE_MAP.jodan_kick.radius + 20))
        cycloneSweep(MOVE_MAP.jodan_kick);
    } else if (moveId === 'twin_slash' && p.moveTechTimer >= MOVE_MAP.twin_slash.interval && !p.flurry) {
      if (holdOrFire('moveTechTimer', MOVE_MAP.twin_slash, 150))
      p.flurry = { t: 0.3, tick: 0, n: 0, max: 2, tickDur: 0.12, radius: 130, halfArc: 0.96,
        arc: 110, color: '#8fa8d4', pose: 'chop', beat: 'M', sfx: 'swing_blade',
        dmg: 10, knock: 55, img: 'fx_slash_double' };
    } else if (moveId === 'lariat_run' && p.moveTechTimer >= MOVE_MAP.lariat_run.interval) {
      if (holdOrFire('moveTechTimer', MOVE_MAP.lariat_run, MOVE_MAP.lariat_run.radius + 20))
        lariatRun(MOVE_MAP.lariat_run);
    } else if (moveId === 'phantom_press') {
      phantomPress(dt);
    }
  } else {
    p.moveTechTimer = 0;
  }

  // ---- 連段脈衝模板（千手張打／二連斬／三連斬共用；預設值＝千手張打原參數） ----
  if (p.flurry) {
    const f = p.flurry;
    f.t -= dt; f.tick -= dt;
    if (f.tick <= 0 && f.n < (f.max || 3)) {
      f.tick = f.tickDur || 0.115; f.n++;
      const isLast = f.n >= (f.max || 3);
      const tgt = nearestEnemy(p.x, p.y, 200);
      const ang = tgt ? Math.atan2(tgt.y - p.y, tgt.x - p.x) : (p.face > 0 ? 0 : Math.PI);
      spawnFx('swing', p.x, p.y, f.color || '#c9576b', f.radius || 110,
        { angle: ang, arc: f.arc || 120, type: 'arc', img: (isLast && f.imgLast) ? f.imgLast : f.img });
      p.pose = { type: f.pose || 'palm', ang, t: 0, dur: 0.2, prio: 1 };
      if (f.sfx) sfx(f.sfx);
      const dmgN = Array.isArray(f.dmg) ? f.dmg[f.n - 1] : (f.dmg || 9);
      const knockN = Array.isArray(f.knock) ? f.knock[f.n - 1] : (f.knock !== undefined ? f.knock : 140);
      for (const e of G.enemies) {
        if (e.dead) continue;
        const dd = Math.hypot(e.x - p.x, e.y - p.y);
        if (dd > (f.radius || 110) + e.r) continue;
        const ea = Math.atan2(e.y - p.y, e.x - p.x);
        if (Math.abs(angDiff(ea, ang)) > (f.halfArc || 1.05)) continue;
        hurtEnemy(e, autoDmg(dmgN), { fromAngle: ang });
        addBeat(f.beat || 'S', true);
        if (!e.dead) {
          const kb = e.boss ? 25 : knockN;
          e.knockX += Math.cos(ea) * kb; e.knockY += Math.sin(ea) * kb;
          if (isLast && f.stunLast && !e.boss) e.stun = Math.max(e.stun, f.stunLast);
        }
      }
    }
    if (f.t <= 0) p.flurry = null;
  }

  // ---- 奧義持續效果 ----
  if (p.burstMulti) {
    const b = p.burstMulti;
    b.tick -= dt;
    if (b.tick <= 0) {
      b.tick = 0.08; b.hits--;
      const half = (b.arc * Math.PI / 180) / 2;
      const tgt = nearestEnemy(p.x, p.y, b.range * 1.2);
      if (tgt) b.ang = Math.atan2(tgt.y - p.y, tgt.x - p.x);
      spawnFx('swing', p.x, p.y, '#ffd44a', b.range, { angle: b.ang, arc: b.arc, type: b.arc >= 360 ? 'spin' : 'arc' });
      p.pose = { type: 'jab', ang: b.ang, t: 0, dur: 0.1, prio: 1 };
      for (const e of G.enemies) {
        if (e.dead) continue;
        const dd = Math.hypot(e.x - p.x, e.y - p.y);
        if (dd > b.range + e.r) continue;
        if (b.arc < 360) {
          const ea = Math.atan2(e.y - p.y, e.x - p.x);
          if (Math.abs(angDiff(ea, b.ang)) > half) continue;
        }
        hurtEnemy(e, techDmg(b.dmg), { crit: chance(0.35), trueDmg: true });
        if (!e.dead && b.loot && chance(0.1)) {
          G.pickups.push({ type: 'mat', value: 1, x: e.x, y: e.y, vx: rnd(-60, 60), vy: rnd(-60, 60), t: 0 });
        }
      }
      if (b.hits <= 0) p.burstMulti = null;
    }
  }
  if (p.rushMulti) {
    const r = p.rushMulti;
    r.tick -= dt;
    if (r.tick <= 0) {
      r.tick = 0.11;
      const alive = r.targets.filter(e => !e.dead);
      if (!alive.length) { p.rushMulti = null; }
      else {
        const e = alive[0];
        r.targets = alive.slice(1);
        p.x = Math.max(p.r, Math.min(ARENA.w - p.r, e.x + rnd(-20, 20)));
        p.y = Math.max(p.r, Math.min(ARENA.h - p.r, e.y + rnd(-20, 20)));
        spawnFx('burst', e.x, e.y, '#79d9c0', 18);
        hurtEnemy(e, techDmg(r.dmg), { crit: true });
        p.iframe = Math.max(p.iframe, 0.3);
        if (!r.targets.length) p.rushMulti = null;
      }
    }
  }
  if (p.kneeChain) {
    const k = p.kneeChain;
    const e = k.e;
    if (e.dead) { p.kneeChain = null; }
    else {
      e.x = p.x + p.face * (p.r + e.r - 4);
      e.y = p.y;
      k.tick -= dt;
      if (k.tick <= 0) {
        k.tick = 0.16; k.hits--;
        p.pose = { type: 'knee', ang: 0, t: 0, dur: 0.14, prio: 1 };
        hurtEnemy(e, techDmg(k.dmg), { crit: chance(0.3), trueDmg: true });
        G.screenShake = Math.max(G.screenShake, 3);
        if (k.hits <= 0 || e.dead) {
          if (!e.dead) { e.grabbed = false; e.stun = 0.6; }
          p.kneeChain = null;
        }
      }
    }
  }

  // ---- 擒抱持有：移動＝掄甩、站定＝炸彈摔 ----
  if (p.grabState && p.grabState.mode === 'hold') {
    const g = p.grabState;
    const e = g.e;
    if (e.dead) { p.staggerT = Math.max(p.staggerT, 0.35 + 0.65 * (g.dizzy || 0)); p.grabState = null; }
    else {
      g.t += dt;
      // 抓的人雙臂一直鎖著對方（prio 1：武器揮擊不搶走這個姿勢）
      p.pose = { type: 'hold', ang: Math.atan2(e.y - p.y, e.x - p.x), t: 0.12, dur: 0.35, prio: 1 };
      const moving = p.moveTime > 0.1;
      if (moving) {
        // 掄著他甩打周遭（移動拍）——越掄越快（+4%/秒、上限+30%），4 秒後開始頭暈
        p.stillHold = 0;
        if (!g.baseSpin) g.baseSpin = g.spinSpd;
        g.spinSpd = (g.baseSpin >= 0 ? 1 : -1) * Math.min(Math.abs(g.baseSpin) * 1.3,
          Math.abs(g.baseSpin) * (1 + 0.04 * g.t));
        if (g.t > 4) g.dizzy = Math.min(1, (g.t - 4) / 3);
        g.ang += g.spinSpd * dt;
        e.x = p.x + Math.cos(g.ang) * g.orbitR;
        e.y = p.y + Math.sin(g.ang) * g.orbitR;
        g.tick -= dt;
        if (g.tick <= 0) {
          g.tick = 0.14;
          let hitAny = false;
          for (const o of G.enemies) {
            if (o.dead || o === e) continue;
            const rr = o.r + e.r + 4;
            if (dist2(o.x, o.y, e.x, e.y) < rr * rr) {
              hitAny = true;
              hurtEnemy(o, throwDmg(4 + e.maxHp * 0.035), { trueDmg: true });
              if (!o.dead) {
                const a = Math.atan2(o.y - e.y, o.x - e.x);
                o.knockX += Math.cos(a) * 140; o.knockY += Math.sin(a) * 140;
              }
            }
          }
          // 整段掄甩只記一個 M 拍：多記會把擒抱的 D 拍擠出三格拍譜，D,M,S 就湊不成了
          if (hitAny && !g.beatM) { g.beatM = true; addBeat('M'); }
          // 被掄的人只有「撞到別人」那一下才扣血——他是武器，不是持續放血的沙包
          if (hitAny) hurtEnemy(e, throwDmg(3), { trueDmg: true, noLifesteal: true });
        }
      } else {
        // 站定醞釀炸彈摔（站樁拍）——人質在懷裡掙扎，不是貼紙
        e.x = p.x + p.face * (p.r + e.r - 2) + Math.sin(g.t * 21) * 1.4;
        e.y = p.y - 6 + Math.cos(g.t * 16) * 1.0;
        p.stillHold += dt;
        if (p.stillHold >= 0.5) {
          // 炸彈摔＝把人抱起來跳上天，滯空期間自己走位選落點（再按一次 Space 提早落地）
          sfx('dash');
          // 總監 2026-08-04：跳高一點、不要這麼快落地，不然來不及反應。
          // dur 1.0 → 1.7 秒，而且改成「一起跳就升空」而不是最後 0.2 秒才跳。
          p.airSlam = { e, t: 0, dur: 1.7, slam: false, dizzy: g.dizzy || 0, highJump: true };
          p.grabState = null; p.stillHold = 0;
        }
      }
      // 掄甩不自動放開（總監指令）：抓著就一直掄，結束方式只有站定炸彈摔或人質陣亡
      e.x = Math.max(e.r, Math.min(ARENA.w - e.r, e.x));
      e.y = Math.max(e.r, Math.min(ARENA.h - e.r, e.y));
    }
  }
  // ---- 霞斬：埋在地上的刀氣，時間到整片炸開 ----
  if (G.mistCuts && G.mistCuts.length) {
    for (let mi = G.mistCuts.length - 1; mi >= 0; mi--) {
      const mc = G.mistCuts[mi];
      mc.t -= dt;
      if (mc.t > 0) continue;
      for (const o of G.enemies) {
        if (o.dead) continue;
        if (dist2(o.x, o.y, mc.x, mc.y) > mc.r * mc.r) continue;
        hurtEnemy(o, techDmg(mc.dmg), { crit: chance(0.4), trueDmg: true });
        if (!o.dead) {
          addCuts(o, mc.cuts, 0);
          if (mc.sever) severCheck(o);
        }
      }
      spawnFx('shock', mc.x, mc.y, '#e8f2ff', mc.r, { img: 'fx_ougi_cross' });
      spawnFx('explode', mc.x, mc.y, '#e8f2ff', mc.r * 0.6);
      G.screenShake = Math.max(G.screenShake, 12);
      addHitstop(0.09, true);
      sfxSever();
      G.mistCuts.splice(mi, 1);
    }
  }
  // ---- 三段突：連續三記直刺 ----
  if (p.thrustChain) {
    const tc = p.thrustChain;
    tc.t -= dt;
    if (!tc.e || tc.e.dead) { p.thrustChain = null; }
    else if (tc.t <= 0) {
      tc.left--;
      tc.t = 0.11;
      const last = tc.left <= 0;
      hurtEnemy(tc.e, techDmg(tc.dmg), { crit: last, fromAngle: tc.ang });
      if (!tc.e.dead) {
        addCuts(tc.e, tc.cuts, tc.ang);
        if (last && tc.severLast) severCheck(tc.e, 0, true);
      }
      spawnFx('spark', tc.e.x, tc.e.y, '#e8f2ff', tc.e.r, { angle: tc.ang });
      addHitstop(last ? 0.09 : 0.03, last);
      sfx('hit_blade', { pitch: 1 + (3 - tc.left) * 0.08 });
      if (last) { p.thrustChain = null; p.staggerT = Math.max(p.staggerT, 0.15); }
    }
  }
  // ---- DDT：勾頭帶跑 → 坐倒把頭釘進地板 ----
  if (p.ddtState) {
    const ds = p.ddtState;
    const e = ds.e;
    if (!e || e.dead) { p.ddtState = null; }
    else {
      ds.t += dt;
      e.grabbed = true; e.stun = 99; e.knockX = 0; e.knockY = 0;
      if (ds.t < 0.12) {
        // 抓著頭跑那一段＝DDT 的靈魂
        const run = 700 * dt;
        p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + ds.dx * run));
        p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + ds.dy * run));
        pushOutOfWalls(p);
        e.x = p.x + ds.dx * 22; e.y = p.y + ds.dy * 22 - 4;
        e.lift = 8;
        e.spin = { v: 0, t: 0.1, a: Math.sin(ds.t * 40) * 0.15 };   // 被拖行的擺動
      } else if (ds.t < 0.2) {
        e.x = p.x + ds.dx * 20; e.y = p.y + ds.dy * 20 - 4; e.lift = 8;
      } else if (ds.t < 0.34) {
        // 後倒種地：向前再滑一點——把向前的動能轉成向下的
        const k2 = (ds.t - 0.2) / 0.14;
        p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + ds.dx * 140 * dt));
        p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + ds.dy * 140 * dt));
        e.x = p.x + ds.dx * 18; e.y = p.y + ds.dy * 18;
        e.lift = 8 * (1 - k2);
        e.spin = { v: 0, t: 0.1, a: k2 * Math.PI * 0.9 };
      } else {
        e.lift = 0; e.grabbed = false; e.spin = null;
        hurtEnemy(e, techDmg(88), { crit: true, trueDmg: true });
        if (!e.dead) { e.stun = 1.5; e.flat = { t: 1.4, mode: 'face' }; }
        spawnFx('explode', e.x, e.y, '#e8e4dc', 70);
        G.screenShake = Math.max(G.screenShake, 15);
        addHitstop(0.11, true);
        sfxThrow('ddt');
        p.lastComboVictim = e;
        p.ddtState = null;
        p.staggerT = Math.max(p.staggerT, 0.25);
      }
    }
  }
  // ---- 德式背摔：抱腰 → 後仰過頂 → 受方上背著地 ----
  if (p.suplexAnim) {
    const sa = p.suplexAnim;
    const e = sa.e;
    if (!e || e.dead) { p.suplexAnim = null; }
    else {
      sa.t += dt;
      e.grabbed = true; e.stun = 99; e.knockX = 0; e.knockY = 0;
      const dirS = sa.face > 0 ? 1 : -1;
      if (sa.t < 0.16) {
        // 抱住：拉到身前
        const k0 = sa.t / 0.16;
        e.x = p.x + dirS * (26 - 4 * k0);
        e.y = p.y;
        e.lift = 0;
        e.spin = { v: 0, t: 0.1, a: -0.3 * k0 };
      } else if (sa.t < 0.42) {
        // 後仰過頂：從身前掃到身後，頂點 62px（＝1.35 個身高，過頂讀得出來的最低值）
        const k1 = (sa.t - 0.16) / 0.26;
        const ease = k1 * k1 * (3 - 2 * k1);
        e.x = p.x + dirS * (22 - 68 * ease);
        e.y = p.y + 6 * ease;
        e.lift = Math.sin(Math.min(1, ease / 0.75) * Math.PI * 0.85) * 62;
        e.spin = { v: 0, t: 0.1, a: -0.3 + (Math.PI + 0.3) * ease * ease };
      } else {
        // 落地：上背砸地
        e.lift = 0;
        e.grabbed = false;
        e.spin = null;
        hurtEnemy(e, techDmg(sa.dmg), { trueDmg: true });
        if (!e.dead) { e.stun = sa.stun; e.flat = { t: 1.2, mode: 'back' }; }
        spawnFx('shock', e.x, e.y, '#b07a4a', 120, { img: 'fx_slam_ring', squash: 0.45 });
        G.screenShake = Math.max(G.screenShake, 14);
        addHitstop(0.1, true);
        sfxThrow('suplex');
        p.lastComboVictim = e;
        p.suplexAnim = null;
      }
    }
  }
  // ---- 腰投：勾臂以腰為支點往前摔，施術者保持站立 ----
  if (p.hipTossAnim) {
    const ha = p.hipTossAnim;
    const e = ha.e;
    if (!e || e.dead) { p.hipTossAnim = null; }
    else {
      ha.t += dt;
      e.grabbed = true; e.stun = 99; e.knockX = 0; e.knockY = 0;
      const dirH = ha.face > 0 ? 1 : -1;
      if (ha.t < 0.14) {
        e.x = p.x + dirH * 30; e.y = p.y - 4; e.lift = 6;
      } else if (ha.t < 0.32) {
        // 低平拋物線：頂點只有 28px——這是「摔」不是「拋」
        const k1 = (ha.t - 0.14) / 0.18;
        e.x = p.x + dirH * (30 + 40 * k1);
        e.y = p.y + 4 * k1;
        e.lift = Math.sin(k1 * Math.PI) * 28;
        e.spin = { v: 0, t: 0.1, a: k1 * Math.PI * 1.5 };   // 側翻 3/4 圈
      } else {
        e.lift = 0; e.grabbed = false; e.spin = null;
        hurtEnemy(e, techDmg(ha.dmg), { trueDmg: true });
        if (!e.dead) { e.stun = ha.stun; e.flat = { t: 1.0 }; }
        spawnFx('shock', e.x, e.y, '#b07a4a', 100, { img: 'fx_slam_ring', squash: 0.45 });
        G.screenShake = Math.max(G.screenShake, 11);
        addHitstop(0.08, true);
        sfxThrow('hiptoss');
        p.lastComboVictim = e;
        p.hipTossAnim = null;
      }
    }
  }
  // ---- 抱腰翻滾：抱著滾四圈，每次撞地一段傷害 ----
  if (p.gutRoll) {
    const gr = p.gutRoll;
    gr.t += dt;
    const PERIOD = 0.28, ROLLS = 4;
    const phase = (gr.t % PERIOD) / PERIOD;
    // 撞地慢、翻過去快——等速滾動會讀成輪子，不是兩個人在滾
    const spd = 257 * (1 + 0.35 * Math.sin(phase * Math.PI * 2));
    p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + gr.dx * spd * dt));
    p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + gr.dy * spd * dt));
    pushOutOfWalls(p);
    gr.ang += (Math.PI * 2 / PERIOD) * dt;
    if (gr.victim && !gr.victim.dead) {
      const v = gr.victim;
      v.grabbed = true; v.stun = 99; v.lift = 0;
      v.x = p.x + gr.dx * 14; v.y = p.y + gr.dy * 14;
      v.spin = { v: 0, t: 0.1, a: gr.ang };
    }
    const nowHit = Math.floor(gr.t / PERIOD);
    if (nowHit > gr.hits && nowHit <= ROLLS) {
      gr.hits = nowHit;
      const last = nowHit >= ROLLS;
      // 沒抓到人就沿路撿一個
      if (!gr.victim || gr.victim.dead) {
        for (const o of G.enemies) {
          if (o.dead || o.boss || o.grabbed || o.thrown) continue;
          if (dist2(o.x, o.y, p.x, p.y) < 46 * 46) { gr.victim = o; break; }
        }
      }
      const mul = last ? 2.2 : 1;
      for (const o of G.enemies) {
        if (o.dead || o === gr.victim) continue;
        if (dist2(o.x, o.y, p.x, p.y) < 60 * 60) {
          hurtEnemy(o, throwDmg((8 + o.maxHp * 0.02) * mul), { trueDmg: true });
          if (!o.dead) o.stun = Math.max(o.stun, 0.5);
        }
      }
      if (gr.victim && !gr.victim.dead) {
        hurtEnemy(gr.victim, throwDmg(32 * mul), { trueDmg: true });
      }
      spawnFx('shock', p.x, p.y, '#b07a4a', last ? 90 : 60, { img: 'fx_slam_ring', squash: 0.45 });
      G.screenShake = Math.max(G.screenShake, last ? 12 : 5);
      addHitstop(last ? 0.09 : 0.03, last);
      sfxThrow('roll', { pitch: 0.9 + nowHit * 0.08 });   // 越滾越快的聽覺線索
    }
    if (gr.t >= PERIOD * ROLLS) {
      if (gr.victim && !gr.victim.dead) {
        gr.victim.grabbed = false; gr.victim.spin = null;
        gr.victim.stun = 1.0; gr.victim.flat = { t: 1.0 };
      }
      p.gutRoll = null;
      p.staggerT = Math.max(p.staggerT, 0.2);
    }
  }
  // ---- 拋高接空中炸彈摔：整段自動演出（總監定案），接住轉扛跑 ----
  if (p.tossState) {
    const ts = p.tossState;
    const e = ts.e;
    if (!e || e.dead) { p.tossState = null; }
    else {
      ts.t += dt;
      const k = Math.min(1, ts.t / ts.dur);
      e.grabbed = true; e.stun = 99; e.knockX = 0; e.knockY = 0;
      e.x = ts.x0 + (ts.tx - ts.x0) * k;
      e.y = ts.y0 + (ts.ty - ts.y0) * k;
      // 上升 → 滯頂 → 下落
      e.lift = k < 0.42 ? (k / 0.42) * 110
        : (k < 0.58 ? 110 - (k - 0.42) / 0.16 * 6 : 104 * (1 - Math.pow((k - 0.58) / 0.42, 2)));
      e.spin = { v: 0, t: 0.1, a: k * Math.PI + Math.sin(ts.t * 34) * 0.07 };   // 翻轉＋掙扎
      // 玩家自動追：速度動態求解，鎖定在對方開始下落那一刻抵達
      if (!ts.caught) {
        const dxT = e.x - p.x, dyT = e.y - p.y;
        const distT = Math.hypot(dxT, dyT) || 1;
        const remain = Math.max(0.05, ts.dur * 0.63 - ts.t);
        const spdT = Math.min(1400, distT / remain);
        if (distT > 4) {
          p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + dxT / distT * spdT * dt));
          p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + dyT / distT * spdT * dt));
        }
        if (distT < p.r + e.r + 22 && e.lift > 20) {
          // 接住：直接轉扛跑炸彈摔，高度接續不重新升空
          ts.caught = true;
          p.tossState = null;
          p.airSlam = { e, t: 0, dur: 1.0, slam: false, dizzy: 0, carry: true, bigDrop: true };
          p.pose = null;
          addHitstop(0.06, true);
          sfxThrow('catchAir');
        }
      }
      if (p.tossState && k >= 1) {
        // 沒接到：照樣落地摔一次（招放了就是放了，不退冷卻）
        e.lift = 0; e.grabbed = false; e.spin = null;
        hurtEnemy(e, throwDmg(25), { trueDmg: true });
        if (!e.dead) { e.stun = 1.0; e.flat = { t: 1.0 }; }
        spawnFx('shock', e.x, e.y, '#b07a4a', 110, { img: 'fx_slam_ring', squash: 0.45 });
        G.screenShake = Math.max(G.screenShake, 10);
        sfx('throw_hit');
        p.tossState = null;
      }
    }
  }
  // ---- 飛天炸彈摔：滯空選落點 ----
  if (p.airSlam) {
    const a = p.airSlam;
    const e = a.e;
    if (!e || e.dead) { p.airSlam = null; }
    else {
      a.t += dt;
      if (a.x0 === undefined) { a.x0 = p.x; a.y0 = p.y; }
      const kA = Math.min(1, a.t / a.dur);
      // 扛跑（總監定案）：腳踩在地上跑去選落點，只有最後 0.2 秒跳起來——落差才賣得出去
      // 扛跑版：腳踩在地上跑去選落點，只有最後 0.2 秒跳起來——落差才賣得出去。
      // 高跳版（站定炸彈摔）：一開始就升空、在頂點停久一點，玩家才有時間走位選落點。
      let jumpK, peak;
      if (a.highJump) {
        jumpK = Math.min(1, kA / 0.88);          // 前 88% 都在空中，最後 12% 砸下來
        peak = 150;                               // 62 → 150，跳得明顯高
      } else {
        jumpK = kA > 0.82 ? (kA - 0.82) / 0.18 : 0;
        peak = a.bigDrop ? 104 : 62;
      }
      a.h = jumpK <= 0 ? 0
        : a.highJump
          ? (jumpK < 0.22 ? peak * (jumpK / 0.22)                       // 0.22 起跳
             : jumpK < 0.78 ? peak                                       // 中段整整停在頂點
             : peak * Math.max(0, 1 - Math.pow((jumpK - 0.78) / 0.22, 2)))
          : (jumpK < 0.5 ? peak * (jumpK / 0.5) : peak * Math.max(0, 1 - Math.pow((jumpK - 0.5) / 0.5, 2)));
      p.iframe = Math.max(p.iframe, 0.08);   // 人在空中，地面的敵人碰不到（不是衝刺無敵）
      // 滯空位移上限：這是重新定位，不是傳送
      const dx0 = p.x - a.x0, dy0 = p.y - a.y0;
      const dd0 = Math.hypot(dx0, dy0);
      if (dd0 > 260) { p.x = a.x0 + dx0 / dd0 * 260; p.y = a.y0 + dy0 / dd0 * 260; }
      e.grabbed = true; e.stun = 99;
      e.x = p.x; e.y = p.y - 30 - a.h * 0.35;
      e.knockX = 0; e.knockY = 0;
      if (a.slam || a.t >= a.dur) doAirSlam(a);
    }
  }
  // ---- 迴旋抓摔：掄人 ----
  // 注意條件要排除 hold 模式：擒抱持有走上面自己的區塊，
  // 這裡混進去會雙重處理（無條件扣血＋自動扔出）——總監抱怨的「一直扣血、會放開」就是這個
  else if (p.grabState && p.grabState.mode !== 'hold') {
    const g = p.grabState;
    const e = g.e;
    if (e.dead) { p.grabState = null; }
    else {
      g.t += dt;
      // 越轉越快：等速旋轉永遠讀不出「掄起來了」——轉速、呼嘯音高一起爬升
      if (g.super) {
        const kS = Math.min(1, g.t / g.dur);
        g.spinSpd = (g.spinSpd >= 0 ? 1 : -1) * (5 + 11 * kS);
        g.whooshT = (g.whooshT || 0) - dt;
        if (g.whooshT <= 0) { g.whooshT = 0.4; sfx('wind', { pitch: 0.85 + 0.5 * kS, vol: 0.8 }); }
      }
      g.ang += g.spinSpd * dt;
      e.x = p.x + Math.cos(g.ang) * g.orbitR;
      e.y = p.y + Math.sin(g.ang) * g.orbitR;
      e.x = Math.max(e.r, Math.min(ARENA.w - e.r, e.x));
      e.y = Math.max(e.r, Math.min(ARENA.h - e.r, e.y));
      g.tick -= dt;
      if (g.tick <= 0) {
        g.tick = 0.12;
        // 被掄的人是武器：傷害看他的體重（最大生命）
        let orbHit = false;
        for (const o of G.enemies) {
          if (o.dead || o === e) continue;
          const rr = o.r + e.r + 4;
          if (dist2(o.x, o.y, e.x, e.y) < rr * rr) {
            orbHit = true;
            hurtEnemy(o, throwDmg(4 + e.maxHp * 0.04) * (g.super ? 1.5 : 1), { trueDmg: true });
            if (!o.dead) {
              const a = Math.atan2(o.y - e.y, o.x - e.x);
              o.knockX += Math.cos(a) * 150; o.knockY += Math.sin(a) * 150;
            }
          }
        }
        // 迴旋抓摔同規則：被掄的人撞到別人才扣血
        if (orbHit) hurtEnemy(e, throwDmg(3), { trueDmg: true, noLifesteal: true });
        if (e.dead) { p.grabState = null; return; }
      }
      if (g.t >= g.dur) {
        // 扔出去：朝最近的其他敵人，沒有就順著旋轉方向
        e.grabbed = false; e.stun = 0;
        let tx = Math.cos(g.ang + 1.2), ty = Math.sin(g.ang + 1.2);
        let best = null, bd = 1e18;
        for (const o of G.enemies) {
          if (o.dead || o === e) continue;
          const dd = dist2(o.x, o.y, p.x, p.y);
          if (dd < bd) { bd = dd; best = o; }
        }
        if (best) {
          const dd = Math.hypot(best.x - e.x, best.y - e.y) || 1;
          tx = (best.x - e.x) / dd; ty = (best.y - e.y) / dd;
        }
        e.thrown = { vx: tx * (g.super ? 1000 : 780), vy: ty * (g.super ? 1000 : 780),
          t: g.super ? 0.7 : 0.55, decay: g.super ? 2.0 : 2.4 };
        e.spin = { v: (g.spinSpd >= 0 ? -16 : 16), t: g.super ? 0.7 : 0.55, a: 0 };
        sfx('throw_hit');
        addHitstop(0.09, true);
        hurtEnemy(e, throwDmg((g.super ? 25 : 10) + e.maxHp * (g.super ? 0.25 : 0.10)), { trueDmg: true });
        if (g.super) {
          spawnFx('explode', e.x, e.y, '#c2703c', 150);
          G.screenShake = Math.max(G.screenShake, 14);
          for (const o of G.enemies) {
            if (o.dead || o === e) continue;
            if (dist2(o.x, o.y, e.x, e.y) < 150 * 150) {
              hurtEnemy(o, throwDmg(20), { trueDmg: true });
              if (!o.dead) o.stun = Math.max(o.stun, 0.8);
            }
          }
        }
        p.grabState = null;
      }
    }
  }

  // ---- 衝刺 ----
  if (p.dashState) {
    const s = p.dashState;
    if (s.id === 'rebound' && s.t <= 0 && s.reboundLeft > 0) {
      // 撞到場邊（或跑滿）就折返，回程加速再輾一次
      s.reboundLeft--;
      s.dx = -s.dx; s.dy = -s.dy;
      s.spd *= s.backMul || 1.35;
      s.t = s.dur0 * 0.9;
      G.enemies.forEach(o => { o.hitByDash = false; });   // 回程重新計一次命中
      spawnFx('slide', p.x, p.y, '#c98a3c', 44, { angle: Math.atan2(s.dy, s.dx) });
      sfx('dash');
    }
    if (s.pre && s.pre > 0) {
      // 衝撞的預備拍：重心後撤（8px），給眼睛一條基準線
      s.pre -= dt;
      p.x -= s.dx * 60 * dt; p.y -= s.dy * 60 * dt;
      pushOutOfWalls(p);
      return;
    }
    s.t -= dt;
    if (s.dur0 === undefined) s.dur0 = s.t + dt;
    // 企鵝滑行曲線：起步爆發、後段滑行減速——是「滑」出去不是「閃」過去。
    // 衝撞類（accel）相反：前 25% 從三成速加速到滿速，之後定速——是「撞」進去。
    const slideK = Math.max(0, s.t / s.dur0);
    const runK = 1 - slideK;   // 0→1 經過時間比
    const spdNow = s.accel
      ? s.spd * Math.min(1, 0.33 + runK / 0.25 * 0.67)
      : s.spd * (0.55 + 0.75 * slideK);
    // ★ 途中可以轉彎（總監 2026-08-04：像開車一樣，不要 0～5 這段距離都改不了路徑）。
    //   吸附鎖定的目標會持續追蹤（他會動，你也該跟著轉）；沒鎖定就吃當下的方向鍵。
    //   轉向速率有上限——能修正，但不能原地掉頭，那樣衝刺就沒有「賭一把」的重量了。
    {
      let wx = 0, wy = 0;
      if (s.lockOn && !s.lockOn.dead && !s.lockOn.thrown) {
        wx = s.lockOn.x - p.x; wy = s.lockOn.y - p.y;
      } else {
        const k = G.keys || {};
        if (k['a'] || k['arrowleft']) wx -= 1;
        if (k['d'] || k['arrowright']) wx += 1;
        if (k['w'] || k['arrowup']) wy -= 1;
        if (k['s'] || k['arrowdown']) wy += 1;
      }
      const wl = Math.hypot(wx, wy);
      if (wl > 0.001) {
        const want = Math.atan2(wy / wl, wx / wl);
        const cur = Math.atan2(s.dy, s.dx);
        const turn = Math.max(-4.2 * dt, Math.min(4.2 * dt, angDiff(want, cur)));
        const na = cur + turn;
        s.dx = Math.cos(na); s.dy = Math.sin(na);
      }
    }
    p.x += s.dx * spdNow * dt;
    p.y += s.dy * spdNow * dt;
    // 飛奔金臂勾的寬走廊命中：手臂是整條橫桿（chargeW），不是貼身半徑
    if (s.id === 'clothesline') {
      const aL = Math.atan2(s.dy, s.dx);
      for (const e of G.enemies) {
        if (e.dead || e.grabbed || e.thrown || e.hitByDash) continue;
        const relX = e.x - p.x, relY = e.y - p.y;
        const along = relX * s.dx + relY * s.dy;
        const side = Math.abs(-relX * s.dy + relY * s.dx);
        if (along < -6 || along > 42 || side > (s.chargeW || 48) + e.r) continue;
        e.hitByDash = true; s.hitAny = true;
        hurtEnemy(e, techDmg(s.chargeDmg || 55) * (s.boost || 1), { crit: chance(0.35), fromAngle: aL });
        if (!e.dead) {
          if (e.boss) {
            e.knockX += Math.cos(aL) * 76; e.knockY += Math.sin(aL) * 76;
            e.stun = Math.max(e.stun, (s.chargeStun || 1) * 0.4);
          } else {
            e.grabbed = true; e.stun = 99;
            s.latched.push({ e, t: 0.12, off: (s.latched.length % 2 ? -1 : 1) * (10 + s.latched.length * 4) });
          }
          e.hitSquash = Math.max(e.hitSquash || 0, 0.24);
        }
        s.spd *= 0.75;
        sfx('throw_hit');
        addHitstop(s.firstHitDone ? 0 : 0.09, true);
        s.firstHitDone = true;
      }
    }
    // 掛在臂彎上的人：跟著衝，0.12 秒後甩出去翻過去
    if (s.latched && s.latched.length) {
      const aL2 = Math.atan2(s.dy, s.dx);
      for (const L of s.latched) {
        if (L.done || L.e.dead) continue;
        L.t -= dt;
        L.e.x = p.x + s.dx * 26 - s.dy * L.off;
        L.e.y = p.y + s.dy * 26 + s.dx * L.off;
        if (L.t <= 0 || s.t <= 0.02) {
          L.done = true;
          L.e.grabbed = false;
          L.e.thrown = { vx: Math.cos(aL2) * 820, vy: Math.sin(aL2) * 820, t: 0.6, decay: 2.0 };
          L.e.spin = { v: (s.dx >= 0 ? -14 : 14), t: 0.45, a: 0 };
          L.e.stun = Math.max(L.e.stun, s.chargeStun || 1);
        }
      }
    }
    // 冰滑痕
    s.trailT = (s.trailT || 0) - dt;
    if (s.trailT <= 0) {
      s.trailT = 0.03;
      spawnFx('slide', p.x - s.dx * 10, p.y + 8, '#cfeaf5', 10, { angle: Math.atan2(s.dy, s.dx) });
    }
    const c = s.carried;
    if (c && !c.dead) {
      c.x = p.x + s.dx * (p.r + c.r + 2);
      c.y = p.y + s.dy * (p.r + c.r + 2);
    }
    // 沿路碰撞
    for (const e of G.enemies) {
      if (e.dead || e === c || e.thrown || e.grabbed) continue;
      if (s.id === 'shadow') break;   // 影遁：穿過所有人，零互動
      const rr = p.r + e.r + 4;
      if (dist2(e.x, e.y, p.x, p.y) < rr * rr) {
        if (s.id === 'suplex') {
          // 擒抱：抓住第一個非頭目，進入「持有」——之後移動＝掄甩、站定＝炸彈摔
          if (!e.boss) {
            sfx('grab');
            addBeat('D');
            e.grabbed = true; e.stun = 99;
            p.grabState = { e, mode: 'hold', t: 0, dur: MOVE_MAP.suplex_grab.holdDur,
              ang: Math.atan2(e.y - p.y, e.x - p.x), orbitR: 46, spinSpd: 8.5, tick: 0 };
            p.dashState = null;
          } else {
            addBeat('D');
            hurtEnemy(e, throwDmg(24) * (s.boost || 1), { trueDmg: true });
            e.stun = Math.max(e.stun, 0.6);
            p.dashState = null;
          }
          break;
        } else if (s.id === 'iai') {
          // 拔刀斬：路徑上全部斬過，高爆擊
          if (!e.hitByDash) {
            e.hitByDash = true; s.hitAny = true;
            addBeat('D');
            hurtEnemy(e, techDmg(30) * (s.boost || 1), { crit: chance(0.5), fromAngle: Math.atan2(s.dy, s.dx) });
            sfx('hit_blade');
          }
        } else if (s.id === 'tackle' && !c && !e.boss) {
          // 擒抱衝刺：第一個撞上的非頭目扛著走
          s.carried = e; s.hitAny = true;
          e.grabbed = true; e.stun = 99;
        } else if (s.id === 'grab_spin') {
          if (!e.boss) {
            startGrab(e, s.grabDef);
            p.dashState = null;
          } else {
            hurtEnemy(e, throwDmg(30) * (s.boost || 1), { trueDmg: true });
            e.stun = Math.max(e.stun, 0.8 * (grabMaster() ? 1.5 : 1));
            spawnFx('shock', e.x, e.y, '#c2703c', 70);
            p.dashState = null;
          }
          break;
        } else if (s.id === 'ddt' && !e.hitByDash && !e.boss) {
          // 勾住頭帶著跑，然後坐倒把頭釘進地板——單體處決，全表最重頓幀
          e.hitByDash = true; s.hitAny = true;
          e.grabbed = true; e.stun = 99;
          p.ddtState = { e, t: 0, dx: s.dx, dy: s.dy };
          p.dashState = null;
          p.pose = { type: 'ddtp', ang: Math.atan2(s.dy, s.dx), t: 0, dur: 0.34, prio: 1 };
          sfx('grab');
          break;
        } else if (s.id === 'tobigeri' && !e.hitByDash) {
          // 飛蹴穿人：只給極小擊退（釘身），被踢中的人留在原地變成下一個路障
          e.hitByDash = true; s.hitAny = true;
          const aK = Math.atan2(s.dy, s.dx);
          hurtEnemy(e, techDmg(s.kickDmg * Math.pow(s.falloff, s.hitIdx)) * (s.boost || 1),
            { crit: true, fromAngle: aK });
          s.hitIdx++;
          if (!e.dead) {
            e.stun = Math.max(e.stun, e.boss ? s.kickStun * 0.4 : s.kickStun);
            e.knockX += Math.cos(aK) * s.kickKnock;
            e.knockY += Math.sin(aK) * s.kickKnock;
            e.hitSquash = Math.max(e.hitSquash || 0, 0.26);
          }
          spawnFx('spark', e.x, e.y, '#ffd44a', e.r, { angle: aK });
          addHitstop(s.firstHitDone ? 0.03 : 0.07, true);
          s.firstHitDone = true;
          s.spd *= s.slowPerHit;   // 越飛越慢＝中止有預告，不是系統突然抽掉控制權
          s.pierceLeft -= e.boss ? 99 : (e.elite ? 2 : 1);
          if (s.pierceLeft <= 0) {
            s.t = 0;
            spawnFx('explode', p.x, p.y, '#ffd44a', 60);
            G.screenShake = Math.max(G.screenShake, 9);
            sfx('hit_heavy');
            p.staggerT = Math.max(p.staggerT, 0.18);   // 往人堆裡飛是要付代價的
            break;
          }
        } else if (s.id === 'rebound' && !e.hitByDash) {
          // 跑繩輾過去：橫向撥開（你是從他們中間輾過去的，不是往後撞飛）
          e.hitByDash = true; s.hitAny = true;
          const aR = Math.atan2(s.dy, s.dx);
          hurtEnemy(e, techDmg(s.chargeDmg || 34) * (s.boost || 1), { fromAngle: aR });
          if (!e.dead) {
            const sideSign = ((e.x - p.x) * -s.dy + (e.y - p.y) * s.dx) >= 0 ? 1 : -1;
            const kb = e.boss ? 40 : (s.chargeKnock || 200);
            e.knockX += -s.dy * sideSign * kb; e.knockY += s.dx * sideSign * kb;
            e.stun = Math.max(e.stun, s.chargeStun || 0.5);
            e.hitSquash = Math.max(e.hitSquash || 0, 0.24);
          }
          sfx('hit_blunt');
          addHitstop(0.04, false);
        } else if (s.id === 'clothesline' && !e.hitByDash) {
          // 飛奔金臂勾：金臂勾的定義是把人的腳掀離地面——掛到的人翻著飛出去，
          // 不是被推走。撞一個掉一次速（被人牆拖住的重量感）。
          e.hitByDash = true; s.hitAny = true;
          const aL = Math.atan2(s.dy, s.dx);
          hurtEnemy(e, techDmg(s.chargeDmg || 55) * (s.boost || 1), { crit: chance(0.35), fromAngle: aL });
          if (!e.dead) {
            if (e.boss) {
              e.knockX += Math.cos(aL) * 76; e.knockY += Math.sin(aL) * 76;
              e.stun = Math.max(e.stun, (s.chargeStun || 1) * 0.4);
            } else {
              // 先掛在臂彎上帶走一小段，才甩出去翻——這是金臂勾跟爆炸的差別
              e.grabbed = true; e.stun = 99;
              s.latched.push({ e, t: 0.12, off: (s.latched.length % 2 ? -1 : 1) * (10 + s.latched.length * 4) });
            }
            e.hitSquash = Math.max(e.hitSquash || 0, 0.24);
          }
          s.spd *= 0.75;
          sfx('throw_hit');
          addHitstop(s.hitAny && s.firstHitDone ? 0 : 0.09, true);
          s.firstHitDone = true;
        } else if (s.id === 'seiken' && !e.hitByDash) {
          // 飛込正拳：只打碰到的第一個敵人，釘住，下一拳必定爆擊
          e.hitByDash = true; s.hitAny = true;
          addBeat('D');
          const da = Math.atan2(s.dy, s.dx);
          hurtEnemy(e, techDmg(26) * (s.boost || 1), { fromAngle: da });
          if (!e.dead) {
            e.stun = Math.max(e.stun, 0.5);
            e.knockX += Math.cos(da) * 300; e.knockY += Math.sin(da) * 300;
          }
          p.guaranteedCrit = true;
          spawnFx('spark', e.x, e.y, '#ffd44a', 22, { angle: da });
          p.dashState = null;
          break;
        } else if (!e.hitByDash) {
          e.hitByDash = true; s.hitAny = true;
          addBeat('D');
          hurtEnemy(e, techDmg(s.id === 'tackle' ? 20 : 8) * (s.boost || 1), { trueDmg: true });
          if (!e.dead) {
            const a = Math.atan2(e.y - p.y, e.x - p.x);
            const kb = s.id === 'tackle' ? 220 : 140;
            e.knockX += Math.cos(a) * kb; e.knockY += Math.sin(a) * kb;
          }
        }
      }
    }
    if (!p.dashState) { G.enemies.forEach(e => { e.hitByDash = false; }); return; }
    // 撞牆與收尾
    const hitObstacle = pushOutOfWalls(p);
    const wallHit = hitObstacle || p.x <= p.r + 4 || p.x >= ARENA.w - p.r - 4 || p.y <= p.r + 4 || p.y >= ARENA.h - p.r - 4;
    p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x));
    p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y));
    if (wallHit || s.t <= 0) {
      if (s.id === 'tackle') {
        if (c && !c.dead) {
          c.grabbed = false; c.stun = 0;
          if (wallHit) {
            // 撞碎在牆上：吃自身三成生命的傷 + 周圍震盪
            hurtEnemy(c, throwDmg(20 + c.maxHp * 0.30) * (s.boost || 1), { trueDmg: true });
            if (!c.dead) c.stun = 1.2 * (grabMaster() ? 1.5 : 1);
            spawnFx('explode', c.x, c.y, '#a33c3c', 120);
            G.screenShake = Math.max(G.screenShake, 12);
            for (const o of G.enemies) {
              if (o.dead || o === c) continue;
              if (dist2(o.x, o.y, c.x, c.y) < 130 * 130) {
                hurtEnemy(o, techDmg(22) * (s.boost || 1), { trueDmg: true });
                if (!o.dead) o.stun = Math.max(o.stun, 1.0);
              }
            }
          } else {
            hurtEnemy(c, throwDmg(15) * (s.boost || 1), { trueDmg: true });
            if (!c.dead) c.stun = 0.6;
          }
        }
        if (!s.hitAny) {
          p.staggerT = 0.6;   // 撞空的代價
          addDmgNum(p.x, p.y - 24, '撞空', '#9aa4b2');
        }
      } else if (s.id === 'knee') {
        kneeImpact();
      } else if (s.id === 'roll') {
        rollSweep();
      } else if (s.id === 'iai') {
        // 收刀硬直：拔刀術的合約，斬沒斬中都要付
        p.staggerT = 0.5;
        p.sheathing = 0.5;   // 收刀動作演出
        addDmgNum(p.x, p.y - 24, '收刀', '#9aa4b2');
      }
      G.enemies.forEach(e => { e.hitByDash = false; });
      p.dashState = null;
    }
  }
}

/* ---------- 節拍：命中才算數 ----------
   拍子不是靠站著或走路的時間，是靠「在那個狀態下打中敵人」：
   S＝原地打中、M＝移動中打中、D＝衝刺技打中。
   光走不打、光站不打，都不會累積——連段是打出來的。
*/
function addBeat(type, auto, swingId) {
  const p = G.player;
  if (p.dead) return;
  // 同一次揮擊掃到好幾個人只算一拍（本來就該這樣）；
  // 不同次揮擊一律各算一拍，不管間隔多短——那是玩家真的又打了一下。
  if (swingId !== undefined) {
    if (p.beatSwing === swingId) return;
    p.beatSwing = swingId;
  } else if (p.beatCd > 0) return;
  // 連段樹：這個動作剛好補滿某條連段的最後一格 → 當場變招，這一拍不入譜。
  // auto=true（站樁技/移動技自動命中）只能鋪前綴——收尾那一下必須是玩家自己打的，
  // 連段才是玩家「做出來」的，不是自己噴出來的。
  // comboFiring 防遞迴：連段招本身命中時不會再去觸發連段。
  if (!auto && !p.comboFiring && (type === 'S' || type === 'M')) {
    const c = matchCombo(type);
    if (c) {
      // 銜接：觸發的那一下命中發生在前一招接觸幀中段——立刻覆寫 pose 會看成「突然變招」。
      // 排隊到 0.18 秒（接觸幀播完）再出，玩家看到的才是「手刀打完→順勢頭槌」。
      const cdOk = c.sig ? (p.ougiCd || 0) <= 0 : (p.comboCd || 0) <= 0;
      if (cdOk && p.pose && p.pose.prio >= 0 && p.pose.t < 0.18) {
        p.pendingCombo = c; p.pendingComboWait = 0.12;
        p.beatCd = 0.4; p.beatT = 0;
        return;
      }
      p.comboFiring = true;
      const fired = castCombo(c);
      p.comboFiring = false;
      if (fired) { p.comboStep = 0; p.beatCd = 0.4; return; }
      const cdLeft = c.sig ? (p.ougiCd || 0) : (p.comboCd || 0);
      if (cdLeft > 0.15) {
        if ((p.comboCdMsgT || 0) <= 0) {
          p.comboCdMsgT = 1.2;
          addDmgNum(p.x, p.y - 46, c.name + ' 還有 ' + cdLeft.toFixed(1) + 's', '#8a795e');
        }
      } else if ((p.comboCdMsgT || 0) <= 0) {
        // 冷卻好了卻還是沒出招＝抓不到／打不到目標。以前這條路連一個字都沒有，
        // 而 HUD 明明白白寫著「按 SPACE ＝ 螺旋摔投」——玩家按下去毫無反應，
        // 只會認定這招是壞的，然後不再相信畫面上任何一段說明文字。
        p.comboCdMsgT = 1.0;
        addDmgNum(p.x, p.y - 46, c.name + ' 太遠了', '#8a795e');
      }
    }
  }
  // 同一瞬間的多段命中只記一拍。連段進行中放寬節流，否則加速後會卡在這個閘門上。
  p.beatCd = (p.comboStep || 0) > 0 ? 0.22 : 0.4;
  p.beatT = 0;      // 連段窗口重新計時
  p.beatLog.push(type);
  // 連段的節奏要聽得到看得到：拍子踩進前綴就「登」一聲、pip 彈一下；
  // 前綴湊滿改放上行雙音——耳朵先知道「下一下會變招」。
  {
    let prog = 0, full = false;
    for (const c of comboList()) {
      const need = c.seq.length - 1;
      for (let k = Math.min(need, p.beatLog.length); k > prog - 1 && k >= 1; k--) {
        const tail = p.beatLog.slice(p.beatLog.length - k);
        let okp = true;
        for (let i = 0; i < k; i++) if (tail[i] !== c.seq[i]) { okp = false; break; }
        if (okp) { if (k > prog) prog = k; if (k === need) full = true; break; }
      }
    }
    p.beatPopT = 0.22;
    // ★ 舊寫法是 full ? 2 : prog。因為每個職業都有 need=1 的連段（摔角手 SD／MD），
    //   任何一拍落地就 full=true 直接跳 2——實測 comboStep===1 的佔比是 0.0%，
    //   註解裡寫的「一二三越打越快」從來沒有發生過，真正跑的是 1× / 3.1× 二元開關。
    //   改成：full 只在「湊滿兩拍以上的前綴」才算，中間那一階才進得去。
    p.comboStep = Math.min(2, full && prog >= 2 ? 2 : prog);
    if (full && !p.comboReadyCue) { p.comboReadyCue = true; sfxComboReady(); }
    else if (!full) { p.comboReadyCue = false; if (prog >= 1) sfxBeat(prog); }
  }
  if (p.beatLog.length > 3) p.beatLog.shift();
  // 同拍共鳴：三拍同型自動觸發輕增益——喜歡「一直移動一直打」的玩家不用搓招也有獎勵
  if ((p.resonCd || 0) <= 0 && p.beatLog.length === 3) {
    const rs = p.beatLog.join('');
    if (rs === 'MMM') {
      p.resonCd = 5; p.flowT = 4;
      addDmgNum(p.x, p.y - 40, resonName('MMM', '行雲'), '#8fd4e0', true);
    } else if (rs === 'SSS') {
      p.resonCd = 5; p.chargeHits = 3;
      addDmgNum(p.x, p.y - 40, resonName('SSS', '蓄勢'), '#e8964a', true);
    }
  }
  // 連衝（同拍共鳴）：連續三次衝刺各命中至少一下（7 秒窗）。
  // 不看拍譜——拍譜會被衝刺清掉，D 三連在譜上永遠湊不齊。
  if (type === 'D' && !p.dashBeatCounted) {
    p.dashBeatCounted = true;
    p.dashChain = (p.dashChainT || 0) > 0 ? (p.dashChain || 0) + 1 : 1;
    p.dashChainT = 7;
    if (p.dashChain >= 3) {
      p.dashChain = 0; p.dashChainT = 0;
      p.dashCd = Math.max(0, p.dashCd - 2.5);
      addDmgNum(p.x, p.y - 40, resonName('DASH3', '連衝'), '#ffd44a', true);
    }
  }
  // 三段勁：最近三拍湊齊 站、移、衝 各一（順序不拘）→ 自動爆出一圈氣勁小招
  if (p.triCd <= 0 && p.beatLog.length === 3) {
    const s = [...p.beatLog].sort().join('');
    if (s === 'DMS') {
      p.triCd = 6;
      spawnFx('shock', p.x, p.y, '#ffd44a', 115);
      addDmgNum(p.x, p.y - 40, resonName('TRI', '三段勁'), '#ffd44a', true);
      addHitstop(0.06, true);
      sfx('wind');
      for (const e of G.enemies) {
        if (e.dead) continue;
        if (dist2(e.x, e.y, p.x, p.y) < 115 * 115) {
          hurtEnemy(e, techDmg(18), { trueDmg: true });
          if (!e.dead) {
            const a = Math.atan2(e.y - p.y, e.x - p.x);
            e.knockX += Math.cos(a) * 140; e.knockY += Math.sin(a) * 140;
          }
        }
      }
    }
  }
}

/* 同拍共鳴／三段勁的職業版顯示名：查 RESON_NAME 覆寫表，沒有就用通用名 */
function resonName(key, fallback) {
  const t = G.char && RESON_NAME[G.char.id];
  return (t && t[key]) || fallback;
}

/* 依玩家當下的行動狀態決定這次武器命中算哪一拍 */
function beatFromState() {
  const p = G.player;
  if (p.dashState) return 'D';
  // ★ 舊寫法用 stillActive()／movingActive()，那兩個各自有 0.5 秒與 0.15 秒的門檻，
  //   中間有一段「兩個都不是」的死區——實測佔 36% 的時間，打中了不記任何拍。
  //   總監回報「連續三個手刀但頭上的框框沒有增加」就是踩到這個。
  //   記拍改成單純的二分：打中的當下有沒有在動。沒有隱形計時器，玩家才預測得到。
  //   （stillActive／movingActive 維持原樣不動——站樁技與移動技的觸發門檻是另一回事，
  //     那個 0.5 秒是「站穩了才發動」的設計，不該跟記拍混為一談。）
  return (p.vx || p.vy) ? 'M' : 'S';
}

/* ---------- 奧義 ----------
   節拍序列湊齊職業指令時，Space 打出的不是衝刺技而是奧義。
*/
function beatsMatch(log, seq) {
  if (log.length < seq.length) return false;
  const tail = log.slice(-seq.length);
  return seq.every((b, i) => tail[i] === b);
}
/* 延伸技（總監定案：有冷卻高威力，共用 8 秒） */
/* ---------- 斬痕（劍豪的破壞語言）----------
   摔角手的破壞是動能（轟飛/撞牆/速度放大），刀不能抄那套：
   刀的破壞是累積的——先留痕，痕夠深才一刀兩斷。
   拔刀斬既有的「延遲連斬」就是這條線的第一句話，這裡把它展開成完整系統。
*/
function addCuts(e, k, srcAng) {
  if (!e || e.dead || !k) return;
  // 收刀窗內斬痕加倍：刀已出鞘、鯉口已切、刀還沒回去——這一秒每一刀都咬得更深
  const p = G.player;
  const dbl = (p && p.iaiPhase) ? 2 : 1;
  e.cuts = Math.min(5, (e.cuts || 0) + k * dbl);
  e.cutT = 4;
  e.cutAng = srcAng !== undefined ? srcAng : (e.cutAng || 0);
  if (e.cuts >= 3) severCheck(e);
}

/* 断ち：斬痕滿了就裂開。頭目斬不斷，改成斬鐵（每道痕掛流血） */
function severCheck(e, bonus, force) {
  if (!e || e.dead) return false;
  const cuts = Math.min(5, (e.cuts || 0) + (bonus || 0));
  if (cuts < 3 && !force) return false;
  const p = G.player;
  const big = e.boss || e.elite;
  if (big) {
    // 斬鐵：斬不斷的對手改成磨——每道痕一層流血，断ち轉成單體集中傷害
    hurtEnemy(e, techDmg(24 * cuts), { trueDmg: true, crit: true });
    e.bleed = Math.max(e.bleed || 0, 6 * cuts * liveDamageMult());
    e.bleedTime = 3;
    spawnFx('spark', e.x, e.y, '#ffffff', e.r, { angle: e.cutAng || 0 });
  } else {
    hurtEnemy(e, techDmg(20 * cuts), { trueDmg: true, crit: true });
    // 十字刀光：劍豪版的「撞牆震波」——但它會把斬痕傳染出去
    spawnFx('shock', e.x, e.y, '#e8f2ff', 90, { img: 'fx_ougi_cross' });
    for (const o of G.enemies) {
      if (o.dead || o === e) continue;
      if (dist2(o.x, o.y, e.x, e.y) < 90 * 90) {
        hurtEnemy(o, techDmg(14), { trueDmg: true });
        if (!o.dead) { o.cuts = Math.min(5, (o.cuts || 0) + 1); o.cutT = 4; }
      }
    }
  }
  e.cuts = 0; e.cutT = 0;
  e.severFlash = 0.3;
  addHitstop(0.1, true);
  G.screenShake = Math.max(G.screenShake, 10);
  sfxSever();
  addDmgNum(e.x, e.y - e.r - 12, '断', '#e8f2ff', true);
  return true;
}

/* 延伸技通用執行器：資料驅動。
   摔角手的專屬摔投走 switch 的硬編碼分支，其他職業用 EXT_MOVES 表（kind + params）即可。 */
function castExtension(move, victim) {
  const p = G.player;
  p.extCd = 8;
  // 資料驅動的延伸技：查表 → 走既有的 castOugi kind 管線
  const def = (typeof EXT_MOVES !== 'undefined') && EXT_MOVES[move];
  if (def) {
    const okE = castOugi({ kind: def.kind, params: def.params }, victim);
    if (okE) {
      G.ougiBanner = { name: def.name, t: 1.2 };
      G.screenShake = Math.max(G.screenShake, def.shake || 11);
      addHitstop(def.hitstop || 0.1, true);
      G.hitstopEcho = { delay: 0.06, dur: 0.05 };
      if (def.sfx) sfx(def.sfx);
      else sfx('ougi_cast');
      p.comboSettle = 0.35;
    } else p.extCd = 0;
    return okE;
  }
  switch (move) {
    case 'clothesline': {
      const ok1 = castOugi({ kind: 'charge_line',
        params: { dmg: 90, len: 260, width: 96, knock: 380, stun: 1.0, pose: 'lariat', chargeSpd: 820 } });
      if (ok1) { G.ougiBanner = { name: '飛奔金臂勾', t: 1.2 }; sfx('ougi_cast'); }
      else p.extCd = 0;
      return ok1;
    }
    case 'running_ddt': {
      // 衝過去勾住頭帶著跑，坐倒把頭釘進地板——單體處決，全表最重頓幀
      const dirD = dashDir();
      p.dashState = { id: 'ddt', dx: dirD.x, dy: dirD.y, t: 180 / 700, spd: 700, accel: true, boost: 1 };
      G.ougiBanner = { name: '衝刺DDT', t: 1.2 };
      sfx('dash');
      return true;
    }
    case 'gut_roll': {
      // 抱腰翻滾：撲抱住滾出去，滾四圈四段 hit，壓到路過的一起痛
      const mx0 = p.lastMoveX || (p.face > 0 ? 1 : -1), my0 = p.lastMoveY || 0;
      const ml0 = Math.hypot(mx0, my0) || 1;
      p.gutRoll = { t: 0, dx: mx0 / ml0, dy: my0 / ml0, victim: null, hits: 0, ang: 0 };
      G.ougiBanner = { name: '抱腰翻滾', t: 1.2 };
      sfx('dash');
      return true;
    }
    case 'toss_powerbomb': {
      // military press 拋高＋pop-up 空中接：整段自動演出（總監定案），接住轉扛跑炸彈摔
      let v = victim && !victim.dead && !victim.boss ? victim : null;
      if (!v) {
        let bd = 170 * 170;
        for (const e2 of G.enemies) {
          if (e2.dead || e2.boss || e2.thrown) continue;
          const dd2 = dist2(e2.x, e2.y, p.x, p.y);
          if (dd2 < bd) { bd = dd2; v = e2; }
        }
      }
      if (!v) { p.extCd = 0; return false; }
      const dirT = dashDir();
      v.flat = null; v.reel = null; v.grabbed = true; v.stun = 99;
      p.tossState = { e: v, t: 0, dur: 0.52, x0: v.x, y0: v.y,
        tx: Math.max(v.r, Math.min(ARENA.w - v.r, p.x + dirT.x * 240)),
        ty: Math.max(v.r, Math.min(ARENA.h - v.r, p.y + dirT.y * 240)), caught: false };
      p.pose = { type: 'press', ang: Math.atan2(dirT.y, dirT.x), t: 0, dur: 0.3, prio: 1 };
      G.ougiBanner = { name: '拋高炸彈摔', t: 1.2 };
      sfxThrow('press');
      return true;
    }
  }
  p.extCd = 0;
  return false;
}

/* 掄甩滿三秒按 C：螺旋摔投——一直掄累積的東西在這裡兌現 */
function castSpiralToss() {
  const p = G.player, g = p.grabState;
  if (!g || !g.e || g.e.dead) return false;
  const e = g.e;
  const tx0 = Math.cos(g.ang + (g.spinSpd >= 0 ? Math.PI / 2 : -Math.PI / 2));
  const ty0 = Math.sin(g.ang + (g.spinSpd >= 0 ? Math.PI / 2 : -Math.PI / 2));
  e.grabbed = false;
  e.thrown = { vx: tx0 * 1000, vy: ty0 * 1000, t: 0.7, decay: 2.0 };
  e.spin = { v: (g.spinSpd >= 0 ? -16 : 16), t: 0.7, a: 0 };
  hurtEnemy(e, throwDmg(25 + e.maxHp * 0.25), { trueDmg: true });
  for (const o of G.enemies) {
    if (o.dead || o === e) continue;
    if (dist2(o.x, o.y, p.x, p.y) < 140 * 140) {
      hurtEnemy(o, throwDmg(20), { trueDmg: true });
      if (!o.dead) o.stun = Math.max(o.stun, 0.8);
    }
  }
  spawnFx('explode', p.x, p.y, '#c2703c', 150);
  G.ougiBanner = { name: '螺旋摔投', t: 1.3 };
  G.screenShake = Math.max(G.screenShake, 14);
  addHitstop(0.1, true);
  sfxThrow('spiral');
  p.staggerT = Math.max(p.staggerT, 0.35 + 0.65 * (g.dizzy || 0));
  p.grabState = null;
  return true;
}

/* 這個職業的連段表：沒定義就把 OUGI 當成單條招牌連段（語意相同） */
function comboList() {
  const p = G.player;
  // 有盤面就列盤面（玩家自己組的），沒有才退回職業預設表
  if (p && p.comboBoard) {
    const out = [];
    for (const row of (p.boardRows || [])) {
      for (const col of ['H', 'D']) {
        const f = FINISHER_MAP[p.comboBoard[row + '_' + col]];
        if (!f) continue;
        out.push({
          seq: [row, row].concat(col === 'D' ? 'D' : row),
          name: f.name, kind: f.kind, params: f.params,
          ext: f.ext, extName: f.extName, sig: f.sig, desc: f.desc,
          row, col, fid: f.id, home: f.home,
        });
      }
    }
    return out;
  }
  const id = G.char && G.char.id;
  if (!id) return [];
  // 有連段表的職業就只用連段表——奧義不併回拍序表。
  // （總監 2026-08-03 定案，見 data.js 摔角手連段樹上方註解：螺旋摔投退出拍序表，
  //   改掛在「擒抱掄甩滿 3 秒按 C」的獎勵，實作在本檔 castSpiralToss 的呼叫點。）
  // 我一度把奧義併回來當成修 bug，那是推翻定案，已回退。真正壞掉的是 UI 文案，見 ui.js 的 sigNameOf。
  if (COMBOS[id]) return COMBOS[id];
  const o = OUGI[id];
  if (!o) return [];
  // 還沒做連段表的職業：奧義維持「湊齊指令後按 Space」——結尾不是 D 的就補一格 D，
  // 語意才跟連段樹一致（最後一格＝玩家做的動作），行為也跟改版前相同。
  const seq = o.seq[o.seq.length - 1] === 'D' ? o.seq : o.seq.concat('D');
  return [{ seq, name: o.name, kind: o.kind, params: o.params, desc: o.desc, sig: true }];
}

/* 前綴符合、且第三個動作＝action 的連段。action 是玩家「正在做的動作」不是已記錄的拍。 */
/* 哪一排：數「站」與「移」的數量，多的那邊贏，不看順序（總監 2026-08-04）。
   移·站·站 跟 站·站 是同一排——玩家不用記順序，只要記「我最近偏站還是偏移」。
   平手時由最近那一拍決定（最後做的事最能代表你現在的狀態）。 */
function boardRowOf(log) {
  let s = 0, m = 0;
  for (const b of log) { if (b === 'S') s++; else if (b === 'M') m++; }
  if (s === 0 && m === 0) return null;
  if (s > m) return 'S';
  if (m > s) return 'M';
  for (let i = log.length - 1; i >= 0; i--) if (log[i] === 'S' || log[i] === 'M') return log[i];
  return null;
}

function matchCombo(action) {
  const p = G.player;
  if (!p || !p.comboBoard) return null;
  const log = p.beatLog;
  if (log.length < 2) return null;          // 至少要先打中兩下
  const row = boardRowOf(log);
  if (!row) return null;
  const col = (action === 'D') ? 'D' : 'H';   // 收尾只分「再打中一下」與「按 SPACE」
  const f = FINISHER_MAP[p.comboBoard[row + '_' + col]];
  if (!f) return null;                        // 空格：只出普攻，不變招
  // 變體加成：收尾那一下換一個狀態打中。同一格同一招，獎勵你在最後一下變一下。
  const last = log[log.length - 1];
  const varied = (col === 'H') && (action !== last);
  // 本命只分兩欄：原本收尾拍是 D 的招本命在「衝」欄，其餘（站/移收尾）本命在「打」欄。
  // 舊的三欄本命判定套進 2×2 會讓「站站+移動打中」誤判成非本命而吃 0.7 折。
  const homeCol = (f.home === 'D') ? 'D' : 'H';
  const boardMul = (varied ? BOARD_MIX_MUL : 1) * (homeCol === col ? 1 : BOARD_OFFHOME_MUL);
  return {
    seq: [row, row].concat(action),
    name: f.name, kind: f.kind, params: f.params,
    ext: f.ext, extName: f.extName, sig: f.sig, desc: f.desc,
    boardMul, row, col, fid: f.id, home: f.home, varied,
  };
}

/* 目前打得出來的連段（頭上提示用）。cd>0＝招還沒好，提示要照實講。 */
function comboReady() {
  const p = G.player;
  const out = [];
  for (const act of ['S', 'M', 'D']) {
    const c = matchCombo(act);
    if (c) {
      const cd = c.sig ? Math.max(0, p.ougiCd || 0)
        : Math.max(0, (p.slotCd && p.slotCd[(c.row || '?') + '_' + (c.col || '?')]) || 0);
      out.push({ act, name: c.name, sig: !!c.sig, cd });
    }
  }
  return out;
}

/* 發動連段：招牌招走奧義演出＋冷卻，收尾招是輕演出 */
function castCombo(c, target) {
  const p = G.player;
  // ★ 每一格自己的冷卻，不再四條共用一個。
  //   共用的時候實測：三局 1800 秒只放出 210 次＝平均 8.6 秒一次，
  //   而玩家湊到條件的次數遠多於此——攻速越快越常湊到，湊到的都被冷卻丟掉，
  //   體感就是「常常沒觸發」。分開之後玩家可以輪著用（站多→移多→站多），
  //   而「輪著用」正是連段盤要的戰略。
  if (c.sig) { if ((p.ougiCd || 0) > 0) return false; }
  else {
    p.slotCd = p.slotCd || {};
    const _k = (c.row || '?') + '_' + (c.col || '?');
    if ((p.slotCd[_k] || 0) > 0) return false;
    if ((p.comboCd || 0) > 0) return false;   // 極短的全域間隔，防同一瞬間連發
  }
  // 蓄勁要能灌進收尾招：連段走 castOugi 繞過了 applyWeaponHit 的 focusStacks 結算，
  // 不補這段的話「站定蓄滿五層 → 第三下貫手」那五層勁會原封不動留在身上。
  const focusMul = 1 + (p.focusStacks || 0) * 0.25;
  const prevDmgMul = G.__comboDmgMul;
  // 盤面倍率：混拍加成 × 本命/非本命。放在這裡才會同時吃到蓄勁。
  G.__comboDmgMul = focusMul * (c.boardMul || 1);
  if (p.focusStacks > 0) {
    addDmgNum(p.x, p.y - 34, '寸勁 ×' + focusMul.toFixed(2), '#e8964a');
    p.focusStacks = 0;
  }
  const ok = castOugi(c, target);
  G.__comboDmgMul = prevDmgMul;
  if (!ok) return false;
  p.beatLog = []; p.beatT = 0;
  if (c.ext && (p.extCd || 0) <= 0) {
    // 延伸窗口：從收尾接觸幀播完(0.18s)開 0.4 秒——「趁他還沒站直」
    p.extWindow = { move: c.ext, name: c.extName || '', delay: 0.18, t: 0.4,
      victim: p.lastComboVictim || null, buffered: false };
  }
  if (c.sig) {
    p.ougiCd = 7.5;
    p.comboSettle = 0.35;
    G.hitstopEcho = { delay: 0.06, dur: 0.05 };
    G.ougiBanner = { name: c.name, t: 1.3 };
    G.screenShake = Math.max(G.screenShake, 12);
    addHitstop(0.12, true);
    sfx('ougi_cast'); sfx('ougi_hit');
  } else {
    // 每格自己的冷卻。四格輪著用＝連段密度提高四倍，而且「輪著用」本身變成技巧。
    p.slotCd = p.slotCd || {};
    p.slotCd[(c.row || '?') + '_' + (c.col || '?')] = 2.5;
    p.comboCd = 0.35;   // 極短的全域間隔，只防同一瞬間連續觸發
    p.comboSettle = 0.35;   // 句號：這 0.35 秒的靜止就是「一套打完了」
    // ★「再打中一下」那一欄是高頻連段（大足踢／巴投這種），每次都放字卡＋震動＋頓幀
    //   會很躁（總監 2026-08-04：動作有就好，華麗留給接 C 的延伸技）。
    //   所以 H 欄只留招式本身的動作，不做連段層級的演出。
    const _loud = (c.col !== 'H');
    if (_loud) {
      G.hitstopEcho = { delay: 0.06, dur: 0.04 };
      addDmgNum(p.x, p.y - 46, c.name, '#ffd44a', true);
      G.screenShake = Math.max(G.screenShake, 7);
    } else {
      p.comboSettle = 0.18;   // 高頻連段的句號也要短，不然一直卡頓
    }
    addHitstop(0.15, true);
    spawnFx('explode', p.x, p.y, '#ffffff', 62);
    sfx('ougi_hit');
    sfx('hit_heavy');
  }
  if (hasItem('fist_wrap')) p.guaranteedCrit = true;
  return true;
}

function ougiReady() {
  const c = matchCombo('D');
  return !!(c && (G.player.ougiCd || 0) <= 0);
}

function castOugi(o, target) {
  const p = G.player;
  const pr = o.params;
  let ok = false;
  switch (o.kind) {
    /* ---- 連段收尾招（通用模板，各職業共用） ---- */
    case 'strike_heavy': {
      // 重擊：對眼前目標灌一記，順帶震到貼身的人
      const e0 = target && !target.dead ? target : nearestEnemy(p.x, p.y, 150);
      if (!e0) break;
      const a0 = Math.atan2(e0.y - p.y, e0.x - p.x);
      p.pose = { type: pr.pose || 'head', ang: a0, t: 0, dur: 0.3, prio: 1 };
      sfx('hit_blunt', { pitch: 0.62, vol: 1.3 });   // 頭槌／貫手類：低沉的「咚」，跟前兩下分家
      // 重心真的壓過去：朝目標撞進一步（頭槌沒有位移就沒有頭槌的感覺）
      const lunge = pr.lunge !== undefined ? pr.lunge : 20;
      p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + Math.cos(a0) * lunge));
      p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + Math.sin(a0) * lunge));
      pushOutOfWalls(p);
      hurtEnemy(e0, techDmg(pr.dmg), { crit: true, fromAngle: a0 });
      e0.hitSquash = Math.max(e0.hitSquash || 0, 0.22);
      e0.hitFlash = Math.max(e0.hitFlash || 0, 0.1);
      if (!e0.dead) e0.stun = Math.max(e0.stun, e0.boss ? pr.stun * 0.4 : pr.stun);
      addHitstop(0.1, true);
      spawnFx('explode', e0.x, e0.y, '#e8e4dc', 74);
      spawnFx('spark', e0.x, e0.y, '#ffffff', e0.r, { angle: a0 });
      if (pr.img) spawnFx('shock', e0.x, e0.y, '#e8e4dc', 90, { img: pr.img });
      if (pr.launch && !e0.dead && !e0.boss) {
        // 頭槌撞上的那一個直接轟出去
        e0.thrown = { vx: Math.cos(a0) * pr.launch, vy: Math.sin(a0) * pr.launch, t: 0.55, decay: 2.2 };
        e0.spin = { v: (Math.cos(a0) >= 0 ? -14 : 14), t: 0.55, a: 0 };
      }
      if (pr.radius) {
        for (const o2 of G.enemies) {
          if (o2.dead || o2 === e0) continue;
          if (dist2(o2.x, o2.y, e0.x, e0.y) < pr.radius * pr.radius) {
            hurtEnemy(o2, techDmg(pr.dmg * (pr.cleaveMul || 0.4)), { trueDmg: true });
            if (!o2.dead) o2.stun = Math.max(o2.stun, pr.stun * 0.4);
          }
        }
      }
      if (!e0.dead && !e0.boss) e0.flat = { t: 0.9 };   // 收尾的受方＝攤平，句號的另一半
      if (pr.cuts) addCuts(e0, pr.cuts, a0);
      if (pr.launch && false) {}
      // 收尾之後把勁留給下一擊：貫手替下一拳上必爆、袈裟斬留殘心
      if (pr.critNext) p.guaranteedCrit = true;
      if (pr.charge) p.chargeHits = Math.max(p.chargeHits || 0, pr.charge);
      sfx('hit_heavy');
      ok = true; break;
    }
    case 'suplex': {
      // 德式背摔：環抱住腰、自己向後仰倒，把人從頭頂翻到身後——受方上背著地。
      // 辨識關鍵：只有 suplex 是「把自己也豁出去」的摔技（企鵝後仰但不躺，圍毆場活命優先）。
      const eS = target && !target.dead ? target : nearestEnemy(p.x, p.y, 150);
      if (!eS) break;
      if (eS.boss) {
        hurtEnemy(eS, techDmg(pr.dmg * 0.6), { trueDmg: true });
        eS.stun = Math.max(eS.stun, 0.8);
        addHitstop(0.08, true);
        ok = true; break;
      }
      eS.grabbed = true; eS.stun = 99; eS.knockX = 0; eS.knockY = 0;
      p.suplexAnim = { e: eS, t: 0, dmg: pr.dmg, stun: pr.stun, face: p.face };
      p.lastComboVictim = eS;
      p.pose = { type: 'suplexp', ang: p.face > 0 ? 0 : Math.PI, t: 0, dur: 0.44, prio: 1 };
      sfx('grab');
      ok = true; break;
    }
    case 'hip_toss': {
      // 腰投：勾臂以腰為支點往前翻摔，施術者保持站立（跟 suplex 的反向對照）
      const eH = target && !target.dead ? target : nearestEnemy(p.x, p.y, 130);
      if (!eH) break;
      if (eH.boss) {
        hurtEnemy(eH, techDmg(pr.dmg * 0.6), { trueDmg: true });
        eH.stun = Math.max(eH.stun, 0.7);
        ok = true; break;
      }
      eH.grabbed = true; eH.stun = 99;
      p.hipTossAnim = { e: eH, t: 0, dmg: pr.dmg, stun: pr.stun, face: p.face };
      p.lastComboVictim = eH;
      p.pose = { type: 'hiptossp', ang: p.face > 0 ? 0 : Math.PI, t: 0, dur: 0.36, prio: 1 };
      sfx('grab');
      ok = true; break;
    }
    case 'area_delayed': {
      // 霞斬：刀氣留在那片區域，1.2 秒後才整片炸開——全遊戲唯一要預判落點的招
      const dirA = dashDir();
      const axc = Math.max(60, Math.min(ARENA.w - 60, p.x + dirA.x * (pr.reach || 130)));
      const ayc = Math.max(60, Math.min(ARENA.h - 60, p.y + dirA.y * (pr.reach || 130)));
      G.mistCuts = G.mistCuts || [];
      G.mistCuts.push({ x: axc, y: ayc, r: pr.radius || 130, t: pr.delay || 1.2,
        dmg: pr.dmg || 52, cuts: pr.cuts || 2, sever: !!pr.severInArea });
      spawnFx('swing', p.x, p.y, '#b8c6dc', 130, { angle: Math.atan2(dirA.y, dirA.x), arc: 90, type: 'arc' });
      p.pose = { type: pr.pose || 'chop', ang: Math.atan2(dirA.y, dirA.x), t: 0, dur: 0.3, prio: 1 };
      sfx('swing_blade');
      ok = true; break;
    }
    case 'multi_thrust': {
      // 三段突：連續三記直刺，最後一刺無視累積強制斬斷
      const eT = target && !target.dead ? target : nearestEnemy(p.x, p.y, pr.range || 150);
      if (!eT) break;
      const aT2 = Math.atan2(eT.y - p.y, eT.x - p.x);
      p.pose = { type: pr.pose || 'jab', ang: aT2, t: 0, dur: 0.34, prio: 1 };
      p.thrustChain = { e: eT, left: pr.thrusts || 3, t: 0, dmg: pr.dmg || 18,
        cuts: pr.cuts || 1, severLast: !!pr.severOnLast, ang: aT2 };
      sfx('swing_blade');
      ok = true; break;
    }
    case 'delayed_cuts': {
      // 斬擊的破壞性不是打飛，是「斬痕後才裂開」——沿用拔刀斬的延遲連斬語言
      const dirC2 = dashDir();
      const exD = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + dirC2.x * (pr.len || 420)));
      const eyD = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + dirC2.y * (pr.len || 420)));
      let anyD = false;
      for (const o2 of G.enemies) {
        if (o2.dead) continue;
        const t3 = Math.max(0, Math.min(1,
          ((o2.x - p.x) * (exD - p.x) + (o2.y - p.y) * (eyD - p.y)) / (dist2(p.x, p.y, exD, eyD) || 1)));
        const qx2 = p.x + (exD - p.x) * t3, qy2 = p.y + (eyD - p.y) * t3;
        if (dist2(o2.x, o2.y, qx2, qy2) < ((pr.width || 76) / 2 + o2.r) * ((pr.width || 76) / 2 + o2.r)) {
          o2.iaiCut = { t: pr.delay || 0.3, n: pr.n || 3, dmg: techDmg(pr.dmgPerCut || pr.dmg || 16) };
          o2.stun = Math.max(o2.stun, pr.stun || 0.6);
          if (pr.cuts) addCuts(o2, pr.cuts, 0);
          anyD = true;
        }
      }
      spawnFx('heal_link', p.x, p.y, '#e8e4dc', 0, { tx: exD, ty: eyD, img: 'fx_ougi_slash' });
      if (pr.blink) { p.x = exD; p.y = eyD; pushOutOfWalls(p); }
      p.pose = { type: pr.pose || 'chop', ang: Math.atan2(dirC2.y, dirC2.x), t: 0, dur: 0.3, prio: 1 };
      sfx('swing_blade');
      ok = anyD || !!pr.blink;
      break;
    }
    case 'pierce_line': {
      // 貫穿突刺：一條線打穿，命中者定身＋下一擊必爆（空手道的「打穿」語言）
      const dirP = dashDir();
      const exP = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + dirP.x * (pr.len || 260)));
      const eyP = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + dirP.y * (pr.len || 260)));
      const aP = Math.atan2(dirP.y, dirP.x);
      let anyP = false;
      for (const o2 of G.enemies) {
        if (o2.dead) continue;
        const t4 = Math.max(0, Math.min(1,
          ((o2.x - p.x) * (exP - p.x) + (o2.y - p.y) * (eyP - p.y)) / (dist2(p.x, p.y, exP, eyP) || 1)));
        const qx3 = p.x + (exP - p.x) * t4, qy3 = p.y + (eyP - p.y) * t4;
        if (dist2(o2.x, o2.y, qx3, qy3) < ((pr.width || 60) / 2 + o2.r) * ((pr.width || 60) / 2 + o2.r)) {
          hurtEnemy(o2, techDmg(pr.dmg || 60), { crit: true, fromAngle: aP });
          if (!o2.dead) {
            o2.stun = Math.max(o2.stun, pr.stun || 0.8);
            o2.hitSquash = Math.max(o2.hitSquash || 0, 0.28);
            if (pr.launch && !o2.boss) {
              o2.thrown = { vx: Math.cos(aP) * pr.launch, vy: Math.sin(aP) * pr.launch, t: 0.5, decay: 2.2 };
            }
          }
          spawnFx('spark', o2.x, o2.y, '#ffd44a', o2.r, { angle: aP });
          anyP = true;
        }
      }
      spawnFx('swing', p.x, p.y, '#e8e4dc', pr.len || 260, { angle: aP, arc: 26, type: 'arc' });
      if (pr.blink) { p.x = exP; p.y = eyP; pushOutOfWalls(p); }
      p.pose = { type: pr.pose || 'jab', ang: aP, t: 0, dur: 0.28, prio: 1 };
      if (pr.critNext) p.guaranteedCrit = true;
      if (pr.cuts) for (const o3 of G.enemies) { if (!o3.dead && o3.hitByPierce) { addCuts(o3, pr.cuts, aP); o3.hitByPierce = false; } }
      ok = anyP || !!pr.blink;
      break;
    }
    case 'execute_cut': {
      // 唐竹割：從頭頂直劈到底的單體處決——視同再加斬痕才引爆
      const eX = target && !target.dead ? target : nearestEnemy(p.x, p.y, 160);
      if (!eX) break;
      const aX = Math.atan2(eX.y - p.y, eX.x - p.x);
      p.pose = { type: pr.pose || 'chop', ang: aX, t: 0, dur: 0.34, prio: 1 };
      hurtEnemy(eX, techDmg(pr.dmg || 88), { crit: true, fromAngle: aX });
      if (!eX.dead) {
        addCuts(eX, 1, aX);
        severCheck(eX, pr.cutsBonus || 2, true);
      }
      spawnFx('swing', p.x, p.y, '#e8f2ff', 130, { angle: aX, arc: 40, type: 'arc', img: 'fx_slash_kesa' });
      addHitstop(pr.hitstop || 0.14, true);
      G.screenShake = Math.max(G.screenShake, 15);
      sfx('swing_blade'); sfx('hit_blade');
      ok = true; break;
    }
    case 'shock_nova': {
      // 震盪擴散：以命中點為中心的多重環，一環比一環大（空手道的爆擊震盪放大版）
      const eN = target && !target.dead ? target : nearestEnemy(p.x, p.y, 200);
      const cx2 = eN ? eN.x : p.x, cy2 = eN ? eN.y : p.y;
      if (eN) hurtEnemy(eN, techDmg(pr.dmg || 70), { crit: true });
      const rings = pr.rings || 3;
      for (let ri = 0; ri < rings; ri++) {
        const rr2 = (pr.radius || 90) * (0.5 + 0.5 * (ri + 1) / rings) * (1 + ri * 0.55);
        for (const o2 of G.enemies) {
          if (o2.dead || o2 === eN) continue;
          if (dist2(o2.x, o2.y, cx2, cy2) < rr2 * rr2) {
            hurtEnemy(o2, techDmg((pr.dmg || 70) * (pr.falloff || 0.35)), { trueDmg: true });
            if (!o2.dead) o2.stun = Math.max(o2.stun, 0.5);
          }
        }
        spawnFx('shock', cx2, cy2, '#ffd44a', rr2, { img: 'fx_kime_burst' });
      }
      spawnFx('explode', cx2, cy2, '#ffffff', 100);
      p.pose = { type: pr.pose || 'jab', ang: Math.atan2(cy2 - p.y, cx2 - p.x), t: 0, dur: 0.3, prio: 1 };
      if (pr.critNext) p.guaranteedCrit = true;
      ok = true; break;
    }
    case 'sweep_ring': {
      // 迴身一整圈：解圍用，賣的是擊退不是傷害
      p.pose = { type: 'kick', ang: p.face > 0 ? 0 : Math.PI, t: 0, dur: 0.32, prio: 1 };
      spawnFx('swing', p.x, p.y, pr.color || '#c9d96a', pr.radius,
        { angle: 0, arc: 360, type: 'spin', img: pr.img });
      for (const o2 of G.enemies) {
        if (o2.dead) continue;
        if (dist2(o2.x, o2.y, p.x, p.y) > (pr.radius + o2.r) * (pr.radius + o2.r)) continue;
        hurtEnemy(o2, techDmg(pr.dmg), { trueDmg: true });
        if (!o2.dead) {
          const ea = Math.atan2(o2.y - p.y, o2.x - p.x);
          const kb = o2.boss ? pr.knock * 0.2 : pr.knock;
          o2.knockX += Math.cos(ea) * kb; o2.knockY += Math.sin(ea) * kb;
          o2.stun = Math.max(o2.stun, o2.boss ? pr.stun * 0.4 : pr.stun);
          if (pr.cuts) addCuts(o2, pr.cuts, ea);
          if (pr.severAll) severCheck(o2);   // 二之太刀：圈內滿痕的一起引爆
        }
      }
      sfx('swing_leg');
      sfx('hit_kick', { pitch: 0.8, vol: 1.25 });   // 迴旋踢收尾：重踢聲
      ok = true; break;
    }
    case 'knock_cone': {
      // 扇形踢飛：一整片掃出去，主打位移不是傷害
      const e1 = target && !target.dead ? target : nearestEnemy(p.x, p.y, pr.range);
      const a1 = e1 ? Math.atan2(e1.y - p.y, e1.x - p.x) : (p.face > 0 ? 0 : Math.PI);
      const half = (pr.arc * Math.PI / 180) / 2;
      p.pose = { type: 'kick', ang: a1, t: 0, dur: 0.3, prio: 1 };
      spawnFx('swing', p.x, p.y, '#c98a3c', pr.range, { angle: a1, arc: pr.arc, type: 'arc' });
      for (const o2 of G.enemies) {
        if (o2.dead) continue;
        if (dist2(o2.x, o2.y, p.x, p.y) > (pr.range + o2.r) * (pr.range + o2.r)) continue;
        const ea = Math.atan2(o2.y - p.y, o2.x - p.x);
        if (Math.abs(angDiff(ea, a1)) > half) continue;
        hurtEnemy(o2, techDmg(pr.dmg), { fromAngle: a1 });
        if (!o2.dead) {
          if (o2.boss) {
            o2.knockX += Math.cos(ea) * pr.knock * 0.2; o2.knockY += Math.sin(ea) * pr.knock * 0.2;
            o2.stun = Math.max(o2.stun, pr.stun * 0.4);
          } else {
            // BIG BOOT 是把人踢飛，不是推開——飛出去撞牆撞人才有破壞性
            o2.thrown = { vx: Math.cos(a1) * (pr.launch || 700), vy: Math.sin(a1) * (pr.launch || 700),
              t: 0.6, decay: 2.1 };
            o2.spin = { v: (Math.cos(a1) >= 0 ? -13 : 13), t: 0.6, a: 0 };
            o2.stun = Math.max(o2.stun, pr.stun);
            o2.hitSquash = Math.max(o2.hitSquash || 0, 0.26);
          }
        }
        ok = true;
      }
      sfx('swing_leg');
      if (!ok) ok = true;   // 掃空也算出招（動作已經做出去了）
      break;
    }
    case 'charge_line': {
      // 橫掛衝鋒：真的跑過去（不是瞬移）——dashState 帶位移，沿路撞到誰誰倒
      const dirC = dashDir();
      const aC = Math.atan2(dirC.y, dirC.x);
      const spdC = pr.chargeSpd || 820;
      p.dashState = {
        id: 'clothesline', dx: dirC.x, dy: dirC.y,
        t: pr.len / spdC, spd: spdC, accel: true,
        pre: 0.13, latched: [],
        chargeDmg: pr.dmg, chargeKnock: pr.knock, chargeStun: pr.stun,
        chargeW: pr.width / 2, boost: 1,
      };
      if (pr.pulses) { p.dashState.pulses = pr.pulses; p.dashState.alternate = pr.alternate; p.dashState.pulseCuts = pr.cuts; }
      p.pose = { type: pr.pose || 'swing', ang: aC, t: 0, dur: pr.len / spdC + 0.15, prio: 1 };
      spawnFx('slide', p.x, p.y, '#c98a3c', 40, { angle: aC });
      sfx('wind');
      ok = true; break;
    }
    case 'burst_single': {
      const e = nearestEnemy(p.x, p.y, 420);
      if (!e) break;
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      p.x = Math.max(p.r, Math.min(ARENA.w - p.r, e.x + Math.cos(a) * (e.r + 24)));
      p.y = Math.max(p.r, Math.min(ARENA.h - p.r, e.y + Math.sin(a) * (e.r + 24)));
      p.iframe = Math.max(p.iframe, 0.5);
      hurtEnemy(e, techDmg(pr.dmg), { crit: true });
      if (!e.dead) e.stun = Math.max(e.stun, 1.0);
      spawnFx('explode', e.x, e.y, '#ffffff', 90);
      spawnFx('shock', e.x, e.y, '#ffd44a', 100, { img: 'fx_kime_burst' });
      if (pr.critNext) p.guaranteedCrit = true;
      ok = true; break;
    }
    case 'burst_multi': {
      const tgt = nearestEnemy(p.x, p.y, 300);
      if (tgt) {
        const dd = Math.hypot(tgt.x - p.x, tgt.y - p.y) || 1;
        p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + (tgt.x - p.x) / dd * Math.max(0, dd - 60)));
        p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + (tgt.y - p.y) / dd * Math.max(0, dd - 60)));
      }
      p.burstMulti = { hits: pr.hits, tick: 0, dmg: pr.dmg, arc: pr.arc, range: pr.range,
        ang: p.face > 0 ? 0 : Math.PI, loot: !!pr.loot };
      p.iframe = Math.max(p.iframe, pr.hits * 0.08 + 0.2);
      ok = true; break;
    }
    case 'rush_multi': {
      const list = G.enemies.filter(e => !e.dead && !e.grabbed)
        .sort((a, b) => dist2(a.x, a.y, p.x, p.y) - dist2(b.x, b.y, p.x, p.y))
        .slice(0, pr.count);
      if (!list.length) break;
      p.rushMulti = { targets: list, tick: 0, dmg: pr.dmg };
      p.iframe = Math.max(p.iframe, pr.count * 0.11 + 0.3);
      ok = true; break;
    }
    case 'flying_kick': {
      // 真實飛行（不瞬移）：貫穿額度用完就被人牆生生擋下來。
      // 妙的是這個「人牆」是玩家自己造的——空手道不轟飛，被踢中的人留在原地就變成路障。
      const dirF = dashDir();
      const spdF = pr.spd || 1150;
      const aF = Math.atan2(dirF.y, dirF.x);
      p.dashState = {
        id: 'tobigeri', dx: dirF.x, dy: dirF.y,
        t: (pr.len || 430) / spdF, spd: spdF,
        pierceLeft: pr.pierce || 3, hitIdx: 0,
        kickDmg: pr.dmg || 58, kickStun: pr.stun || 1.0,
        kickW: (pr.width || 46) / 2, kickKnock: pr.knock || 60,
        falloff: pr.falloff || 0.6, slowPerHit: pr.slowPerHit || 0.8,
        boost: 1,
      };
      p.pose = { type: pr.pose || 'kick', ang: aF, t: 0, dur: (pr.len || 430) / spdF + 0.12, prio: 1 };
      p.iframe = Math.max(p.iframe, 0.15);   // 只有 0.15 秒：這是攻擊不是無敵穿場
      spawnFx('slide', p.x, p.y, '#ffd44a', 44, { angle: aF });
      sfx('swing_leg');
      ok = true; break;
    }
    case 'dive_splash': {
      // 撲壓：跳出去用整個身體壓上去。受方原地被壓扁不位移，施術者可能一起倒地。
      const dirV = dashDir();
      const lenV = pr.len || 60;
      const exV = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + dirV.x * lenV));
      const eyV = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + dirV.y * lenV));
      p.x = exV; p.y = eyV;
      pushOutOfWalls(p);
      let anyV = false;
      for (const o2 of G.enemies) {
        if (o2.dead) continue;
        if (dist2(o2.x, o2.y, p.x, p.y) > (pr.radius || 80) * (pr.radius || 80)) continue;
        hurtEnemy(o2, techDmg(pr.dmg || 28), { trueDmg: true });
        if (!o2.dead) {
          o2.stun = Math.max(o2.stun, pr.stun || 0.6);
          o2.hitSquash = Math.max(o2.hitSquash || 0, 0.3);
          o2.knockX = 0; o2.knockY = 0;   // 被壓的人原地扁掉，不飛
          if (pr.prone) o2.flat = { t: 0.9 };
        }
        anyV = true;
      }
      spawnFx('shock', p.x, p.y, '#b07a4a', pr.radius || 80, { img: 'fx_slam_ring', squash: 0.45 });
      spawnFx('explode', p.x, p.y, '#c9a06a', (pr.radius || 80) * 0.7);
      p.pose = { type: pr.pose || 'slamland', ang: Math.atan2(dirV.y, dirV.x), t: 0, dur: 0.3, prio: 1 };
      if (pr.selfProne) p.staggerT = Math.max(p.staggerT, pr.selfProne);
      G.screenShake = Math.max(G.screenShake, 12);
      sfxThrow('suplex');
      ok = anyV || true;
      break;
    }
    case 'rebound_line': {
      // 跑繩：衝出去撞到場邊彈回來，去程回程各輾一次——全表唯一吃場地幾何的招
      const dirR = dashDir();
      p.dashState = { id: 'rebound', dx: dirR.x, dy: dirR.y,
        t: (pr.out || 260) / 780, spd: 780, accel: true,
        chargeDmg: pr.dmg || 34, chargeKnock: pr.knock || 200, chargeStun: pr.stun || 0.5,
        chargeW: (pr.width || 70) / 2, boost: 1,
        reboundLeft: 1, backMul: pr.backMul || 1.35, latched: [] };
      p.pose = { type: 'lariat', ang: Math.atan2(dirR.y, dirR.x), t: 0, dur: 0.4, prio: 1 };
      sfx('dash');
      ok = true; break;
    }
    case 'aoe_blast': {
      if (pr.hpCost) p.hp = Math.max(1, p.hp - p.maxHp * pr.hpCost);
      spawnFx('explode', p.x, p.y, '#d9564f', pr.radius);
      G.screenShake = Math.max(G.screenShake, 16);
      for (const e of G.enemies) {
        if (e.dead) continue;
        if (dist2(e.x, e.y, p.x, p.y) < pr.radius * pr.radius) {
          hurtEnemy(e, techDmg(pr.dmg), { trueDmg: true });
          if (!e.dead) e.stun = Math.max(e.stun, pr.stun || 0.8);
        }
      }
      ok = true; break;
    }
    case 'aoe_push': {
      spawnFx('shock', p.x, p.y, '#c9576b', pr.radius);
      G.screenShake = Math.max(G.screenShake, 12);
      for (const e of G.enemies) {
        if (e.dead) continue;
        if (dist2(e.x, e.y, p.x, p.y) < pr.radius * pr.radius) {
          hurtEnemy(e, techDmg(pr.dmg), { trueDmg: true });
          if (!e.dead) {
            const a = Math.atan2(e.y - p.y, e.x - p.x);
            const kb = pr.knock * (e.boss ? 0.15 : 1);
            e.knockX += Math.cos(a) * kb; e.knockY += Math.sin(a) * kb;
          }
        }
      }
      ok = true; break;
    }
    case 'vortex': {
      let n = 0;
      for (const e of G.enemies) {
        if (e.dead || e.boss) continue;
        if (dist2(e.x, e.y, p.x, p.y) < pr.radius * pr.radius) {
          const a = rng() * Math.PI * 2;
          e.x = p.x + Math.cos(a) * 55;
          e.y = p.y + Math.sin(a) * 55;
          hurtEnemy(e, throwDmg(pr.dmg), { trueDmg: true });
          if (!e.dead) {
            e.thrown = { vx: Math.cos(a) * 620, vy: Math.sin(a) * 620, t: 0.5 };
          }
          n++;
        }
      }
      if (n) { spawnFx('shock', p.x, p.y, '#8fa89a', pr.radius); G.screenShake = Math.max(G.screenShake, 10); ok = true; }
      break;
    }
    case 'line_pierce': {
      const dir = dashDir();
      const ex = Math.max(p.r, Math.min(ARENA.w - p.r, p.x + dir.x * pr.len));
      const ey = Math.max(p.r, Math.min(ARENA.h - p.r, p.y + dir.y * pr.len));
      for (const e of G.enemies) {
        if (e.dead) continue;
        const t = Math.max(0, Math.min(1,
          ((e.x - p.x) * (ex - p.x) + (e.y - p.y) * (ey - p.y)) /
          (dist2(p.x, p.y, ex, ey) || 1)));
        const px2 = p.x + (ex - p.x) * t, py2 = p.y + (ey - p.y) * t;
        if (dist2(e.x, e.y, px2, py2) < (pr.width / 2 + e.r) * (pr.width / 2 + e.r)) {
          hurtEnemy(e, techDmg(pr.dmg), { crit: chance(0.4), trueDmg: true });
          if (!e.dead) { e.stun = Math.max(e.stun, 0.5); if (pr.cuts) addCuts(e, pr.cuts, 0); }
        }
      }
      spawnFx('heal_link', p.x, p.y, '#e8e4dc', 0, { tx: ex, ty: ey, img: 'fx_ougi_slash' });
      p.x = ex; p.y = ey;
      // 第二刀：落點反手橫掃，與第一刀在地上交成十字
      if (pr.cross) {
        const nx = -dir.y, ny = dir.x;
        const ax = ex - nx * pr.crossLen, ay = ey - ny * pr.crossLen;
        const bx = ex + nx * pr.crossLen, by = ey + ny * pr.crossLen;
        for (const e of G.enemies) {
          if (e.dead) continue;
          const t2 = Math.max(0, Math.min(1,
            ((e.x - ax) * (bx - ax) + (e.y - ay) * (by - ay)) / (dist2(ax, ay, bx, by) || 1)));
          const qx = ax + (bx - ax) * t2, qy = ay + (by - ay) * t2;
          if (dist2(e.x, e.y, qx, qy) < (pr.width / 2 + e.r) * (pr.width / 2 + e.r)) {
            hurtEnemy(e, techDmg(pr.dmg * (pr.crossMul || 0.8)), { crit: chance(0.4), trueDmg: true });
            if (!e.dead) {
              e.stun = Math.max(e.stun, 0.5);
              if (pr.crossCuts) addCuts(e, pr.crossCuts, 0);
              // 十字交點：站在兩刀交會處是這遊戲最不該站的地方
              if (pr.forceSever && dist2(e.x, e.y, ex, ey) < 70 * 70) severCheck(e, 0, true);
            }
          }
        }
        spawnFx('heal_link', ax, ay, '#e8e4dc', 0, { tx: bx, ty: by });
        spawnFx('shock', ex, ey, '#e8e4dc', 190, { img: 'fx_ougi_cross' });
      }
      p.iframe = Math.max(p.iframe, 0.5);
      G.screenShake = Math.max(G.screenShake, 10);
      ok = true; break;
    }
    case 'throw_chain': {
      if (pr.count === 1) {
        const e = nearestEnemy(p.x, p.y, 300);
        if (!e || e.boss) {
          if (e) { hurtEnemy(e, techDmg(pr.dmg * pr.hits * 0.6), { trueDmg: true }); e.stun = Math.max(e.stun, 1.0); ok = true; }
          break;
        }
        const dd = Math.hypot(e.x - p.x, e.y - p.y) || 1;
        p.x = Math.max(p.r, Math.min(ARENA.w - p.r, e.x - (e.x - p.x) / dd * (p.r + e.r)));
        p.y = Math.max(p.r, Math.min(ARENA.h - p.r, e.y - (e.y - p.y) / dd * (p.r + e.r)));
        e.grabbed = true; e.stun = 99;
        p.kneeChain = { e, hits: pr.hits, tick: 0, dmg: pr.dmg };
        ok = true; break;
      }
      const list = G.enemies.filter(e => !e.dead && !e.boss && !e.grabbed &&
        dist2(e.x, e.y, p.x, p.y) < 180 * 180).slice(0, pr.count);
      if (!list.length) break;
      list.forEach((e, i) => {
        const a = (i / list.length) * Math.PI * 2;
        e.x = Math.max(e.r, Math.min(ARENA.w - e.r, p.x + Math.cos(a) * 70));
        e.y = Math.max(e.r, Math.min(ARENA.h - e.r, p.y + Math.sin(a) * 70));
        hurtEnemy(e, throwDmg(pr.dmg), { trueDmg: true });
        if (!e.dead) {
          e.thrown = { vx: Math.cos(a) * 680, vy: Math.sin(a) * 680, t: 0.5 };
        }
        spawnFx('shock', e.x, e.y, '#3c6ea5', 60);
      });
      G.screenShake = Math.max(G.screenShake, 10);
      ok = true; break;
    }
    case 'grab_super': {
      let best = null, bd = 160 * 160;
      for (const e of G.enemies) {
        if (e.dead || e.thrown || e.grabbed) continue;
        const dd = dist2(p.x, p.y, e.x, e.y);
        if (dd < bd) { bd = dd; best = e; }
      }
      if (!best) break;
      if (best.boss) {
        // 掄不動這麼大隻，那就直接把他砸進地板：本體重擊＋周圍震盪
        hurtEnemy(best, throwDmg(pr.bossDmg || 80), { trueDmg: true });
        best.stun = Math.max(best.stun, 1.5);
        spawnFx('explode', best.x, best.y, '#c2703c', 140);
        for (const e2 of G.enemies) {
          if (e2.dead || e2 === best) continue;
          if (dist2(e2.x, e2.y, best.x, best.y) < 140 * 140) {
            hurtEnemy(e2, throwDmg(pr.blastDmg || 20), { trueDmg: true });
            if (!e2.dead) e2.stun = Math.max(e2.stun, 0.8);
          }
        }
        G.screenShake = Math.max(G.screenShake, 12);
        ok = true; break;
      }
      startGrab(best, { dur: pr.dur || 2.1, orbitR: pr.orbitR || 76, spinSpd: pr.spinSpd || 9 });
      p.grabState.super = true;
      ok = true; break;
    }
    case 'counter_field': {
      p.ougiField = pr.dur;
      spawnFx('shock', p.x, p.y, '#5a8ac9', 90);
      ok = true; break;
    }
  }
  return ok;
}

/* ---------- 角度工具 ---------- */
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

/* ---------- 武器 ---------- */
function nearestEnemy(x, y, maxR) {
  let best = null, bd = maxR * maxR;
  for (const e of G.enemies) {
    if (e.dead) continue;
    const d = dist2(x, y, e.x, e.y);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function updateWeapons(dt) {
  const p = G.player;
  const spdMul = liveAtkSpdMult();
  const rangeMul = liveRangeMult();
  const galeBonus = hasItem('gale_elbowguard');
  p.weapons.forEach((w, idx) => {
    const wMul = (galeBonus && (w.klass === '拳' || w.klass === '肘膝')) ? 1.15 : 1;
    // 連段加速：踩進前綴之後越打越快，一套三下在一秒內打完——這才是「一二三」
    const cs = p.comboStep || 0;
    const comboMul = cs >= 2 ? 3.1 : (cs === 1 ? 2.3 : 1);
    w.cdLeft -= dt * spdMul * wMul * comboMul;
    if (w.swing > 0) w.swing -= dt / (w.swingDur || 0.167);
    const reach = w.range * rangeMul;
    const target = nearestEnemy(p.x, p.y, reach + 26);
    if (target) {
      const want = Math.atan2(target.y - p.y, target.x - p.x);
      w.angle = want;
    } else {
      // 沒目標時固定握在面向側（微幅呼吸浮動），不再繞圈亂轉
      const nW = Math.max(1, p.weapons.length);
      const spread = (idx - (nW - 1) / 2) * 0.38;
      const base = p.face > 0 ? -0.45 : Math.PI + 0.45;
      w.angle = base + spread * (p.face > 0 ? 1 : -1) + Math.sin(G.time * 2 + idx) * 0.05;
    }
    if (w.cdLeft <= 0 && target && (p.comboSettle || 0) <= 0.17 &&
        !p.suplexAnim && !p.hipTossAnim && !p.ddtState && !p.tossState && !p.gutRoll) {
      const d = Math.sqrt(dist2(p.x, p.y, target.x, target.y));
      if (d <= reach + target.r) {
        fireWeapon(w, reach);
        w.cdLeft = w.cd;
      }
    }
  });
}

/* 攻擊實體化：拳頭／刀光／掌風是真的飛出去的東西，碰到敵人那一幀才有傷害。
   grab 類維持貼身即時（抓抱沒有彈道可言）。 */
function fireWeapon(w, reach) {
  const p = G.player;
  w.swing = 1;
  // 一次揮擊發一個號碼牌：記拍去重要看「這是第幾次揮」，不能看時間。
  // 看時間的話，攻速一快、連段一加速，兩次揮擊落進同一個時間窗，
  // 第二下就被當成同一擊吃掉——玩家看到打中了，連段卻沒進。
  p.swingSeq = (p.swingSeq || 0) + 1;
  w.swingId = p.swingSeq;
  if (w.klass !== '摔技') w.swingDir *= -1;   // 摔技鎖定揮向：圖與刀路不准反向
  // 揮武器時手臂跟著出去（起手式姿勢優先，不覆蓋）
  if (!p.pose || p.pose.prio !== 1) {
    p.pose = { type: w.klass === '摔技' ? 'chop' : 'swing', ang: w.angle, t: 0,
      dur: w.klass === '摔技' ? 0.26 : 0.2, prio: 0 };
  }

  if (w.type === 'grab') {
    const halfArc = (w.arc * Math.PI / 180) / 2;
    let best = null, bd = 1e18;
    for (const e of G.enemies) {
      if (e.dead || e.grabbed || e.thrown) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > reach + e.r) continue;
      const a = Math.atan2(dy, dx);
      if (Math.abs(angDiff(a, w.angle)) > halfArc + Math.atan2(e.r, Math.max(20, d))) continue;
      if (d < bd) { bd = d; best = e; }
    }
    spawnGhostStrike(w, reach);   // 抓技的可見劈砍（純視覺，命中判定照舊走即時抓取）
    if (best) {
      applyWeaponHit(w, best, reach, undefined, false, w.swingId);
      if (G.char.special === 'flurry' && !best.dead) applyWeaponHit(w, best, reach, 0.4, true);
    }
    return;
  }
  spawnStrike(w, reach);
}

/* 純視覺掃擊：抓技武器沒有攻擊實體，補一道會畫出來但不帶傷害的刀路 */
function spawnGhostStrike(w, reach) {
  const p = G.player;
  const half = (Math.max(w.arc || 90, 90) * Math.PI / 180) / 2;
  G.strikes.push({
    w, reach, t: 0, hit: [], ghost: true, kind: 'sweep', swingId: w.swingId,
    ang0: w.angle - half * w.swingDir,
    ang1: w.angle + half * w.swingDir,
    cur: w.angle - half * w.swingDir,
    dur: 0.13,
  });
}

function spawnStrike(w, reach) {
  const p = G.player;
  const s = { w, reach, t: 0, hit: [], swingId: w.swingId };
  if (w.type === 'thrust') {
    s.kind = 'thrust';
    s.x = p.x + Math.cos(w.angle) * (p.r + 8);
    s.y = p.y + Math.sin(w.angle) * (p.r + 8);
    s.ang = w.angle;
    s.speed = w.strikeSpd || Math.max(560, 1200 - w.dmg * 12);   // 短打快、重擊沉
    s.maxDist = reach + 14;
    s.traveled = 0;
  } else if (w.type === 'arc') {
    s.kind = 'sweep';
    const half = (w.arc * Math.PI / 180) / 2;
    s.ang0 = w.angle - half * w.swingDir;
    s.ang1 = w.angle + half * w.swingDir;
    s.cur = s.ang0;
    if (w.klass === '摔技') {
      // 手刀：110ms 引手（不掃描）→ 60ms 接觸窗一口氣掃完。接觸是瞬間，不攤在整段上。
      s.windup = 0.11;
      s.dur = 0.06;
    } else {
      s.dur = Math.max(0.12, Math.min(0.3, w.cd * 0.24));   // 勾拳快、打刀沉、重械慢
    }
    w.swingDur = s.dur + (s.windup || 0);
  } else if (w.type === 'spin') {
    s.kind = 'orbit';
    s.cur = w.angle;
    s.dur = 0.42;
    s.spd = (Math.PI * 2 / 0.42) * (w.swingDir > 0 ? 1 : -1);
  } else {   // slam：延遲爆發，先給預兆——越重的傢伙預告越長
    s.kind = 'slam';
    s.delay = Math.max(0.08, Math.min(0.26, w.cd * 0.13));
    w.swingDur = s.delay + 0.08;
  }
  // 總監 2026-08-04：手刀拿掉速度線，專注在敵人被打的狀態。
  // 手刀每 0.8 秒一次，速度線每次都畫等於畫面一直有東西閃；
  // 打擊感八成是受方賣出來的（chopHit 的橫壓後仰＋胸口白閃＋脆響已經在做這件事）。
  if (false && w.klass === '摔技' && s.kind === 'sweep') {
    // 漫畫速度線（總監指令）：線聚在手邊、順著揮向拖出去。
    // 特效自己有壽命，不跟著 60ms 的接觸窗一起消失——不然畫面上等於沒畫。
    spawnFx('mangaline', p.x, p.y, '#ffd44a', s.reach * 0.74,
      { ang0: s.ang0, ang1: s.ang1, delay: s.windup || 0 });
  }
  G.strikes.push(s);
  if (G.strikes.length > 40) G.strikes.shift();
  // 揮擊風聲
  if (w.klass === '刃') sfx('swing_blade');
  else if (w.klass === '腿') sfx('swing_leg');
  else sfx('swing');
}

function strikeHit(s, e) {
  if (e.dead || s.hit.includes(e)) return;
  s.hit.push(e);
  applyWeaponHit(s.w, e, s.reach, undefined, false, s.swingId);
  if (G.char.special === 'flurry' && !e.dead) applyWeaponHit(s.w, e, s.reach, 0.4, true);
}

function updateStrikes(dt) {
  const p = G.player;
  for (const s of G.strikes) {
    s.t += dt;
    if (s.kind === 'thrust') {
      const step = s.speed * dt;
      s.x += Math.cos(s.ang) * step;
      s.y += Math.sin(s.ang) * step;
      s.traveled += step;
      for (const e of G.enemies) {
        if (e.dead || e.grabbed || e.thrown || s.hit.includes(e)) continue;
        const rr = 13 + e.r;
        if (dist2(e.x, e.y, s.x, s.y) < rr * rr) {
          strikeHit(s, e);
          if (!s.w.pierce) { s.dead = true; break; }
        }
      }
      for (const ib of G.iceblocks) {
        if (s.hitIce === ib) continue;
        if (dist2(ib.x, ib.y, s.x, s.y) < (13 + ib.r) * (13 + ib.r)) {
          s.hitIce = ib;
          hurtIceblock(ib, s.w.dmg * liveDamageMult());
          if (!s.w.pierce) { s.dead = true; break; }
        }
      }
      if (s.traveled >= s.maxDist) s.dead = true;
    } else if (s.kind === 'sweep' || s.kind === 'orbit') {
      if (s.windup && s.windup > 0) { s.windup -= dt; s.t = 0; continue; }
      const k = Math.min(1, s.t / s.dur);
      const prev = s.cur;
      s.cur = s.kind === 'sweep'
        ? s.ang0 + (s.ang1 - s.ang0) * k
        : s.cur + s.spd * dt;
      if (s.ghost) { if (s.t >= s.dur) s.dead = true; continue; }
      // 掃掠帶：上一幀角度到這一幀角度之間的扇區都算刀路
      for (const e of G.enemies) {
        if (e.dead || e.grabbed || e.thrown || s.hit.includes(e)) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d > s.reach + e.r) continue;
        const ea = Math.atan2(e.y - p.y, e.x - p.x);
        const tol = Math.atan2(e.r, Math.max(24, d)) + 0.12;
        const inBand = Math.abs(angDiff(ea, s.cur)) < tol ||
          (Math.abs(angDiff(ea, prev)) + Math.abs(angDiff(ea, s.cur)) <
           Math.abs(angDiff(prev, s.cur)) + tol * 2);
        if (inBand) strikeHit(s, e);
      }
      for (const ib of G.iceblocks) {
        if (s.hitIce === ib) continue;
        const d = Math.hypot(ib.x - p.x, ib.y - p.y);
        if (d > s.reach + ib.r) continue;
        const ia = Math.atan2(ib.y - p.y, ib.x - p.x);
        if (Math.abs(angDiff(ia, s.cur)) < 0.35) {
          s.hitIce = ib;
          hurtIceblock(ib, s.w.dmg * liveDamageMult());
        }
      }
      if (s.t >= s.dur) s.dead = true;
    } else if (s.kind === 'slam') {
      if (s.t >= s.delay && !s.boomed) {
        s.boomed = true;
        spawnFx('shock', p.x, p.y, s.w.color, s.reach);
        G.screenShake = Math.max(G.screenShake, 4 + s.w.dmg * 0.12);
        for (const e of G.enemies) {
          if (e.dead || e.grabbed || e.thrown) continue;
          if (dist2(e.x, e.y, p.x, p.y) < (s.reach + e.r) * (s.reach + e.r)) strikeHit(s, e);
        }
        s.dead = true;
      }
    }
  }
  G.strikes = G.strikes.filter(s => !s.dead);
}

/* 頓幀：打擊感的靈魂。輕命中共用一次（0.12 秒內不重複），重擊與奧義無視冷卻。 */
function addHitstop(sec, heavy) {
  if (!heavy) {
    if (G.hitstopCd > 0) return;
    G.hitstopCd = 0.12 + Math.min(0.2, G.enemies.length * 0.008);
  }
  G.hitstop = Math.max(G.hitstop, sec);
}

function applyWeaponHit(w, e, reach, mulOverride, isEcho, swingId) {
  const p = G.player;
  if (e.dead) return;

  let base = w.dmg * liveDamageMult();
  if (mulOverride) base *= mulOverride;

  // 連段
  const sp = G.char.special;
  let comboMul = 1;
  if (!isEcho) {
    if (p.combo.id === e && p.combo.n < 5) p.combo.n++;
    else if (p.combo.id !== e) { p.combo.id = e; p.combo.n = 1; }
  }
  if (p.combo.id === e) {
    if (sp === 'combo_boxer') comboMul += (p.combo.n - 1) * 0.08;
    if (hasItem('combo_meter')) comboMul += (p.combo.n - 1) * 0.05 * itemCount('combo_meter');
  }
  base *= comboMul;

  // 摔角手強化抓技
  if (sp === 'grab_master' && w.type === 'grab') base *= 1.25;

  // 爆擊
  let crit = false;
  const critChance = p.stats.crit + w.crit;
  if (p.guaranteedCrit && !isEcho) { crit = true; p.guaranteedCrit = false; }
  else if (rng() * 100 < critChance) crit = true;
  if (crit) {
    let cm = w.critMult;
    if (hasItem('famed_koshirae') && w.klass === '刃') cm += 0.4;
    base *= cm;
  }

  // 百鍊指虎：每第 4 次武器命中雙倍
  if (!isEcho && hasItem('hundred_knuckle')) {
    p.hitCount = (p.hitCount + 1) % 4;
    if (p.hitCount === 0) base *= 2;
  }

  // 蓄勢（同拍共鳴）：下三次攻擊 +30%
  if (!isEcho && (p.chargeHits || 0) > 0) {
    base *= 1.3;
    p.chargeHits--;
  }
  // 寸勁蓄力：站樁存的勁，這一擊全部放出來
  if (!isEcho && p.focusStacks > 0) {
    base *= 1 + p.focusStacks * 0.25;
    addDmgNum(p.x, p.y - 34, '寸勁', '#e8964a');
    p.focusStacks = 0;
  }

  const dealt = hurtEnemy(e, base, {
    crit, fromAngle: w.angle, weaponLifesteal: w.lifesteal,
  });

  // ---- 特性：命中觸發 ----
  if (!isEcho && p.traits && p.traits.length) {
    if (hasTrait('burn_stack')) {
      // 烈火拳：可以無限累加。每層 3 點/秒，沿用既有的 dot 通道所以會自動跳傷害數字。
      e.burnStack = (e.burnStack || 0) + 1;
      e.dot = e.burnStack * 3 * liveDamageMult();
      e.dotTime = Math.max(e.dotTime || 0, 3.0);
    }
    if (hasTrait('blood_pact') && dealt > 0 && !e.dead) {
      hurtEnemy(e, dealt * TRAIT_MAP.blood_pact.trueDmg, { trueDmg: true, noLifesteal: true });
    }
    if (p.chainReady) {
      // 雷紋：連鎖閃電，跳三次遞減，附帶減速
      p.chainReady = false;
      const cf = TRAIT_MAP.chain_bolt.proc;
      let from = e, mul = 1;
      const hitSet = [e];
      for (let j = 0; j < cf.jumps; j++) {
        let best = null, bd = 220 * 220;
        for (const o of G.enemies) {
          if (o.dead || hitSet.indexOf(o) >= 0) continue;
          const d2 = dist2(o.x, o.y, from.x, from.y);
          if (d2 < bd) { bd = d2; best = o; }
        }
        if (!best) break;
        mul *= 0.7;
        hurtEnemy(best, techDmg(cf.dmg * mul));
        best.slow = Math.max(best.slow || 0, cf.slow);
        spawnFx('spark', best.x, best.y, '#ffd44a', 26,
          { angle: Math.atan2(best.y - from.y, best.x - from.x) });
        hitSet.push(best); from = best;
      }
      sfx('flash');
    }
  }
  // 記拍：這一下是在什麼狀態打中的（連段收尾判定統一在 addBeat 內）
  if (!isEcho) {
    const b = beatFromState();
    if (b) addBeat(b, false, swingId);
  }

  // 手刀是以「受方反應＋那聲啪」定義的招：橫壓後仰不位移、胸口白閃、脆響
  if (!isEcho && w.klass === '摔技' && !e.dead) {
    const angC = Math.atan2(e.y - p.y, e.x - p.x);
    e.chopHit = { t: 0.22, ang: angC };
    spawnFx('shock', e.x - Math.cos(angC) * e.r * 0.6, e.y - e.r * 0.35, '#ffffff', 26, { img: 'fx_chop_slap' });
  }
  if (!isEcho && (p.comboStep || 0) > 0 && !e.dead) p.lastComboVictim = e;
  // 刀留痕：劍豪的每一刀都在累積，不是每一刀都要見效
  if (!e.dead && w.klass === '刃' && G.char.id === 'kenshi') {
    addCuts(e, isEcho ? 1 : 1, w.angle);   // 居合追斬（isEcho）同樣留痕
  }
  // 連段中每一下命中：受方進遞增踉蹌——對手從第一下到收尾都沒機會站直，那才叫連段
  if (!isEcho && (p.comboStep || 0) > 0 && !e.dead && !e.boss) {
    e.reel = { t: 0.35 + 0.15 * p.comboStep, lean: 0.18 * p.comboStep };
  }
  // 遞進頓幀＋畫面震：第一拍 45ms/3、第二拍 65ms/5——時間上也要聽得出 1、2
  if (!isEcho && (p.comboStep || 0) > 0) {
    addHitstop(p.comboStep >= 2 ? 0.065 : 0.045, false);
    G.screenShake = Math.max(G.screenShake, p.comboStep >= 2 ? 5 : 3);
    p.comboFlash = 0.14;   // 身體閃一下＝這一拍進了
  }
  // 命中音：分層合成（銳利度/重量/材質）＋實錄樣本疊在上面。
  // 力度 force 取這一擊佔對方血量的比例，同一把武器的輕重也聽得出來。
  if (!isEcho) {
    const cs = p.comboStep || 0;
    const co = cs === 1 ? { pitch: 1.0 } : (cs >= 2 ? { pitch: 1.18, vol: 1.2 } : undefined);
    const force = Math.max(0, Math.min(1,
      (crit ? 0.35 : 0) + base / Math.max(24, e.maxHp * 0.55)));
    sfxHit(w.klass, force, co);
    if (w.klass === '摔技') sfx('chop_crack', co);
    else if (w.klass === '刃') sfx('hit_blade', co);
    else if (w.klass === '腿') sfx('hit_kick', co);
    else if (w.klass === '棍' || w.klass === '重械' || w.klass === '軟兵') sfx('hit_blunt', co);
    else if (crit || base >= e.maxHp * 0.3) sfx('hit_heavy', co);
    else if (base >= 20) sfx('hit_mid', co);
    else sfx('hit_light', co);
  }

  if (!isEcho) addMomentum(w.type === 'grab' ? 6 : 3);
  if (p.burst > 0) healPlayer(1);

  // 擊退
  if (!e.dead && w.knock > 0) {
    const a = Math.atan2(e.y - p.y, e.x - p.x);
    let reboundMul = hasItem('rebound_belt') ? 1.5 : 1;
    if (p.setBonus && p.setBonus['掌']) reboundMul *= 1 + KLASS_BONUS['掌'][p.setBonus['掌'] >= 3 ? 's3' : 's2'].knockMul;
    const kb = w.knock * reboundMul * (e.boss ? 0.12 : (e.elite ? 0.4 : 1)) / (1 + e.r * 0.03);
    e.knockX += Math.cos(a) * kb;
    e.knockY += Math.sin(a) * kb;
    // 重武器推得遠、輕武器點到為止——重量要在位移上兌現
    e.knockDecay = (w.klass === '重械' || w.klass === '摔技' || w.klass === '相撲') ? 3.2 : 4.6;
  }
  // 受擊硬直：被打會頓，連段才鎖得住人。連續硬直太久觸發霸體（防無限壓制），頭目免疫輕硬直。
  if (!e.dead && !e.boss) {
    if ((e.hyperArmorT || 0) <= 0) {
      e.stun = Math.max(e.stun, 0.14);
      e.stunAcc = (e.stunAcc || 0) + 0.14;
      if (e.stunAcc > 1.6) { e.hyperArmorT = 2.5; e.stunAcc = 0; }
    }
  }
  // 狀態
  if (!e.dead) {
    if (w.stun > 0) e.stun = Math.max(e.stun, w.stun * (sp === 'grab_master' ? 1.5 : 1));
    if (w.slow > 0) e.slow = Math.max(e.slow, 1.2);
    if (hasItem('snake_legwrap') && w.klass === '腿') e.slow = Math.max(e.slow, 1.0);
    if (w.bleed > 0) { e.bleed = w.bleed * liveDamageMult(); e.bleedTime = 3; }
    if (crit && hasItem('tiger_claw')) { e.bleed = Math.max(e.bleed, 8 * liveDamageMult()); e.bleedTime = 3; }
    if (w.dot > 0) { e.dot = w.dot * liveDamageMult(); e.dotTime = 2.5; }
  }
  if (w.selfArmor) { p.armorBuff = Math.max(p.armorBuff, w.selfArmor); p.armorBuffT = 1.2; }

  // 落地波及（破碎落下）
  if (w.splash > 0 && !isEcho) {
    for (const o of G.enemies) {
      if (o.dead || o === e) continue;
      if (dist2(o.x, o.y, e.x, e.y) < w.splash * w.splash) {
        hurtEnemy(o, base * 0.5, { trueDmg: true });
      }
    }
  }

  // 刺蝟反傷：近戰打它會受傷，但有自己的冷卻，否則高攻速武器等於自殺
  if (e.def && e.def.thorns && !isEcho && (e.thornCd || 0) <= 0) {
    e.thornCd = 0.6;
    // 全近戰沒有遠程解，反傷只能是騷擾：成長走平方根，且單次不得超過最大生命的 7%
    const raw = e.def.thorns * Math.sqrt(enemyScale(G.wave, G.danger).dmg);
    const t = Math.min(raw, p.maxHp * 0.07);
    const cut = 1 - armorCut(p.stats.armor);
    p.hp -= t * cut;
    G.stats.dmgTaken += t * cut;
    noteDmg('刺蝟反傷', t * cut);
    addDmgNum(p.x, p.y - 12, '-' + Math.round(t * cut), '#c07ad9');
    if (p.hp <= 0) { p.hp = 0; p.dead = true; G.mode = 'gameover'; onRunEnd(false); }
  }

  if (crit && !isEcho) {
    if (sp === 'iai' && !e.dead) hurtEnemy(e, base * 0.7 / w.critMult, { crit: true, fromAngle: w.angle });
    if (sp === 'crit_shock') {
      // 拳頭是往前打穿的，不是往四周炸開（總監明令：近戰的拳不該是圓形範圍）。
      // 震盪從命中點沿拳路往後方傳，只波及站在那條線上的人——貫通不是擴散。
      const sa = w.angle;
      const ex0 = e.x, ey0 = e.y;
      const REACH = 96, HALFW = 30;
      spawnFx('swing', ex0, ey0, '#ffffff', REACH, { angle: sa, arc: 34, type: 'arc' });
      spawnFx('spark', ex0, ey0, '#ffffff', e.r, { angle: sa });
      G.enemies.forEach(o => {
        if (o.dead || o === e) return;
        const rx = o.x - ex0, ry = o.y - ey0;
        const along = rx * Math.cos(sa) + ry * Math.sin(sa);      // 沿拳路往前
        const side = Math.abs(-rx * Math.sin(sa) + ry * Math.cos(sa));
        if (along >= -12 && along <= REACH && side <= HALFW + o.r) {
          hurtEnemy(o, base * 0.5, { trueDmg: true, fromAngle: sa });
        }
      });
    }
  }
}

/* ---------- 玩家更新 ---------- */
function updatePlayer(dt) {
  const p = G.player;
  if (p.dead) return;
  updateTechniques(dt);
  if (p.dead) return;
  updateTraits(dt);   // 解縛反噬等絕技效果可能剛好歸零生命
  const k = G.keys;
  let mx = 0, my = 0;
  if (k['a'] || k['arrowleft']) mx -= 1;
  if (k['d'] || k['arrowright']) mx += 1;
  if (k['w'] || k['arrowup']) my -= 1;
  if (k['s'] || k['arrowdown']) my += 1;
  // 衝刺中身體不歸自己管；踉蹌時腿軟
  if (p.dashState || p.staggerT > 0 || (p.iaiPhase && p.iaiPhase.phase === 'sheath') ||
      p.suplexAnim || p.hipTossAnim || p.ddtState || p.tossState || p.gutRoll || p.thrustChain) { mx = 0; my = 0; }
  const len = Math.hypot(mx, my);
  const moving = len > 0;
  if (moving) { mx /= len; my /= len; }
  // 面向打擊目標，不是面向移動方向——身體要參與戰鬥
  const aimT = nearestEnemy(p.x, p.y, 320);
  if (aimT) p.aimAng = Math.atan2(aimT.y - p.y, aimT.x - p.x);
  else if (moving) p.aimAng = Math.atan2(my, mx);
  if (p.aimAng !== undefined) {
    const ca = Math.cos(p.aimAng);
    if (Math.abs(ca) > 0.25) p.face = ca > 0 ? 1 : -1;
  }

  let spd = BASE_SPEED_F() * liveSpeedMult();
  // 疾走：+100% 移速，受傷後失效 6 秒
  const _sp = traitOf('sprint');
  if (_sp && (p.sprintLock || 0) <= 0) spd *= _sp.sprint.mul;
  if (p.grabState) spd *= 0.7;          // 掄著人跑比較慢
  if (moving) { p.lastMoveX = mx; p.lastMoveY = my; }
  p.vx = mx * spd; p.vy = my * spd;
  p.x += p.vx * dt; p.y += p.vy * dt;
  p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x));
  p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y));
  pushOutOfWalls(p);
  p.walkAnim += moving ? dt * 10 : -p.walkAnim * dt * 8;

  if (moving) { p.moveTime = Math.min(1, p.moveTime + dt); p.stillT = 0; p.stancePop = false; }
  else {
    p.moveTime = 0;
    const prevStill = p.stillT;
    p.stillT += dt;
    // 架式成形的那一拍：收束環＋定住——玩家要知道 0.5 秒到了
    if (prevStill < 0.5 && p.stillT >= 0.5 && !p.stancePop) {
      p.stancePop = true;
      const md = MOVE_MAP[p.moves.still];
      spawnFx('shock', p.x, p.y, (md && md.color) || '#e8e4dc', 26);
      p.stancePopT = 0.08;
    }
    if (p.stancePopT > 0) p.stancePopT -= dt;
  }

  if (p.iframe > 0) p.iframe -= dt;
  if (p.armorBuffT > 0) { p.armorBuffT -= dt; if (p.armorBuffT <= 0) p.armorBuff = 0; }

  // 氣勢衰退
  if (p.burst > 0) {
    p.burst -= dt;
    if (p.burst <= 0) { p.burst = 0; p.momentum = 0; }
  } else {
    p.hitIdle += dt;
    const decay = hasItem('immovable_sash') ? 7 : 14;
    if (p.hitIdle > 2) p.momentum = Math.max(0, p.momentum - dt * decay);
  }

  // 混混：素材攻速層數衰退
  if (p.scrapStacks > 0) {
    p.scrapTimer -= dt;
    if (p.scrapTimer <= 0) { p.scrapStacks--; p.scrapTimer = 3; }
  }

  // 回復：負值代表「回得更慢／完全不回」，絕不反過來扣血
  const regen = p.stats.regen;
  if (regen > 0) { p.regenAcc += regen * dt; }
  if (p.regenAcc >= 1) { const n = Math.floor(p.regenAcc); p.regenAcc -= n; healPlayer(n); }

  // 相撲：碰撞傷害
  if (G.char.special === 'body_check') {
    G.enemies.forEach(e => {
      if (e.dead) return;
      const rr = (p.r + e.r + 2);
      if (dist2(p.x, p.y, e.x, e.y) < rr * rr) {
        hurtEnemy(e, 12 * dt * liveDamageMult(), { trueDmg: true });
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.knockX += Math.cos(a) * 160 * dt * 8;
        e.knockY += Math.sin(a) * 160 * dt * 8;
      }
    });
  }
}

/* ---------- 敵人更新 ---------- */
function updateEnemies(dt) {
  const p = G.player;
  for (const e of G.enemies) {
    if (e.dead) continue;
    e.anim += dt * 6;
    if (e.hitFlash > 0) e.hitFlash -= dt;
    if (e.hitSquash > 0) e.hitSquash -= dt;
    if (e.chopHit) { e.chopHit.t -= dt; if (e.chopHit.t <= 0) e.chopHit = null; }
    if (e.cutT > 0) { e.cutT -= dt; if (e.cutT <= 0) e.cuts = 0; }
    if (e.severFlash > 0) e.severFlash -= dt;
    if (e.flat) { e.flat.t -= dt; if (e.flat.t <= 0) e.flat = null; }
    // 居合的延遲連斬：0.3 秒後才裂開，之後連續三段
    if (e.iaiCut) {
      const ic = e.iaiCut;
      ic.t -= dt;
      if (ic.t <= 0) {
        ic.n--;
        ic.t = 0.12;
        if (G.char && G.char.id === 'kenshi') addCuts(e, 1, 0);
        sfx('hit_blade');
        spawnFx('spark', e.x, e.y, '#ffffff', e.r, { angle: rng() * Math.PI * 2 });
        hurtEnemy(e, ic.dmg, { crit: chance(0.35), trueDmg: true, noLifesteal: false });
        if (ic.n <= 0 || e.dead) e.iaiCut = null;
      }
    }
    if (e.hyperArmorT > 0) e.hyperArmorT -= dt;
    if (e.stunAcc > 0) e.stunAcc -= dt * 0.5;
    if (e.slow > 0) e.slow -= dt;
    if (e.thornCd > 0) e.thornCd -= dt;
    if (e.bleedTime > 0) {
      e.bleedTime -= dt;
      hurtEnemy(e, e.bleed * dt, { noLifesteal: true, trueDmg: true });
      if (e.dead) continue;
    }
    if (e.dotTime > 0) {
      e.dotTime -= dt;
      hurtEnemy(e, e.dot * dt, { noLifesteal: true, trueDmg: true });
      if (e.dead) continue;
    }

    // 被抓住＝身體歸玩家管，AI 完全停擺。
    // 安全網：確認真的有人持有他（擒抱/飛天摔/迴旋摔/扛人衝刺/掛臂），沒有就當場釋放。
    if (e.grabbed) {
      const pl = G.player;
      const held = pl && !pl.dead && (
        (pl.grabState && (pl.grabState.e === e || pl.grabState.carried === e)) ||
        (pl.airSlam && pl.airSlam.e === e) ||
        (pl.dashState && (pl.dashState.carried === e ||
          (pl.dashState.latched && pl.dashState.latched.some(L => L.e === e && !L.done)))));
      if (held) continue;
      e.grabbed = false;
      e.stun = Math.min(e.stun, 0.8);
      e.thrown = { vx: 0, vy: 0, t: 0.1 };
    }

    // 被扔出去：飛行中撞傷沿路的敵人；撞牆／撞大隻的會反彈（總監：強化破壞性與震撼性）
    if (e.thrown) {
      const th = e.thrown;
      th.t -= dt;
      if (e.spin) { e.spin.a += e.spin.v * dt; e.spin.t -= dt; if (e.spin.t <= 0) e.spin = null; }
      e.x += th.vx * dt; e.y += th.vy * dt;
      const thd = Math.exp(-(th.decay || 3) * dt);
      th.vx *= thd; th.vy *= thd;
      const spd = Math.hypot(th.vx, th.vy);
      for (const o of G.enemies) {
        if (o.dead || o === e || o.thrown || o.grabbed || o.hitByThrow) continue;
        const rr = o.r + e.r + 2;
        if (dist2(o.x, o.y, e.x, e.y) < rr * rr) {
          o.hitByThrow = true;
          const big = o.boss || o.elite || o.r >= e.r * 1.25;   // 中型以上撞不動，飛的人自己彈回來
          hurtEnemy(o, throwDmg(big ? 20 : 12), { trueDmg: true });
          if (!o.dead) {
            const a = Math.atan2(o.y - e.y, o.x - e.x);
            o.knockX += Math.cos(a) * (big ? 90 : 180); o.knockY += Math.sin(a) * (big ? 90 : 180);
            if (!big) o.stun = Math.max(o.stun, 0.4);
          }
          if (big && (th.bounces || 0) < 2 && spd > 180) {
            // 撞到硬的：反彈＋雙方都痛，這是撞球式的破壞
            th.bounces = (th.bounces || 0) + 1;
            const nx = (e.x - o.x), ny = (e.y - o.y);
            const nl = Math.hypot(nx, ny) || 1;
            const dot = (th.vx * nx + th.vy * ny) / nl;
            th.vx = (th.vx - 2 * dot * nx / nl) * 0.72;
            th.vy = (th.vy - 2 * dot * ny / nl) * 0.72;
            th.t = Math.max(th.t, 0.3);
            hurtEnemy(e, throwDmg(10 + o.maxHp * 0.06), { trueDmg: true });
            spawnFx('explode', (e.x + o.x) / 2, (e.y + o.y) / 2, '#e8964a', 76);
            G.screenShake = Math.max(G.screenShake, 11);
            addHitstop(0.06, true);
            sfxWallCrash(false);
            e.hitSquash = Math.max(e.hitSquash || 0, 0.26);
            G.enemies.forEach(o2 => { if (o2 !== o) o2.hitByThrow = false; });
          }
        }
      }
      const hitWall = e.x <= e.r + 2 || e.x >= ARENA.w - e.r - 2 || e.y <= e.r + 2 || e.y >= ARENA.h - e.r - 2;
      const hitBlock = pushOutOfWalls(e);
      if (e.enraged && hitBlock) {
        // 激怒＝不受牆阻擋：被牆推回來就直接朝玩家跨過去，確保這一波解得掉
        const pg = G.player;
        const dxg = pg.x - e.x, dyg = pg.y - e.y, dg = Math.hypot(dxg, dyg) || 1;
        e.x += dxg / dg * 34; e.y += dyg / dg * 34;
      }
      clampEnemy(e);
      if (hitWall || hitBlock) {
        const hard = spd > 420;
        // 撞牆傷害隨速度放大：轟得越用力、撞得越慘
        hurtEnemy(e, throwDmg((8 + e.maxHp * 0.12) * (hard ? 1.8 : 1)), { trueDmg: true });
        if (!e.dead) {
          e.stun = Math.max(e.stun, hard ? 1.4 : 0.8);
          e.hitSquash = Math.max(e.hitSquash || 0, hard ? 0.3 : 0.2);
        }
        spawnFx('explode', e.x, e.y, '#c2703c', hard ? 110 : 70);
        spawnFx('shock', e.x, e.y, '#e8964a', hard ? 120 : 80, { img: 'fx_slam_ring', squash: 0.5 });
        G.screenShake = Math.max(G.screenShake, hard ? 16 : 9);
        if (hard) addHitstop(0.09, true);
        sfxWallCrash(hard);
        // 撞牆的震波掃到旁邊的人（震撼性：一個人撞牆、周圍跟著遭殃）
        if (hard) {
          for (const o of G.enemies) {
            if (o.dead || o === e) continue;
            if (dist2(o.x, o.y, e.x, e.y) < 90 * 90) {
              hurtEnemy(o, throwDmg(10), { trueDmg: true });
              if (!o.dead) o.stun = Math.max(o.stun, 0.5);
            }
          }
        }
        // 還有速度就從牆上彈開（不是貼著牆停死）
        if ((th.bounces || 0) < 2 && spd > 260) {
          th.bounces = (th.bounces || 0) + 1;
          if (e.x <= e.r + 3 || e.x >= ARENA.w - e.r - 3) th.vx = -th.vx * 0.55;
          if (e.y <= e.r + 3 || e.y >= ARENA.h - e.r - 3) th.vy = -th.vy * 0.55;
          if (hitBlock) { th.vx = -th.vx * 0.55; th.vy = -th.vy * 0.55; }
          th.t = Math.max(th.t, 0.28);
          if (e.spin) e.spin.v *= -0.8;
        } else {
          e.thrown = null;
          if (!e.dead) e.flat = { t: 0.9 };
        }
      } else if (th.t <= 0) {
        if (!e.dead) e.stun = Math.max(e.stun, 0.5);
        e.thrown = null;
      }
      if (!e.thrown) G.enemies.forEach(o => { o.hitByThrow = false; });
      continue;
    }

    // 擊退位移
    e.x += e.knockX * dt; e.y += e.knockY * dt;
    // 迴力腰帶：被打飛撞牆會痛
    if (e.wallCrashCd > 0) e.wallCrashCd -= dt;
    if (hasItem('rebound_belt') && (e.wallCrashCd || 0) <= 0) {
      const kSpd = Math.hypot(e.knockX, e.knockY);
      const atWall = pushOutOfWalls(e) || e.x <= e.r + 2 || e.x >= ARENA.w - e.r - 2 || e.y <= e.r + 2 || e.y >= ARENA.h - e.r - 2;
      if (atWall && kSpd > 240) {
        e.wallCrashCd = 0.5;
        hurtEnemy(e, techDmg(8) + kSpd * 0.035, { trueDmg: true });
        if (!e.dead) e.stun = Math.max(e.stun, 0.4);
        spawnFx('explode', e.x, e.y, '#c98a3c', 50);
        e.knockX = 0; e.knockY = 0;
      }
    }
    const kdcy = Math.exp(-(e.knockDecay || 6.44) * dt);
    e.knockX *= kdcy; e.knockY *= kdcy;

    if (e.reel) {
      e.reel.t -= dt;
      if (e.reel.t <= 0) e.reel = null;
      else { clampEnemy(e); continue; }
    }
    if (e.stun > 0) { e.stun -= dt; clampEnemy(e); continue; }

    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    e.face = ux > 0 ? 1 : -1;
    let spd = e.speed * (e.slow > 0 ? 0.6 : 1);
    // 清場逾時的激怒狀態：直奔玩家、快到追得上，而且不再被牆卡住
    if (e.enraged) spd = Math.max(spd, 320) * 1.6;
    if (G.waveEnding > 0) spd *= 0.3;

    // ★ 激怒必須覆寫「行為的目標選擇」，不能只加速度。
    //   治療師／投擲手／鬼火的行為本身是「玩家靠近就往反方向跑」，
    //   只把 spd 拉到 512 等於讓它們逃得比玩家（約 156）還快 3 倍——
    //   在「殺光才過關」的規則下那是一個真的軟鎖（實測 4 次激怒 0 次解決卡關，
    //   3/4 是治療師被逼到場地角落才停下來）。這裡直接跳過原本的行為分支，一律直撲玩家。
    if (e.enraged) {
      e.x += ux * spd * dt; e.y += uy * spd * dt;
    } else
    switch (e.behavior) {
      case 'chase':
      case 'splitter':
      case 'spiker':
        e.x += ux * spd * dt; e.y += uy * spd * dt;
        break;

      case 'shielder':
        e.x += ux * spd * dt; e.y += uy * spd * dt;
        break;

      case 'thrower': {
        const kd = e.def.keepDist;
        if (d > kd + 30) { e.x += ux * spd * dt; e.y += uy * spd * dt; }
        else if (d < kd - 40) { e.x -= ux * spd * 0.8 * dt; e.y -= uy * spd * 0.8 * dt; }
        else { e.x += -uy * spd * 0.5 * dt; e.y += ux * spd * 0.5 * dt; }
        e.cd -= dt;
        if (e.cd <= 0 && d < kd + 140) {
          e.cd = e.def.shotCd;
          const sp = e.def.shotSpd;
          G.projectiles.push({
            x: e.x, y: e.y, vx: ux * sp, vy: uy * sp, r: 6,
            dmg: e.dmg, life: 3.2, owner: e, color: '#8fd4e0',
          });
        }
        break;
      }

      case 'charger': {
        e.cd -= dt;
        if (e.state === 'dash') {
          e.stateT -= dt;
          e.x += e.dirX * e.def.dashSpd * dt; e.y += e.dirY * e.def.dashSpd * dt;
          if (e.stateT <= 0) { e.state = 'idle'; e.cd = e.def.dashCd; }
        } else if (e.state === 'wind') {
          e.stateT -= dt;
          if (e.stateT <= 0) { e.state = 'dash'; e.stateT = 0.55; e.dirX = ux; e.dirY = uy; }
        } else {
          e.x += ux * spd * dt; e.y += uy * spd * dt;
          if (e.cd <= 0 && d < 300) { e.state = 'wind'; e.stateT = 0.45; }
        }
        break;
      }

      case 'bomber': {
        e.x += ux * spd * dt; e.y += uy * spd * dt;
        if (d < e.def.blast * 0.55 || e.state === 'fuse') {
          if (e.state !== 'fuse') { e.state = 'fuse'; e.stateT = e.def.fuse; }
          e.stateT -= dt;
          if (e.stateT <= 0) {
            spawnFx('explode', e.x, e.y, '#ffb03c', e.def.blast);
            G.screenShake = Math.max(G.screenShake, 10);
            if (dist2(p.x, p.y, e.x, e.y) < e.def.blast * e.def.blast) hurtPlayer(e.dmg, e);
            e.hp = 0; killEnemy(e);
          }
        }
        break;
      }

      case 'healer': {
        if (d < 240) { e.x -= ux * spd * dt; e.y -= uy * spd * dt; }
        else { e.x += -uy * spd * 0.6 * dt; e.y += ux * spd * 0.6 * dt; }
        e.cd -= dt;
        if (e.cd <= 0) {
          e.cd = e.def.healCd;
          let healed = false;
          G.enemies.forEach(o => {
            if (o.dead || o === e || o.hp >= o.maxHp) return;
            if (dist2(o.x, o.y, e.x, e.y) < e.def.healRange * e.def.healRange) {
              o.hp = Math.min(o.maxHp, o.hp + e.def.healAmt * enemyScale(G.wave, G.danger).hp);
              healed = true;
              spawnFx('heal_link', e.x, e.y, '#7ac9a0', 0, { tx: o.x, ty: o.y });
            }
          });
          if (!healed) e.cd = 0.8;
        }
        break;
      }

      case 'summoner': {
        if (d < 300) { e.x -= ux * spd * 0.7 * dt; e.y -= uy * spd * 0.7 * dt; }
        else { e.x += ux * spd * 0.4 * dt; e.y += uy * spd * 0.4 * dt; }
        e.cd -= dt;
        if (e.cd <= 0) {
          e.cd = e.def.sumCd;
          for (let i = 0; i < e.def.sumN; i++) {
            const a = rng() * Math.PI * 2;
            spawnEnemy('grunt', e.x + Math.cos(a) * 30, e.y + Math.sin(a) * 30);
          }
          spawnFx('summon', e.x, e.y, '#8a6bb0', 46);
        }
        break;
      }

      case 'boss':
        updateBoss(e, dt, ux, uy, d);
        break;
    }

    clampEnemy(e);

    // 接觸傷害
    const rr = p.r + e.r;
    if (!p.dead && dist2(p.x, p.y, e.x, e.y) < rr * rr) {
      hurtPlayer(e.dmg, e);
      if (e.behavior === 'charger' && e.state === 'dash') { e.state = 'idle'; e.cd = e.def.dashCd; }
    }
  }
  G.enemies = G.enemies.filter(e => !e.dead);
}

function clampEnemy(e) {
  e.x = Math.max(e.r, Math.min(ARENA.w - e.r, e.x));
  e.y = Math.max(e.r, Math.min(ARENA.h - e.r, e.y));
  pushOutOfWalls(e);
}

function updateBoss(e, dt, ux, uy, d) {
  const p = G.player;
  e.cd -= dt;
  if (e.phase === 'champ') {
    if (e.state === 'rush') {
      e.stateT -= dt;
      e.x += e.dirX * 400 * dt; e.y += e.dirY * 400 * dt;
      if (e.stateT <= 0) {
        e.combo = (e.combo || 0) - 1;
        spawnFx('explode', e.x + e.dirX * 40, e.y + e.dirY * 40, '#d9564f', 70);
        if (dist2(p.x, p.y, e.x + e.dirX * 40, e.y + e.dirY * 40) < 70 * 70) hurtPlayer(e.dmg, e);
        if (e.combo > 0) { e.state = 'wind'; e.stateT = 0.35; }
        else { e.state = 'idle'; e.cd = 2.4; }
      }
    } else if (e.state === 'wind') {
      e.stateT -= dt;
      if (e.stateT <= 0) { e.state = 'rush'; e.stateT = 0.42; e.dirX = ux; e.dirY = uy; }
    } else {
      e.x += ux * e.speed * dt; e.y += uy * e.speed * dt;
      if (e.cd <= 0) { e.state = 'wind'; e.stateT = 0.5; e.combo = 3; }
    }
  } else {
    // 橫綱：張手震波 + 踏震
    const rage = e.hp / e.maxHp < 0.45 ? 1.5 : 1;
    if (e.state === 'stomp') {
      e.stateT -= dt;
      if (e.stateT <= 0) {
        e.state = 'idle'; e.cd = 3.0 / rage;
        spawnFx('shock', e.x, e.y, '#c9576b', 200);
        G.screenShake = 16;
        if (dist2(p.x, p.y, e.x, e.y) < 200 * 200) hurtPlayer(e.dmg, e);
      }
    } else if (e.state === 'wave') {
      e.stateT -= dt;
      if (e.stateT <= 0) {
        e.state = 'idle'; e.cd = 2.6 / rage;
        const n = 10;
        for (let i = 0; i < n; i++) {
          const a = Math.atan2(uy, ux) + (i - n / 2) * 0.18;
          G.projectiles.push({
            x: e.x, y: e.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260,
            r: 9, dmg: e.dmg * 0.7, life: 3, owner: e, color: '#e08aa0',
          });
        }
      }
    } else {
      e.x += ux * e.speed * rage * dt; e.y += uy * e.speed * rage * dt;
      if (e.cd <= 0) {
        if (d < 220) { e.state = 'stomp'; e.stateT = 0.7; }
        else { e.state = 'wave'; e.stateT = 0.6; }
      }
    }
  }
}

/* ---------- 投射物 ---------- */
function updateProjectiles(dt) {
  const p = G.player;
  for (const b of G.projectiles) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0) { b.dead = true; continue; }
    if (b.x < 0 || b.x > ARENA.w || b.y < 0 || b.y > ARENA.h) { b.dead = true; continue; }
    const rr = p.r + b.r;
    if (!p.dead && dist2(p.x, p.y, b.x, b.y) < rr * rr) {
      hurtPlayer(b.dmg, b.owner);
      b.dead = true;
    }
  }
  G.projectiles = G.projectiles.filter(b => !b.dead);
}

/* ---------- 掉落物 ---------- */
function updatePickups(dt) {
  const p = G.player;
  let magnetR = 78 + p.stats.luck * 0.35;
  if (hasItem('magnet')) magnetR += 90 * itemCount('magnet');
  if (G.waveEnding > 0) magnetR = 3000;
  for (const it of G.pickups) {
    it.t += dt;
    it.x += it.vx * dt; it.y += it.vy * dt;
    it.vx *= Math.pow(0.02, dt); it.vy *= Math.pow(0.02, dt);
    const d = Math.hypot(p.x - it.x, p.y - it.y);
    if (d < magnetR) {
      const pull = Math.min(760, 200 + (magnetR - d) * 6);
      it.x += (p.x - it.x) / d * pull * dt;
      it.y += (p.y - it.y) / d * pull * dt;
    }
    if (d < p.r + 12) collectPickup(it);
  }
  G.pickups = G.pickups.filter(i => !i.dead);
}

function collectPickup(it) {
  it.dead = true;
  const p = G.player;
  if (it.type === 'mat') {
    G.materials += it.value;
    G.waveMat = (G.waveMat || 0) + it.value;
    G.totalMaterials += it.value;
    gainXp(it.value);
    if (hasItem('training_gi')) healPlayer(1);
    if (G.char.special === 'scrap_rush') {
      p.scrapStacks = Math.min(10, p.scrapStacks + 1);
      p.scrapTimer = 3;
    }
  } else if (it.type === 'heal') {
    sfx('heal');
    healPlayer(Math.max(5, p.maxHp * 0.1));
  } else if (it.type === 'crate') {
    const item = rollItem(tierUnlock(G.wave));
    grantItem(item.id);
    addDmgNum(p.x, p.y - 40, '獲得 ' + item.name, '#d9b06a', true);
  }
}

function gainXp(n) {
  G.xp += n;
  let need = xpNeeded(G.level);
  while (G.xp >= need) {
    G.xp -= need;
    G.level++;
    G.levelQueue++;
    need = xpNeeded(G.level);
  }
  if (G.levelQueue > 0 && G.mode === 'playing') openLevelUp();
}

function grantItem(id) {
  const def = ITEM_MAP[id];
  G.player.items.push(def);
  recalcStats(G.player);
}

/* ---------- 升級四選一：格鬥家裝備 ----------
   升級給的是裝備而不是裸數字。unique 裝備擁有後不再出現；
   非 unique 的四件交換型可以疊。每次升級固定附贈少量生命上限，
   讓成長曲線不因「全拿功能型裝備」而斷掉。
*/
const LEVELUP_HP_BONUS = 3;

function openLevelUp() {
  const ownedIds = {};
  G.player.items.forEach(i => ownedIds[i.id] = true);
  const pool = GEAR.filter(g => !(g.unique && ownedIds[g.id]));
  const chosen = [];
  const used = {};
  let guard = 0;
  while (chosen.length < Math.min(4, pool.length) && guard++ < 80) {
    const g = pick(pool);
    if (used[g.id]) continue;
    used[g.id] = true;
    chosen.push(g);
  }
  G.levelChoices = chosen;
  G.mode = 'levelup';
  if (typeof onModeChange === 'function') onModeChange();
}

function chooseLevelUp(idx) {
  const g = G.levelChoices[idx];
  G.player.items.push(GEAR_MAP[g.id]);
  sfx('levelup');
  // 裝備為主、屬性為輔：每級附贈小額基礎成長，曲線才追得上敵人
  G.player.perm.maxHp += TUNE.levelHp;
  G.player.perm.dmg += TUNE.levelDmg;
  recalcStats(G.player);
  G.levelQueue--;
  G.levelChoices = null;
  if (G.levelQueue > 0) openLevelUp();
  else {
    G.mode = G.pendingShop ? 'shop' : 'playing';
    if (G.pendingShop) { G.pendingShop = false; openShop(); }
    if (typeof onModeChange === 'function') onModeChange();
  }
}

/* ---------- 波次結束 ---------- */
function updateWave(dt) {
  if ((G.spawnClosedT || 0) > 0) G.spawnClosedT -= dt;
  if (G.tally) {
    G.tally.t += dt;
    // 演完之後等玩家按鍵，或 1.4 秒後自動走（不要逼玩家等，也不要來不及看）
    if (G.tally.t >= G.tally.dur + 1.4 || (G.tally.t >= G.tally.dur * 0.8 && G.tallySkip)) {
      G.tallySkip = false;
      const t = G.tally; G.tally = null;
      finishWaveReal(t);
    }
    return;
  }
  if (G.waveEnding > 0) {
    G.waveEnding -= dt;
    if (G.waveEnding <= 0) finishWave();
    return;
  }
  if (!G.spawnClosed) {
    G.waveTime += dt;
    if (G.waveTime >= G.waveDur) {
      // 出兵時間到：不再補人，但這一波還沒結束——場上的要殺光。
      // （舊行為是碼表一到就直接跳結算，剩下的敵人憑空消失，很突兀。）
      G.spawnClosed = true;
      G.spawnBudget = 0;
      sfx('quake');   // 出兵停止：一記悶響，跟一般命中音分家
      G.spawnClosedT = 2.2;
    }
    return;
  }
  // 清場階段：殺光才進結算。
  // ★ 但不能讓玩家卡死：敵人的 chase 是直線衝向玩家，撞到牆就壓在牆上不動，
  //   一隻卡在角落的雜兵會讓整波無法結束，玩家只會以為遊戲當掉。
  //   停生怪 22 秒之後，剩下的全部進入「激怒」——高速直奔玩家且不受牆阻擋。
  //   這比「時間到讓它們消失」好：規則還是殺光才過關，只是保證解得掉。
  const alive = G.enemies.filter(e => !e.dead);
  if (alive.length) {
    G.clearT = (G.clearT || 0) + dt;
    if (G.clearT > 22) {
      alive.forEach(e => {
        if (!e.enraged) {
          e.enraged = true;
          spawnFx('shock', e.x, e.y, '#d9564f', e.r * 2.2);
        }
      });
    }
    return;
  }
  G.clearT = 0;
  G.waveEnding = 1.4;   // 先把地上的素材吸乾淨，再跑結算
}

function finishWave() {
  G.pickups.forEach(it => { if (!it.dead) collectPickup(it); });
  G.pickups = [];
  // 結算演出：數字一格一格跳出來，不要「忽然卡掉」直接進商店（總監 2026-08-04 指令）
  if (!G.tally) {
    const harvestPre = Math.round(G.player.stats.harvest * (1 + G.wave * 0.15));
    G.tally = {
      t: 0, dur: 2.9, wave: G.wave,
      kills: G.waveKills || 0, mat: G.waveMat || 0,
      harvest: harvestPre, hp: Math.round(G.player.hp), maxHp: Math.round(G.player.maxHp),
      best: G.comboBest || 0,
    };
    sfx('levelup');
    return;
  }
  finishWaveReal(null);
}

/* 結算演完之後才真的過關 */
function finishWaveReal() {
  G.player.hp = G.player.maxHp;   // 波間回滿：每一波都是新的擂台
  G.enemies = [];
  G.projectiles = [];
  const harvest = Math.round(G.player.stats.harvest * (1 + G.wave * 0.15));
  if (harvest > 0) { G.materials += harvest; G.totalMaterials += harvest; }
  if (G.wave >= MAX_WAVE) { G.mode = 'victory'; onRunEnd(true); if (typeof onModeChange === 'function') onModeChange(); return; }
  // 打完頭目才給特性抉擇（總監 2026-08-04）：那是會改變打法的東西，
  // 放進升級四選一會把那個已經定案要維持樸素的介面撐爆。
  if (isBossWave(G.wave)) { G.pendingShop = true; openTraitPick(); return; }
  if (G.levelQueue > 0) { G.pendingShop = true; openLevelUp(); }
  else { openShop(); }
}

function openTraitPick() {
  const own = G.player.traits || [];
  const pool = TRAITS.filter(t => own.indexOf(t.id) < 0);
  const picks = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    picks.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  if (!picks.length) { openShop(); return; }
  G.traitChoices = picks;
  G.mode = 'trait';
  if (typeof onModeChange === 'function') onModeChange();
}

function chooseTrait(i) {
  const _p = G.player;
  const t = G.traitChoices && G.traitChoices[i];
  if (!t) return;
  G.player.traits.push(t.id);
  G.traitChoices = null;
  recalcStats(_p);
  if (G.pendingShop) { G.pendingShop = false; openShop(); }
  else { G.mode = 'playing'; }
  if (typeof onModeChange === 'function') onModeChange();
}

/* 特性查詢：引擎各處用這兩個，不要各自去翻 traits 陣列 */
function hasTrait(id) { const p = G.player; return !!(p && p.traits && p.traits.indexOf(id) >= 0); }
function traitOf(id) { return hasTrait(id) ? TRAIT_MAP[id] : null; }

/* ---------- 商店 ---------- */
function rollItem(maxTier) {
  const luck = G.player ? G.player.stats.luck : 0;
  const w = [0, 100, 26 + luck * 0.5, 7 + luck * 0.35, 1.6 + luck * 0.16];
  let tier = 1, total = 0;
  for (let t = 1; t <= maxTier; t++) total += w[t];
  let r = rng() * total;
  for (let t = 1; t <= maxTier; t++) { r -= w[t]; if (r <= 0) { tier = t; break; } }
  const pool = ITEMS.filter(i => i.tier === tier);
  return pool.length ? pick(pool) : pick(ITEMS.filter(i => i.tier === 1));
}

function rollShopEntry() {
  const maxT = tierUnlock(G.wave);
  // 招式（衝刺技／移動技／站樁技）：第 2 波起出現，還沒學過的才會上架
  const known = G.player.knownMoves;
  const movePool = MOVES.filter(m => !known.includes(m.id));
  if (G.wave >= 2 && movePool.length && chance(0.16)) {
    const t = pick(movePool);
    return {
      kind: 'tech', id: t.id, tier: 2,
      name: t.name, color: t.color, icon: 'tech',
      price: Math.round(t.price * shopInflation(G.wave)),
      locked: false, sold: false,
    };
  }
  // 收尾招：第 2 波起，還沒買過的才上架。這是連段盤的燃料——
  // 總監要「複雜度放在招式上」，所以它的出現率要跟武器同量級，不是稀有彩蛋。
  const finPool = (typeof unownedFinishers === 'function') ? unownedFinishers() : [];
  if (G.wave >= 2 && finPool.length && chance(0.22)) {
    const f = pick(finPool);
    return {
      kind: 'fin', id: f.id, tier: f.tier || 1,
      name: f.name, color: '#e0c341', icon: 'tech',
      price: Math.round((f.price || 24) * shopInflation(G.wave)),
      locked: false, sold: false,
    };
  }
  const wantWeapon = chance(0.42);
  if (wantWeapon) {
    const luck = G.player.stats.luck;
    const w = [0, 100, 24 + luck * 0.5, 6 + luck * 0.3, 1.2 + luck * 0.14];
    let total = 0;
    for (let t = 1; t <= maxT; t++) total += w[t];
    let r = rng() * total, tier = 1;
    for (let t = 1; t <= maxT; t++) { r -= w[t]; if (r <= 0) { tier = t; break; } }
    // 有機會端出你已經持有的同階武器，合成才會是活的機制而不是擺設
    let base = pick(WEAPONS);
    const owned = G.player.weapons.filter(o => o.tier < 4 && o.tier <= maxT);
    if (owned.length && chance(0.34)) {
      const o = pick(owned);
      base = WEAPON_MAP[o.id];
      tier = o.tier;
    }
    return {
      kind: 'weapon', id: base.id, tier,
      name: base.name, color: base.color, icon: base.icon,
      price: Math.round(weaponPrice(base.id, tier) * shopInflation(G.wave)),
      locked: false, sold: false,
    };
  } else {
    const it = rollItem(maxT);
    return {
      kind: 'item', id: it.id, tier: it.tier,
      name: it.name, color: TIER_COLOR[it.tier], icon: 'item',
      price: Math.round(it.price * shopInflation(G.wave)),
      locked: false, sold: false,
    };
  }
}

function openShop() {
  G.shop = {
    entries: [rollShopEntry(), rollShopEntry(), rollShopEntry(), rollShopEntry()],
    rerollCost: 1 + Math.floor(G.wave * 0.6),
    rerolls: 0,
  };
  G.mode = 'shop';
  if (typeof onModeChange === 'function') onModeChange();
}

function shopReroll() {
  const s = G.shop;
  if (G.materials < s.rerollCost) return false;
  G.materials -= s.rerollCost;
  s.rerolls++;
  s.rerollCost = 1 + Math.floor(G.wave * 0.6) + s.rerolls;
  s.entries = s.entries.map(e => (e.locked && !e.sold) ? e : rollShopEntry());
  return true;
}

function shopBuy(idx, replaceSlot) {
  const s = G.shop, e = s.entries[idx];
  if (!e || e.sold) return { ok: false, msg: '' };
  if (G.materials < e.price) return { ok: false, msg: '素材不足' };
  const p = G.player;
  if (e.kind === 'tech') {
    G.materials -= e.price;
    p.knownMoves.push(e.id);
    e.sold = true;
    return { ok: true, msg: '習得 ' + e.name + '，在連段欄點擊換上' };
  }
  if (e.kind === 'fin') {
    G.materials -= e.price;
    p.ownedFinishers = p.ownedFinishers || [];
    if (p.ownedFinishers.indexOf(e.id) < 0) p.ownedFinishers.push(e.id);
    e.sold = true;
    // 買下不自動上盤：上哪一格是玩家的決策，那正是這套系統的重點
    return { ok: true, msg: '學會 ' + e.name + '，到連段盤點一格放上去' };
  }
  if (e.kind === 'weapon') {
    const same = p.weapons.find(w => w.id === e.id && w.tier === e.tier && e.tier < 4);
    if (!same && p.weapons.length >= p.slots) return { ok: false, msg: '武器欄已滿' };
    G.materials -= e.price;
    if (same) {
      const upgraded = makeWeapon(e.id, Math.min(4, e.tier + 1));
      p.weapons[p.weapons.indexOf(same)] = upgraded;
      recalcStats(p);
      e.sold = true;
      return { ok: true, msg: '合成 → ' + TIER_NAME[upgraded.tier] + ' ' + upgraded.name, merged: true };
    }
    p.weapons.push(makeWeapon(e.id, e.tier));
    recalcStats(p);
    e.sold = true;
    return { ok: true, msg: '購入 ' + e.name };
  } else {
    G.materials -= e.price;
    grantItem(e.id);
    e.sold = true;
    return { ok: true, msg: '購入 ' + e.name };
  }
}

function shopSellWeapon(uid) {
  const p = G.player;
  const i = p.weapons.findIndex(w => w.uid === uid);
  if (i < 0) return false;
  if (p.weapons.length <= 1) return false;
  const w = p.weapons[i];
  const back = Math.max(1, Math.round(weaponPrice(w.id, w.tier) * shopInflation(G.wave) * 0.5));
  G.materials += back;
  p.weapons.splice(i, 1);
  recalcStats(p);
  return back;
}

function shopNextWave() {
  G.shop = null;
  startWave(G.wave + 1);
  if (typeof onModeChange === 'function') onModeChange();
}

/* ---------- 特效 ---------- */
function spawnFx(type, x, y, color, size, extra) {
  const f = { type, x, y, color, size: size || 20, t: 0, life: 0.4 };
  if (extra) Object.assign(f, extra);
  if (type === 'swing') f.life = 0.22;
  if (type === 'mangaline') f.life = 0.26;   // 手邊的速度線：要留得住一眼，不能跟 60ms 接觸窗同生共死
  if (type === 'spark') f.life = 0.2;
  if (type === 'slide') f.life = 0.5;
  if (type === 'iailine') f.life = 0.6;
  if (type === 'explode') f.life = 0.5;
  if (type === 'shock') f.life = 0.45;
  if (type === 'burst_start') f.life = 0.6;
  if (type === 'heal_link') f.life = 0.3;
  if (type === 'summon') f.life = 0.5;
  G.fx.push(f);
  if (G.fx.length > 160) G.fx.shift();
}

function updateFx(dt) {
  for (const f of G.fx) { f.t += dt; if (f.t >= f.life) f.dead = true; }
  G.fx = G.fx.filter(f => !f.dead);
  for (const d of G.damageNums) {
    d.t += dt; d.y += d.vy * dt; d.x += d.vx * dt; d.vy += 90 * dt;
    if (d.t > 0.75) d.dead = true;
  }
  G.damageNums = G.damageNums.filter(d => !d.dead);
  if (G.screenShake > 0) G.screenShake = Math.max(0, G.screenShake - dt * 40);
  if (G.ougiBanner) { G.ougiBanner.t -= dt; if (G.ougiBanner.t <= 0) G.ougiBanner = null; }
  if (G.comboT > 0) { G.comboT -= dt; if (G.comboT <= 0) G.comboHits = 0; }
  if (G.comboPop > 0) G.comboPop -= dt;
}

/* ---------- 主更新 ---------- */
function updateGame(dt) {
  if (G.mode !== 'playing') return;
  if (G.hitstopCd > 0) G.hitstopCd -= dt;
  // 頓幀：世界凍住一瞬，只有特效以慢速繼續——這一下就是「打中了」
  if (G.hitstop > 0) {
    G.hitstop -= dt;
    updateFx(dt * 0.3);
    return;
  }
  if (G.hitstopEcho) {
    G.hitstopEcho.delay -= dt;
    if (G.hitstopEcho.delay <= 0) { G.hitstop = Math.max(G.hitstop, G.hitstopEcho.dur); G.hitstopEcho = null; }
  }
  G.time += dt;
  updateWave(dt);
  updateSpawning(dt);
  updatePlayer(dt);
  updateWeapons(dt);
  updateStrikes(dt);
  updateHazards(dt);
  updateEnemies(dt);
  updateProjectiles(dt);
  updatePickups(dt);
  updateFx(dt);
  // 鏡頭
  const targetX = G.player.x - VIEW.ww / 2;
  const targetY = G.player.y - VIEW.wh / 2;
  G.cam.x += (targetX - G.cam.x) * Math.min(1, dt * 8);
  G.cam.y += (targetY - G.cam.y) * Math.min(1, dt * 8);
  G.cam.x = Math.max(0, Math.min(ARENA.w - VIEW.ww, G.cam.x));
  G.cam.y = Math.max(0, Math.min(ARENA.h - VIEW.wh, G.cam.y));
}

/* ---------- 存檔 ---------- */
const SAVE_KEY = 'roubochang_save_v1';
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return { best: s.best || {}, unlocked: s.unlocked || {}, runs: s.runs || 0, wins: s.wins || 0, totalWaves: s.totalWaves || 0 };
  } catch (e) { return { best: {}, unlocked: {}, runs: 0, wins: 0, totalWaves: 0 }; }
}
let SAVE = null;
function saveGame() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) {} }

function onRunEnd(won) {
  if (!SAVE) SAVE = loadSave();
  SAVE.totalWaves = (SAVE.totalWaves || 0) + G.wave;
  SAVE.runs++;
  if (won) SAVE.wins++;
  const key = G.char.id;
  const rec = SAVE.best[key] || { wave: 0, danger: -1 };
  if (G.wave > rec.wave || (G.wave === rec.wave && G.danger > rec.danger)) {
    SAVE.best[key] = { wave: G.wave, danger: G.danger };
  }
  if (won) {
    const nd = Math.min(5, G.danger + 1);
    SAVE.unlocked['danger' + nd] = true;
  }
  saveGame();
  if (typeof onModeChange === 'function') onModeChange();
}

function charUnlocked(id) {
  if (START_CHARS.includes(id)) return true;
  if (!SAVE) SAVE = loadSave();
  const idx = UNLOCK_ORDER.indexOf(id);
  if (idx < 0) return true;
  return (SAVE.totalWaves || 0) >= unlockNeed(idx);
}

function maxDangerUnlocked() {
  if (!SAVE) SAVE = loadSave();
  let m = 0;
  for (let i = 1; i <= 5; i++) if (SAVE.unlocked['danger' + i]) m = i;
  return m;
}

/* ---------- 連段盤操作（UI 用） ---------- */
/* 把某招放進某格。同一招只能上一格——放進去之前先把它從別格拔掉。
   回傳被換下來的招（給 UI 講「換下來的招不會消失」）。 */
function setBoardSlot(row, col, fid) {
  const p = G.player;
  if (!p || !p.comboBoard) return null;
  if ((p.boardRows || []).indexOf(row) < 0) return null;
  const key = row + '_' + col;
  const old = p.comboBoard[key] || null;
  if (!fid) { delete p.comboBoard[key]; return old; }
  if (!FINISHER_MAP[fid]) return null;
  if ((p.ownedFinishers || []).indexOf(fid) < 0) return null;
  for (const k in p.comboBoard) if (p.comboBoard[k] === fid) delete p.comboBoard[k];
  p.comboBoard[key] = fid;
  return old;
}
/* 這一招現在在盤上的哪一格（沒有就回 null） */
function boardSlotOf(fid) {
  const p = G.player;
  if (!p || !p.comboBoard) return null;
  for (const k in p.comboBoard) if (p.comboBoard[k] === fid) return k;
  return null;
}
/* 還沒買的招（商店抽用）：這個職業的池扣掉已擁有的 */
function unownedFinishers() {
  const p = G.player;
  const cls = G.char && G.char.id;
  if (!cls || !FINISHER_POOL[cls]) return [];
  const own = p.ownedFinishers || [];
  return FINISHER_POOL[cls].filter(f => own.indexOf(f.id) < 0);
}

/* ---------- 特性的引擎鉤子（總監 2026-08-04） ----------
   資料在 data.js 的 TRAITS。數值面（長臂/快手/巨軀/血契）走 recalcStats，
   這裡處理「會在畫面上發生事情」的那些——那才是選了要有感覺的部分。 */
function updateTraits(dt) {
  const p = G.player;
  if (!p || !p.traits || !p.traits.length || p.dead) return;
  p.traitT = p.traitT || {};

  // 疾走：受傷後失效 6 秒（傷害入口設 p.sprintLock）
  if (p.sprintLock > 0) p.sprintLock -= dt;

  // 結界：每 30 秒一道護盾，擋下一次傷害
  const ward = traitOf('ward');
  if (ward) {
    p.traitT.ward = (p.traitT.ward || 0) + dt;
    if (p.traitT.ward >= ward.ward.every && !p.wardUp) {
      p.traitT.ward = 0; p.wardUp = true;
      spawnFx('shock', p.x, p.y, '#8fd4e0', 54);
      addDmgNum(p.x, p.y - 42, '結界', '#8fd4e0');
    }
  }

  // 腳程：移動累積到一定距離就回血
  const pace = traitOf('pace');
  if (pace) {
    const mv = Math.hypot(p.vx || 0, p.vy || 0) * dt;
    p.traitT.pace = (p.traitT.pace || 0) + mv;
    if (p.traitT.pace >= pace.paceHeal.per) {
      p.traitT.pace -= pace.paceHeal.per;
      healPlayer(pace.paceHeal.hp);
    }
  }

  // 週期型：念動（周圍衝擊）／斬返（大範圍斬擊，命中回血）／雷紋（下一擊連鎖閃電）
  for (const id of p.traits) {
    const t = TRAIT_MAP[id];
    if (!t || !t.proc) continue;
    const k = 'proc_' + id;
    p.traitT[k] = (p.traitT[k] || 0) + dt;
    if (p.traitT[k] < t.proc.every) continue;
    p.traitT[k] = 0;
    if (t.proc.kind === 'chain') { p.chainReady = true; addDmgNum(p.x, p.y - 46, '雷紋就緒', '#ffd44a'); continue; }
    const r = t.proc.r;
    spawnFx(t.proc.kind === 'reap' ? 'swing' : 'shock', p.x, p.y,
      t.proc.kind === 'reap' ? '#e8f2ff' : '#a06fd0', r, { arc: 360 });
    sfx(t.proc.kind === 'reap' ? 'swing_blade' : 'wind');
    let hit = 0;
    for (const e of G.enemies) {
      if (e.dead || dist2(e.x, e.y, p.x, p.y) > r * r) continue;
      hurtEnemy(e, techDmg(t.proc.dmg), { trueDmg: false });
      hit++;
    }
    if (hit && t.proc.heal) healPlayer(t.proc.heal);
  }

  // 殘軌：衝刺路徑留下的點，時間到就爆
  if (p.trailPts && p.trailPts.length) {
    const tr = traitOf('dash_trail');
    for (const pt of p.trailPts) {
      pt.t -= dt;
      if (pt.t > 0 || pt.done) continue;
      pt.done = true;
      spawnFx('explode', pt.x, pt.y, '#e0913c', tr ? tr.dashTrail.r : 62);
      sfx('quake', { vol: 0.6 });
      for (const e of G.enemies) {
        if (e.dead) continue;
        const rr = tr ? tr.dashTrail.r : 62;
        if (dist2(e.x, e.y, pt.x, pt.y) < rr * rr) hurtEnemy(e, techDmg(tr ? tr.dashTrail.dmg : 34));
      }
    }
    p.trailPts = p.trailPts.filter(x => !x.done);
  }
}

/* 控場觸發（定身或擒抱成功時呼叫）：制勝＝護盾、流星＝彗星 */
function traitOnControl(e) {
  const p = G.player;
  if (!p || !p.traits) return;
  const sh = traitOf('stun_shield');
  if (sh) {
    p.traitShield = Math.min(sh.onControl.max, (p.traitShield || 0) + sh.onControl.shield);
    spawnFx('shock', p.x, p.y, '#8fb0d9', 40);
  }
  const cm = traitOf('comet');
  if (cm && e && !e.dead && (p.cometCd || 0) <= 0) {
    p.cometCd = 1.2;
    G.strikes.push({
      w: { klass: '氣', dmg: cm.onControl.comet.dmg, cd: 1 }, reach: cm.onControl.comet.r,
      kind: 'slam', t: 0, hit: [], delay: cm.onControl.comet.delay,
      cometAt: { x: e.x, y: e.y },
    });
    spawnFx('shock', e.x, e.y, '#a06fd0', 30);
  }
}

/* ---------- 元素狀態 ---------- */
/* 玩家目前帶的元素（道具給的，可以同時有多種） */
function playerElements() {
  const p = G.player;
  if (!p || !p.items) return [];
  const out = [];
  p.items.forEach(it => { if (it.element && out.indexOf(it.element) < 0) out.push(it.element); });
  return out;
}

/* 命中時附加元素狀態。雷與冰有各自的內部冷卻，不然硬控會變成永久鎖住。 */
function applyElements(e) {
  const p = G.player;
  if (!e || e.dead) return;
  for (const key of playerElements()) {
    const el = ELEMENT_MAP[key];
    if (!el) continue;
    const a = el.apply;
    if (a.paralyze) {
      if ((e.elemCd_thunder || 0) > 0) continue;
      e.elemCd_thunder = el.cd;
      e.paralyze = Math.max(e.paralyze || 0, a.paralyze);
      spawnFx('spark', e.x, e.y - e.r, el.color, 22);
    } else if (a.freeze) {
      if ((e.elemCd_ice || 0) > 0) continue;
      e.elemCd_ice = el.cd;
      e.freeze = Math.max(e.freeze || 0, a.freeze);
      spawnFx('shock', e.x, e.y, el.color, e.r * 1.8);
    } else if (a.burn) {
      e.burnStack = Math.min(a.burn.max, (e.burnStack || 0) + 1);
      e.dot = Math.max(e.dot || 0, e.burnStack * a.burn.per * liveDamageMult());
      e.dotTime = Math.max(e.dotTime || 0, a.burn.dur);
    } else if (a.poison) {
      e.poisonStack = Math.min(a.poison.max, (e.poisonStack || 0) + 1);
      e.poison = e.poisonStack * a.poison.per * liveDamageMult();
      e.poisonTime = a.poison.dur;
    } else if (a.heavy) {
      e.heavyStack = (e.heavyStack || 0) + 1;
      e.heavy = a.heavy.dur;
      if (e.heavyStack >= a.heavy.stunAt) {
        e.heavyStack = 0;
        e.stun = Math.max(e.stun || 0, 1.0);
        spawnFx('explode', e.x, e.y, el.color, e.r * 2.2);
        traitOnControl(e);
      }
    } else if (a.gust) {
      e.gust = a.gust.dur;
      spawnFx('slide', e.x, e.y, el.color, e.r * 1.6, { angle: Math.atan2(e.y - p.y, e.x - p.x) });
    }
  }
}

/* 每幀推進元素狀態。★放在 updateEnemies 的迴圈裡呼叫。 */
function updateElementStatus(e, dt) {
  if (e.elemCd_thunder > 0) e.elemCd_thunder -= dt;
  if (e.elemCd_ice > 0) e.elemCd_ice -= dt;
  if (e.paralyze > 0) e.paralyze -= dt;
  if (e.freeze > 0) e.freeze -= dt;
  if (e.heavy > 0) { e.heavy -= dt; if (e.heavy <= 0) e.heavyStack = 0; }
  if (e.gust > 0) e.gust -= dt;
  if (e.poisonTime > 0) {
    e.poisonTime -= dt;
    hurtEnemy(e, (e.poison || 0) * dt, { noLifesteal: true, trueDmg: true });
    if (e.poisonTime <= 0) { e.poison = 0; e.poisonStack = 0; }
  }
}

/* 毒的傳染：目標死亡時把層數分給附近的人。這是毒跟火的分野——
   火是「單體燒得快」，毒是「群體慢慢化開」。 */
function poisonSpreadOnDeath(e) {
  if (!e.poisonStack) return;
  const el = ELEMENT_MAP.poison;
  const r = el.apply.poison.spread;
  const give = Math.max(1, Math.floor(e.poisonStack / 2));
  for (const o of G.enemies) {
    if (o.dead || o === e) continue;
    if (dist2(o.x, o.y, e.x, e.y) > r * r) continue;
    o.poisonStack = Math.min(el.apply.poison.max, (o.poisonStack || 0) + give);
    o.poison = o.poisonStack * el.apply.poison.per * liveDamageMult();
    o.poisonTime = el.apply.poison.dur;
  }
  spawnFx('shock', e.x, e.y, el.color, r);
}
