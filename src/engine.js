/* ============================================================
   Penguin Can Fight — 遊戲引擎
   ============================================================ */

/* 音效空殼替身：瀏覽器端由 audio.js 覆寫成真實引擎；Node 模擬環境維持無聲 */
if (typeof window === 'undefined' || !window.AudioContext) {
  var sfx = function () {};
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
  G.materials = 0; G.totalMaterials = 0;
  G.xp = 0; G.level = 1; G.levelQueue = 0; G.levelChoices = null;
  G.enemies = []; G.projectiles = []; G.pickups = []; G.fx = []; G.damageNums = [];
  // 這些若不歸零會跨局殘留，讓同種子的兩局跑出不同結果，平衡量測就不可重現
  G.time = 0; G.screenShake = 0; G.paused = false; G.pendingShop = false;
  G.kills = 0; G.stats = { dmgDealt: 0, dmgTaken: 0, src: {} };
  G.player = createPlayer(c);
  G.shop = null;
  startWave(1);
}

function startWave(w) {
  G.wave = w;
  G.waveTime = 0;
  G.waveDur = waveDuration(w);
  G.waveEnding = 0;
  G.enemies = []; G.projectiles = []; G.fx = []; G.strikes = [];
  G.hitstop = 0; G.hitstopCd = 0;
  G.comboHits = 0; G.comboT = 0;
  G.player.x = ARENA.w / 2; G.player.y = ARENA.h / 2;
  G.player.iframe = 1.0;
  G.player.momentum = 0; G.player.burst = 0;
  // 招式與奧義狀態不跨波：波開始一律乾淨，冷卻歸零當開波紅利
  const P = G.player;
  P.grabState = null; P.dashState = null; P.flurry = null;
  P.burstMulti = null; P.rushMulti = null; P.kneeChain = null; P.ougiField = 0;
  P.beatLog = []; P.beatT = 0; P.beatState = null; P.beatCd = 0; P.triCd = 0; P.stillHold = 0;
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
    G.comboHits = (G.comboHits || 0) + 1;
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
    G.comboHits = 0; G.comboT = 0;   // 挨打斷連
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
function techDmg(base) { return base * liveDamageMult() * techWaveScale() * TUNE.techDmgMul; }
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
function stillActive() {
  const p = G.player;
  return p.stillT > 0.5 && !p.dashState && !p.grabState && !p.dead;
}
function movingActive() {
  const p = G.player;
  return p.moveTime > 0.15 && !p.dashState && !p.grabState && !p.dead;
}
/* 自動招式（移動技／站樁技）的傷害入口：鬼手甲加成收在這 */
function autoDmg(base) {
  return techDmg(base) * (hasItem('oni_gauntlet') ? 1.35 : 1);
}

function castDash() {
  const p = G.player;
  if (p.dead || p.dashCd > 0) return false;
  if (p.grabState || p.dashState || p.staggerT > 0 || p.burstMulti || p.rushMulti || p.kneeChain) return false;
  const id = p.moves.dash;
  const d = MOVE_MAP[id];

  // 奧義判定：節拍湊齊職業指令，這一下 Space 就不是普通衝刺
  const o = OUGI[G.char.id];
  if (o && beatsMatch(p.beatLog, o.seq)) {
    const okO = castOugi(o);
    if (okO) {
      p.beatLog = []; p.beatT = 0;
      p.dashCd = d.cd * 1.25 * TUNE.dashCdMul * (hasItem('master_obi') ? 0.8 : 1);
      G.ougiBanner = { name: o.name, t: 1.3 };
      G.screenShake = Math.max(G.screenShake, 10);
      addHitstop(0.12, true);
      sfx('ougi_cast');
      sfx('ougi_hit');
      if (hasItem('fist_wrap')) p.guaranteedCrit = true;
      return true;
    }
  }

  // 通用節拍加成：站拍＝這次衝刺傷害 +25%／拍，移拍＝冷卻 -15%／拍
  const stillBeats = p.beatLog.filter(b => b === 'S').length;
  const moveBeats = p.beatLog.filter(b => b === 'M').length;
  const boost = 1 + stillBeats * 0.25;
  const cdMul = 1 - Math.min(0.45, moveBeats * 0.15);

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
      p.iaiPhase = { phase: 'sheath', t: 0.3, boost: 0 };
      ok = true;
      break;
    }
    case 'shadow_dash': ok = dashGeneric(d, 'shadow'); break;   // 穿人但不無敵——這遊戲的衝刺沒有無敵
    case 'sumo_press': ok = techSumoPress(d); break;
  }
  if (ok) {
    sfx(id === 'flash_step' ? 'flash' : 'dash');
    p.dashCd = d.cd * cdMul * TUNE.dashCdMul * (hasItem('master_obi') ? 0.8 : 1);
    if (p.dashState) p.dashState.boost = boost;
    p.beatLog = []; p.beatT = 0;   // 每次衝刺後重新演奏
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
  return ok;
}

function dashDir() {
  const p = G.player;
  const tgt = nearestEnemy(p.x, p.y, 600);
  if (tgt) {
    const dd = Math.hypot(tgt.x - p.x, tgt.y - p.y) || 1;
    return { x: (tgt.x - p.x) / dd, y: (tgt.y - p.y) / dd };
  }
  const ml = Math.hypot(p.lastMoveX, p.lastMoveY) || 1;
  return { x: p.lastMoveX / ml, y: p.lastMoveY / ml };
}

function dashTackle(d) {
  const p = G.player;
  const dir = dashDir();
  p.dashState = { id: 'tackle', dx: dir.x, dy: dir.y, t: d.dashDur, spd: d.dashSpd,
    carried: null, hitAny: false, risk: true };
  return true;
}

function dashGrabSpin(d) {
  const p = G.player;
  const dir = dashDir();
  p.dashState = { id: 'grab_spin', dx: dir.x, dy: dir.y, t: d.dashDur, spd: d.dashSpd, grabDef: d };
  return true;
}

function dashGeneric(d, kind) {
  const p = G.player;
  const dir = dashDir();
  p.dashState = { id: kind, dx: dir.x, dy: dir.y, t: d.dashDur, spd: d.dashSpd };
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
  e.grabbed = true;
  e.stun = 99;
  p.grabState = {
    e, t: 0, dur: d.dur * (grabMaster() ? 1.25 : 1),
    ang: Math.atan2(e.y - p.y, e.x - p.x),
    orbitR: d.orbitR, spinSpd: d.spinSpd, tick: 0,
  };
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
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.knockX += Math.cos(a) * 60; e.knockY += Math.sin(a) * 60;
      }
    }
  }
  if (hitAny) addBeat('S');
}

/* 移動技：旋風掃腿 */
function cycloneSweep(d) {
  const p = G.player;
  let hitAny = false;
  spawnFx('swing', p.x, p.y, '#c9d96a', d.radius, { angle: 0, arc: 360, type: 'spin' });
  p.pose = { type: 'kick', ang: 0, t: 0, dur: 0.3, prio: 1 };
  for (const e of G.enemies) {
    if (e.dead) continue;
    if (dist2(e.x, e.y, p.x, p.y) < (d.radius + e.r) * (d.radius + e.r)) {
      hitAny = true;
      hurtEnemy(e, autoDmg(9), { trueDmg: true });
      if (!e.dead) {
        const a = Math.atan2(e.y - p.y, e.x - p.x);
        e.knockX += Math.cos(a) * 50; e.knockY += Math.sin(a) * 50;
      }
    }
  }
  if (hitAny) addBeat('M');
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
  if (p.pose) { p.pose.t += dt; if (p.pose.t >= p.pose.dur) p.pose = null; }
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
  if (p.flowT > 0) p.flowT -= dt;

  // ---- 站樁技 ----
  const stillId = p.moves.still;
  if (stillActive()) {
    p.stillTechTimer += dt;
    if (stillId === 'quake_pulse' && p.stillTechTimer >= MOVE_MAP.quake_pulse.interval) {
      p.stillTechTimer = 0;
      quakePulse(MOVE_MAP.quake_pulse);
    } else if (stillId === 'palm_flurry' && p.stillTechTimer >= MOVE_MAP.palm_flurry.interval && !p.flurry) {
      p.stillTechTimer = 0;
      p.flurry = { t: 0.4, tick: 0, n: 0, max: 3 };
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
      p.moveTechTimer = 0;
      cycloneSweep(MOVE_MAP.cyclone_kick);
    } else if (moveId === 'tail_wake' && p.moveTechTimer >= MOVE_MAP.tail_wake.interval) {
      p.moveTechTimer = 0;
      tailWake();
    } else if (moveId === 'phantom_press') {
      phantomPress(dt);
    }
  } else {
    p.moveTechTimer = 0;
  }

  // ---- 千手張打脈衝（站樁觸發） ----
  if (p.flurry) {
    const f = p.flurry;
    f.t -= dt; f.tick -= dt;
    if (f.tick <= 0 && f.n < (f.max || 3)) {
      f.tick = 0.115; f.n++;
      const tgt = nearestEnemy(p.x, p.y, 200);
      const ang = tgt ? Math.atan2(tgt.y - p.y, tgt.x - p.x) : (p.face > 0 ? 0 : Math.PI);
      spawnFx('swing', p.x, p.y, '#c9576b', 110, { angle: ang, arc: 120, type: 'arc' });
      p.pose = { type: 'palm', ang, t: 0, dur: 0.2, prio: 1 };
      for (const e of G.enemies) {
        if (e.dead) continue;
        const dd = Math.hypot(e.x - p.x, e.y - p.y);
        if (dd > 110 + e.r) continue;
        const ea = Math.atan2(e.y - p.y, e.x - p.x);
        if (Math.abs(angDiff(ea, ang)) > 1.05) continue;
        hurtEnemy(e, autoDmg(9), { fromAngle: ang });
        addBeat('S');
        if (!e.dead) {
          const kb = e.boss ? 25 : 140;
          e.knockX += Math.cos(ea) * kb; e.knockY += Math.sin(ea) * kb;
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
    if (e.dead) { p.grabState = null; }
    else {
      g.t += dt;
      const moving = p.moveTime > 0.1;
      if (moving) {
        // 掄著他甩打周遭（移動拍）
        p.stillHold = 0;
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
          if (hitAny) addBeat('M');
          hurtEnemy(e, throwDmg(2), { trueDmg: true, noLifesteal: true });
        }
      } else {
        // 站定醞釀炸彈摔（站樁拍）
        e.x = p.x + p.face * (p.r + e.r - 2);
        e.y = p.y - 6;
        p.stillHold += dt;
        if (p.stillHold >= 0.5) {
          sfx('throw_hit');
          addHitstop(0.1, true);
          addBeat('S');
          spawnFx('explode', p.x, p.y, '#b07a4a', 120);
          G.screenShake = Math.max(G.screenShake, 13);
          hurtEnemy(e, throwDmg(20 + e.maxHp * 0.30), { trueDmg: true });
          if (!e.dead) { e.grabbed = false; e.stun = 1.2; }
          for (const o of G.enemies) {
            if (o.dead || o === e) continue;
            if (dist2(o.x, o.y, p.x, p.y) < 120 * 120) {
              hurtEnemy(o, throwDmg(18), { trueDmg: true });
              if (!o.dead) o.stun = Math.max(o.stun, 0.8);
            }
          }
          p.grabState = null; p.stillHold = 0;
        }
      }
      // 持有超時：自動炸彈摔（避免無限扣人質）
      if (p.grabState && g.t >= g.dur) {
        p.stillHold = 0;
        e.grabbed = false;
        e.thrown = { vx: Math.cos(g.ang) * 700, vy: Math.sin(g.ang) * 700, t: 0.5 };
        hurtEnemy(e, throwDmg(12 + e.maxHp * 0.15), { trueDmg: true });
        p.grabState = null;
      }
      e.x = Math.max(e.r, Math.min(ARENA.w - e.r, e.x));
      e.y = Math.max(e.r, Math.min(ARENA.h - e.r, e.y));
    }
  }
  // ---- 迴旋抓摔：掄人 ----
  else if (p.grabState) {
    const g = p.grabState;
    const e = g.e;
    if (e.dead) { p.grabState = null; }
    else {
      g.t += dt;
      g.ang += g.spinSpd * dt;
      e.x = p.x + Math.cos(g.ang) * g.orbitR;
      e.y = p.y + Math.sin(g.ang) * g.orbitR;
      e.x = Math.max(e.r, Math.min(ARENA.w - e.r, e.x));
      e.y = Math.max(e.r, Math.min(ARENA.h - e.r, e.y));
      g.tick -= dt;
      if (g.tick <= 0) {
        g.tick = 0.12;
        // 被掄的人是武器：傷害看他的體重（最大生命）
        for (const o of G.enemies) {
          if (o.dead || o === e) continue;
          const rr = o.r + e.r + 4;
          if (dist2(o.x, o.y, e.x, e.y) < rr * rr) {
            hurtEnemy(o, throwDmg(4 + e.maxHp * 0.04) * (g.super ? 1.5 : 1), { trueDmg: true });
            if (!o.dead) {
              const a = Math.atan2(o.y - e.y, o.x - e.x);
              o.knockX += Math.cos(a) * 150; o.knockY += Math.sin(a) * 150;
            }
          }
        }
        hurtEnemy(e, throwDmg(3), { trueDmg: true, noLifesteal: true });
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
        e.thrown = { vx: tx * (g.super ? 900 : 720), vy: ty * (g.super ? 900 : 720), t: 0.55 };
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
    s.t -= dt;
    if (s.dur0 === undefined) s.dur0 = s.t + dt;
    // 企鵝滑行曲線：起步爆發、後段滑行減速——是「滑」出去不是「閃」過去
    const slideK = Math.max(0, s.t / s.dur0);
    const spdNow = s.spd * (0.55 + 0.75 * slideK);
    p.x += s.dx * spdNow * dt;
    p.y += s.dy * spdNow * dt;
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
function addBeat(type) {
  const p = G.player;
  if (p.dead || p.beatCd > 0) return;
  p.beatCd = 0.4;   // 同一瞬間的多段命中只記一拍
  p.beatLog.push(type);
  if (p.beatLog.length > 3) p.beatLog.shift();
  // 同拍共鳴：三拍同型自動觸發輕增益——喜歡「一直移動一直打」的玩家不用搓招也有獎勵
  if ((p.resonCd || 0) <= 0 && p.beatLog.length === 3) {
    const rs = p.beatLog.join('');
    if (rs === 'MMM') {
      p.resonCd = 5; p.flowT = 4;
      addDmgNum(p.x, p.y - 40, '行雲', '#8fd4e0', true);
    } else if (rs === 'SSS') {
      p.resonCd = 5; p.chargeHits = 3;
      addDmgNum(p.x, p.y - 40, '蓄勢', '#e8964a', true);
    } else if (rs === 'DDD') {
      p.resonCd = 5;
      p.dashCd = Math.max(0, p.dashCd - 2.5);
      addDmgNum(p.x, p.y - 40, '連衝', '#ffd44a', true);
    }
  }
  // 三段勁：最近三拍湊齊 站、移、衝 各一（順序不拘）→ 自動爆出一圈氣勁小招
  if (p.triCd <= 0 && p.beatLog.length === 3) {
    const s = [...p.beatLog].sort().join('');
    if (s === 'DMS') {
      p.triCd = 6;
      spawnFx('shock', p.x, p.y, '#ffd44a', 115);
      addDmgNum(p.x, p.y - 40, '三段勁', '#ffd44a', true);
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

/* 依玩家當下的行動狀態決定這次武器命中算哪一拍 */
function beatFromState() {
  const p = G.player;
  if (p.dashState) return 'D';
  if (stillActive()) return 'S';
  if (movingActive()) return 'M';
  return null;
}

/* ---------- 奧義 ----------
   節拍序列湊齊職業指令時，Space 打出的不是衝刺技而是奧義。
*/
function beatsMatch(log, seq) {
  if (log.length < seq.length) return false;
  const tail = log.slice(-seq.length);
  return seq.every((b, i) => tail[i] === b);
}
function ougiReady() {
  const o = OUGI[G.char.id];
  return !!(o && beatsMatch(G.player.beatLog, o.seq));
}

function castOugi(o) {
  const p = G.player;
  const pr = o.params;
  let ok = false;
  switch (o.kind) {
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
          if (!e.dead) e.stun = Math.max(e.stun, 0.5);
        }
      }
      spawnFx('heal_link', p.x, p.y, '#e8e4dc', 0, { tx: ex, ty: ey });
      p.x = ex; p.y = ey;
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
        hurtEnemy(best, throwDmg(80), { trueDmg: true });
        best.stun = Math.max(best.stun, 1.5);
        spawnFx('explode', best.x, best.y, '#c2703c', 120);
        ok = true; break;
      }
      startGrab(best, { dur: 2.1, orbitR: 76, spinSpd: 9 });
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
    w.cdLeft -= dt * spdMul * wMul;
    if (w.swing > 0) w.swing -= dt * 6;
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
    if (w.cdLeft <= 0 && target) {
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
  w.swingDir *= -1;
  // 揮武器時手臂跟著出去（起手式姿勢優先，不覆蓋）
  if (!p.pose || p.pose.prio !== 1) {
    p.pose = { type: 'swing', ang: w.angle, t: 0, dur: 0.2, prio: 0 };
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
    if (best) {
      spawnFx('swing', p.x, p.y, w.color, reach, { angle: w.angle, arc: w.arc, type: w.type });
      applyWeaponHit(w, best, reach);
      if (G.char.special === 'flurry' && !best.dead) applyWeaponHit(w, best, reach, 0.4, true);
    }
    return;
  }
  spawnStrike(w, reach);
}

function spawnStrike(w, reach) {
  const p = G.player;
  const s = { w, reach, t: 0, hit: [] };
  if (w.type === 'thrust') {
    s.kind = 'thrust';
    s.x = p.x + Math.cos(w.angle) * 14;
    s.y = p.y + Math.sin(w.angle) * 14;
    s.ang = w.angle;
    s.speed = w.strikeSpd || 820;
    s.maxDist = reach + 14;
    s.traveled = 0;
  } else if (w.type === 'arc') {
    s.kind = 'sweep';
    const half = (w.arc * Math.PI / 180) / 2;
    s.ang0 = w.angle - half * w.swingDir;
    s.ang1 = w.angle + half * w.swingDir;
    s.cur = s.ang0;
    s.dur = 0.13;
  } else if (w.type === 'spin') {
    s.kind = 'orbit';
    s.cur = w.angle;
    s.dur = 0.42;
    s.spd = (Math.PI * 2 / 0.42) * (w.swingDir > 0 ? 1 : -1);
  } else {   // slam：延遲爆發，先給預兆
    s.kind = 'slam';
    s.delay = 0.12;
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
  applyWeaponHit(s.w, e, s.reach);
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
      const k = Math.min(1, s.t / s.dur);
      const prev = s.cur;
      s.cur = s.kind === 'sweep'
        ? s.ang0 + (s.ang1 - s.ang0) * k
        : s.cur + s.spd * dt;
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
        G.screenShake = Math.max(G.screenShake, 5);
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
    G.hitstopCd = 0.12;
  }
  G.hitstop = Math.max(G.hitstop, sec);
}

function applyWeaponHit(w, e, reach, mulOverride, isEcho) {
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

  // 記拍：這一下是在什麼狀態打中的
  if (!isEcho) {
    const b = beatFromState();
    if (b) addBeat(b);
  }

  // 命中音：依武器類與力度分層
  if (!isEcho) {
    if (w.klass === '刃') sfx('hit_blade');
    else if (w.klass === '腿') sfx('hit_kick');
    else if (w.klass === '棍' || w.klass === '重械' || w.klass === '軟兵') sfx('hit_blunt');
    else if (crit || base >= e.maxHp * 0.3) sfx('hit_heavy');
    else if (base >= 20) sfx('hit_mid');
    else sfx('hit_light');
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
      spawnFx('shock', p.x, p.y, '#ffffff', 90);
      G.enemies.forEach(o => {
        if (!o.dead && o !== e && dist2(o.x, o.y, p.x, p.y) < 90 * 90) {
          hurtEnemy(o, base * 0.5, { trueDmg: true });
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
  if (p.dead) return;   // 解縛反噬等絕技效果可能剛好歸零生命
  const k = G.keys;
  let mx = 0, my = 0;
  if (k['a'] || k['arrowleft']) mx -= 1;
  if (k['d'] || k['arrowright']) mx += 1;
  if (k['w'] || k['arrowup']) my -= 1;
  if (k['s'] || k['arrowdown']) my += 1;
  // 衝刺中身體不歸自己管；踉蹌時腿軟
  if (p.dashState || p.staggerT > 0 || (p.iaiPhase && p.iaiPhase.phase === 'sheath')) { mx = 0; my = 0; }
  const len = Math.hypot(mx, my);
  const moving = len > 0;
  if (moving) { mx /= len; my /= len; if (mx !== 0) p.face = mx > 0 ? 1 : -1; }

  let spd = BASE_SPEED_F() * liveSpeedMult();
  if (p.grabState) spd *= 0.7;          // 掄著人跑比較慢
  if (moving) { p.lastMoveX = mx; p.lastMoveY = my; }
  p.vx = mx * spd; p.vy = my * spd;
  p.x += p.vx * dt; p.y += p.vy * dt;
  p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x));
  p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y));
  pushOutOfWalls(p);
  p.walkAnim += moving ? dt * 10 : -p.walkAnim * dt * 8;

  if (moving) { p.moveTime = Math.min(1, p.moveTime + dt); p.stillT = 0; }
  else { p.moveTime = 0; p.stillT += dt; }

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
    // 居合的延遲連斬：0.3 秒後才裂開，之後連續三段
    if (e.iaiCut) {
      const ic = e.iaiCut;
      ic.t -= dt;
      if (ic.t <= 0) {
        ic.n--;
        ic.t = 0.12;
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

    // 被抓住＝身體歸玩家管，AI 完全停擺
    if (e.grabbed) continue;

    // 被扔出去：飛行中撞傷沿路的敵人，撞牆自己再吃一次
    if (e.thrown) {
      const th = e.thrown;
      th.t -= dt;
      e.x += th.vx * dt; e.y += th.vy * dt;
      th.vx *= Math.pow(0.05, dt); th.vy *= Math.pow(0.05, dt);
      for (const o of G.enemies) {
        if (o.dead || o === e || o.thrown || o.grabbed || o.hitByThrow) continue;
        const rr = o.r + e.r + 2;
        if (dist2(o.x, o.y, e.x, e.y) < rr * rr) {
          o.hitByThrow = true;
          hurtEnemy(o, throwDmg(12), { trueDmg: true });
          if (!o.dead) {
            const a = Math.atan2(o.y - e.y, o.x - e.x);
            o.knockX += Math.cos(a) * 180; o.knockY += Math.sin(a) * 180;
          }
        }
      }
      const hitWall = e.x <= e.r + 2 || e.x >= ARENA.w - e.r - 2 || e.y <= e.r + 2 || e.y >= ARENA.h - e.r - 2;
      clampEnemy(e);
      if (hitWall) {
        hurtEnemy(e, throwDmg(8 + e.maxHp * 0.12), { trueDmg: true });
        if (!e.dead) e.stun = Math.max(e.stun, 0.8);
        spawnFx('explode', e.x, e.y, '#c2703c', 70);
        e.thrown = null;
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
    e.knockX *= Math.pow(0.0016, dt); e.knockY *= Math.pow(0.0016, dt);

    if (e.stun > 0) { e.stun -= dt; clampEnemy(e); continue; }

    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    e.face = ux > 0 ? 1 : -1;
    let spd = e.speed * (e.slow > 0 ? 0.6 : 1);
    if (G.waveEnding > 0) spd *= 0.3;

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
  if (G.waveEnding > 0) {
    G.waveEnding -= dt;
    if (G.waveEnding <= 0) finishWave();
    return;
  }
  G.waveTime += dt;
  if (G.waveTime >= G.waveDur) {
    // 頭目波不看碼表：頭目沒倒就一直打，只是不再補一般敵人
    if (isBossWave(G.wave) && G.enemies.some(e => e.boss)) {
      G.spawnBudget = 0;
      return;
    }
    G.waveEnding = 1.4;
  }
}

function finishWave() {
  G.pickups.forEach(it => { if (!it.dead) collectPickup(it); });
  G.pickups = [];
  G.player.hp = G.player.maxHp;   // 波間回滿：每一波都是新的擂台
  G.enemies = [];
  G.projectiles = [];
  const harvest = Math.round(G.player.stats.harvest * (1 + G.wave * 0.15));
  if (harvest > 0) { G.materials += harvest; G.totalMaterials += harvest; }
  if (G.wave >= MAX_WAVE) { G.mode = 'victory'; onRunEnd(true); if (typeof onModeChange === 'function') onModeChange(); return; }
  if (G.levelQueue > 0) { G.pendingShop = true; openLevelUp(); }
  else { openShop(); }
}

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
