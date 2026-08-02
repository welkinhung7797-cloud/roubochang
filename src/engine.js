/* ============================================================
   肉搏場 — 遊戲引擎
   ============================================================ */

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
    // 絕技狀態
    techs: [makeTech(charDef.startTech || null), null],
    grabState: null, dashState: null, flurry: null,
    counterT: 0, swayT: 0, cycloneT: 0, cycloneTick: 0,
    limitT: 0, limitSlowT: 0, bellT: 0, flashHasteT: 0, staggerT: 0,
  };
  p.perm.maxHp = 30;   // 全職業共同基礎值之外的起始生命由此決定
  for (const k in charDef.stats) p.perm[k] += charDef.stats[k];
  p.weapons.push(makeWeapon(charDef.weapon, 1));
  recalcStats(p);
  p.hp = p.maxHp;
  return p;
}

const BASE_HP = 60;
const BASE_SPEED = 190;

function recalcStats(p) {
  const s = blankStats();
  for (const k in p.perm) s[k] += p.perm[k];
  p.items.forEach(it => {
    if (!it.stats) return;
    for (const k in it.stats) s[k] += it.stats[k];
  });
  // 職業硬性覆寫
  const sp = G.char ? G.char.special : null;
  if (sp === 'no_regen' || sp === 'rage') s.regen = 0;   // 買再多回復道具也沒用，這是他們的代價
  s.dodge = Math.min(s.dodge, 60);
  s.block = Math.min(s.block, 75);
  s.crit = Math.min(s.crit, 100);
  p.stats = s;
  const newMax = Math.max(1, BASE_HP + s.maxHp);
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
  if (p.limitT > 0) m += 0.40;
  return Math.max(0.1, m);
}
function liveAtkSpdMult() {
  const p = G.player, sp = G.char.special;
  let m = 1 + p.stats.atkSpd / 100;
  m += p.momentum / 100 * 0.20;
  if (sp === 'move_haste') m += Math.min(0.40, p.moveTime * 0.20);
  if (sp === 'rage') m += Math.floor((1 - p.hp / p.maxHp) * 10) * 0.05;
  if (sp === 'scrap_rush') m += Math.min(0.60, p.scrapStacks * 0.06);
  if (p.limitT > 0) m += 0.25;
  if (p.flashHasteT > 0) m += 0.30;
  return Math.max(0.2, m);
}
function liveSpeedMult() {
  const p = G.player;
  let m = 1 + p.stats.speed / 100;
  m += p.momentum / 100 * 0.10;
  if (p.limitT > 0) m += 0.15;
  if (p.limitSlowT > 0) m -= 0.20;
  if (p.bellT > 0) m -= 0.10;
  return Math.max(0.25, m);
}
function liveRangeMult() { return Math.max(0.4, 1 + G.player.stats.range / 100); }

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
  G.enemies = []; G.projectiles = []; G.fx = [];
  G.player.x = ARENA.w / 2; G.player.y = ARENA.h / 2;
  G.player.iframe = 1.0;
  G.player.momentum = 0; G.player.burst = 0;
  // 絕技狀態不跨波：波開始一律乾淨，冷卻歸零當開波紅利
  const P = G.player;
  P.grabState = null; P.dashState = null; P.flurry = null;
  P.counterT = 0; P.swayT = 0; P.cycloneT = 0;
  P.limitT = 0; P.limitSlowT = 0; P.bellT = 0; P.flashHasteT = 0; P.staggerT = 0;
  P.techs.forEach(t => { if (t) t.cdLeft = 0; });
  G.spawnBudget = waveBudget(w, G.danger);
  G.spawnBudgetTotal = G.spawnBudget;
  G.spawnTimer = 0;
  G.spawnPool = ENEMIES.filter(e => e.wave <= w && e.id !== 'splitling');
  G.mode = 'playing';
  if (isBossWave(w)) spawnBoss(bossOfWave(w));
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
    const elite = G.wave >= 6 && chance(0.035 + G.wave * 0.004);
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
  G.screenShake = Math.max(G.screenShake, e.boss ? 20 : (e.elite ? 6 : 2));
  spawnFx('burst', e.x, e.y, e.color, e.r);
  // 掉素材
  const luck = 1 + G.player.stats.luck / 200;
  let n = e.mat;
  if (n > 0) {
    // 素材收入要跟得上商店通膨（每波 +11%），否則後期買不起東西
    n = Math.max(1, Math.round(n * DANGER_LEVELS[G.danger].mat * (1 + G.wave * 0.05)));
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

  // 借力化勁：架式中挨的每一下都化為零，攻擊者被過肩摔到身後
  if (p.counterT > 0) {
    addDmgNum(p.x, p.y - 30, '化勁', '#5a8ac9');
    const tech = p.techs.find(t => t && t.id === 'counter_throw');
    if (tech) tech.cdLeft = Math.max(0, tech.cdLeft - 4);
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

  // 閃避（搖擺身法期間 +35%，閃掉就回敬刺拳）
  const dodgeBonus = p.swayT > 0 ? 35 : 0;
  if (rng() * 100 < Math.min(75, p.stats.dodge + dodgeBonus)) {
    addDmgNum(p.x, p.y - 30, '閃避', '#79d9c0');
    if (sp === 'dodge_momentum') { addMomentum(15); p.guaranteedCrit = true; }
    if (p.swayT > 0 && source && !source.dead && source.name) {
      hurtEnemy(source, techDmg(12), { crit: chance(0.3) });
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

  if (G.player.dashState) dmg *= 1.6;   // 長矛衝撞的風險
  dmg *= (1 - armorCut(p.stats.armor + p.armorBuff + (p.bellT > 0 ? 25 : 0)));
  dmg = Math.max(0, dmg);

  // 反傷
  let thornMul = 0;
  if (sp === 'thorns' && !blocked) thornMul += 1.5;
  if (hasItem('spike_armor')) thornMul += 0.8 * itemCount('spike_armor');
  if (p.bellT > 0) thornMul += 1.0;   // 金鐘罩氣勁反震
  if (thornMul > 0 && source && !source.dead) {
    hurtEnemy(source, amount * thornMul, { trueDmg: true, noLifesteal: true });
  }

  if (dmg > 0) {
    p.hp -= dmg;
    G.stats.dmgTaken += dmg;
    noteDmg(source && source.name ? source.name : '其他', dmg);
    addDmgNum(p.x, p.y - 18, '-' + Math.round(dmg), '#ff6b6b', true);
    G.screenShake = Math.max(G.screenShake, 5 + dmg * 0.25);
    spawnFx('hurt', p.x, p.y, '#ff6b6b', 20);
  }
  p.iframe = 0.5;
  if (p.hp <= 0) {
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
    p.burst = G.char.special === 'fast_momentum' ? 8 : 5;
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
function makeTech(id) {
  return id ? { id, def: TECH_MAP[id], cdLeft: 0 } : null;
}
function techWaveScale() { return 1 + (G.wave - 1) * 0.08; }
function techDmg(base) { return base * liveDamageMult() * techWaveScale(); }
function grabMaster() { return G.char.special === 'grab_master'; }

/* 統一的「摔投傷害」入口：摔角手與合氣道師範的加成都收在這 */
function throwDmg(base) {
  let m = 1;
  if (grabMaster()) m *= 1.25;
  if (G.char.special === 'counter_master') m *= 1.5;
  return techDmg(base) * m;
}

function castTech(slot) {
  const p = G.player;
  const t = p.techs[slot];
  if (!t || t.cdLeft > 0 || p.dead) return false;
  if (p.grabState || p.dashState || p.staggerT > 0) return false;
  const d = t.def;
  let ok = false;
  switch (t.id) {
    case 'grab_spin': ok = techGrabSpin(d); break;
    case 'spear_rush': ok = techSpearRush(d); break;
    case 'palm_flurry': ok = techPalmFlurry(d); break;
    case 'counter_throw': p.counterT = d.stance; ok = true; break;
    case 'flash_step': ok = techFlashStep(d); break;
    case 'limit_release':
      p.limitT = d.dur; ok = true;
      spawnFx('burst_start', p.x, p.y, '#d9564f', 50);
      break;
    case 'quake_stomp': ok = techQuakeStomp(d); break;
    case 'cyclone_kick': p.cycloneT = d.dur; ok = true; break;
    case 'mountain_bash': ok = techMountainBash(d); break;
    case 'iron_bell':
      p.bellT = d.dur; ok = true;
      spawnFx('shock', p.x, p.y, '#d9b06a', 60);
      break;
    case 'sway_step': p.swayT = d.dur; ok = true; break;
  }
  if (ok) {
    let cd = d.cd;
    if (t.id === 'counter_throw' && G.char.special === 'counter_master') cd *= 0.7;
    t.cdLeft = cd;
  }
  return ok;
}

function techGrabSpin(d) {
  const p = G.player;
  let best = null, bd = 110 * 110;
  for (const e of G.enemies) {
    if (e.dead || e.thrown) continue;
    const dd = dist2(p.x, p.y, e.x, e.y);
    if (dd < bd) { bd = dd; best = e; }
  }
  if (!best) return false;
  if (best.boss) {
    // 抓不動頭目：絆倒代替
    hurtEnemy(best, throwDmg(30), { trueDmg: true });
    best.stun = Math.max(best.stun, 0.8 * (grabMaster() ? 1.5 : 1));
    spawnFx('shock', best.x, best.y, '#c2703c', 70);
    return true;
  }
  best.grabbed = true;
  best.stun = 99;
  p.grabState = {
    e: best, t: 0, dur: d.dur * (grabMaster() ? 1.25 : 1),
    ang: Math.atan2(best.y - p.y, best.x - p.x),
    orbitR: d.orbitR, spinSpd: d.spinSpd, tick: 0,
  };
  return true;
}

function techSpearRush(d) {
  const p = G.player;
  const tgt = nearestEnemy(p.x, p.y, 600);
  let dx = p.face, dy = 0;
  if (tgt) {
    const dd = Math.hypot(tgt.x - p.x, tgt.y - p.y) || 1;
    dx = (tgt.x - p.x) / dd; dy = (tgt.y - p.y) / dd;
  }
  p.dashState = { dx, dy, t: d.dashDur, spd: d.dashSpd, carried: null, hitAny: false };
  p.iframe = Math.max(p.iframe, 0.1);
  return true;
}

function techPalmFlurry() {
  const p = G.player;
  p.flurry = { t: 0.7, tick: 0, n: 0 };
  return true;
}

function techFlashStep() {
  const p = G.player;
  const tgt = nearestEnemy(p.x, p.y, 320);
  if (!tgt) return false;
  const a = Math.atan2(tgt.y - p.y, tgt.x - p.x);
  p.x = Math.max(p.r, Math.min(ARENA.w - p.r, tgt.x + Math.cos(a) * (tgt.r + 26)));
  p.y = Math.max(p.r, Math.min(ARENA.h - p.r, tgt.y + Math.sin(a) * (tgt.r + 26)));
  p.iframe = Math.max(p.iframe, 0.4);
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
  p.techs.forEach(t => {
    if (t && t.cdLeft > 0) t.cdLeft -= dt * (1 + Math.max(0, p.stats.atkSpd) / 200);
  });
  if (p.staggerT > 0) p.staggerT -= dt;
  if (p.counterT > 0) p.counterT -= dt;
  if (p.swayT > 0) p.swayT -= dt;
  if (p.flashHasteT > 0) p.flashHasteT -= dt;

  if (p.limitT > 0) {
    p.limitT -= dt;
    if (p.limitT <= 0) {
      // 反噬：至少留 1 血，這是解縛的合約
      p.hp = Math.max(1, p.hp - p.maxHp * 0.08);
      addDmgNum(p.x, p.y - 20, '反噬', '#d9564f', true);
      p.limitSlowT = 2;
    }
  }
  if (p.limitSlowT > 0) p.limitSlowT -= dt;

  if (p.bellT > 0) {
    p.bellT -= dt;
  }

  // 千手張打：連續推掌
  if (p.flurry) {
    const f = p.flurry;
    f.t -= dt; f.tick -= dt;
    if (f.tick <= 0 && f.n < 6) {
      f.tick = 0.115; f.n++;
      const tgt = nearestEnemy(p.x, p.y, 200);
      const ang = tgt ? Math.atan2(tgt.y - p.y, tgt.x - p.x) : (p.face > 0 ? 0 : Math.PI);
      spawnFx('swing', p.x, p.y, '#c9576b', 110, { angle: ang, arc: 120, type: 'arc' });
      for (const e of G.enemies) {
        if (e.dead) continue;
        const dd = Math.hypot(e.x - p.x, e.y - p.y);
        if (dd > 110 + e.r) continue;
        const ea = Math.atan2(e.y - p.y, e.x - p.x);
        if (Math.abs(angDiff(ea, ang)) > 1.05) continue;
        hurtEnemy(e, techDmg(8), { fromAngle: ang });
        if (!e.dead) {
          const kb = e.boss ? 25 : 130;
          e.knockX += Math.cos(ea) * kb; e.knockY += Math.sin(ea) * kb;
        }
      }
    }
    if (f.t <= 0) p.flurry = null;
  }

  // 旋風連腿：移動掃擊
  if (p.cycloneT > 0) {
    p.cycloneT -= dt;
    p.cycloneTick = (p.cycloneTick || 0) - dt;
    if (p.cycloneTick <= 0) {
      p.cycloneTick = 0.12;
      spawnFx('swing', p.x, p.y, '#c9d96a', 100, { angle: G.time * 9 % (Math.PI * 2), arc: 360, type: 'spin' });
      for (const e of G.enemies) {
        if (e.dead) continue;
        if (dist2(e.x, e.y, p.x, p.y) < (100 + e.r) * (100 + e.r)) {
          hurtEnemy(e, techDmg(7), { trueDmg: true });
          if (!e.dead) {
            const a = Math.atan2(e.y - p.y, e.x - p.x);
            e.knockX += Math.cos(a) * 40; e.knockY += Math.sin(a) * 40;
          }
        }
      }
    }
  }

  // 迴旋抓摔：掄人
  if (p.grabState) {
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
            hurtEnemy(o, throwDmg(4 + e.maxHp * 0.04), { trueDmg: true });
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
        e.thrown = { vx: tx * 720, vy: ty * 720, t: 0.55 };
        hurtEnemy(e, throwDmg(10 + e.maxHp * 0.10), { trueDmg: true });
        p.grabState = null;
      }
    }
  }

  // 長矛衝撞
  if (p.dashState) {
    const s = p.dashState;
    s.t -= dt;
    p.x += s.dx * s.spd * dt;
    p.y += s.dy * s.spd * dt;
    const c = s.carried;
    if (c && !c.dead) {
      c.x = p.x + s.dx * (p.r + c.r + 2);
      c.y = p.y + s.dy * (p.r + c.r + 2);
    }
    // 沿路撞到的人
    for (const e of G.enemies) {
      if (e.dead || e === c || e.thrown) continue;
      const rr = p.r + e.r + 4;
      if (dist2(e.x, e.y, p.x, p.y) < rr * rr) {
        if (!c && !e.boss && !s.hitCd) {
          // 第一個撞上的非頭目：扛著走
          s.carried = e; s.hitAny = true;
          e.grabbed = true; e.stun = 99;
        } else if (!e.hitByDash) {
          e.hitByDash = true; s.hitAny = true;
          hurtEnemy(e, techDmg(20), { trueDmg: true });
          if (!e.dead) {
            const a = Math.atan2(e.y - p.y, e.x - p.x);
            e.knockX += Math.cos(a) * 220; e.knockY += Math.sin(a) * 220;
          }
        }
      }
    }
    // 撞牆判定
    const wallHit = p.x <= p.r + 4 || p.x >= ARENA.w - p.r - 4 || p.y <= p.r + 4 || p.y >= ARENA.h - p.r - 4;
    p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x));
    p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y));
    if (wallHit || s.t <= 0) {
      if (c && !c.dead) {
        c.grabbed = false; c.stun = 0;
        if (wallHit) {
          // 撞碎在牆上：吃自身三成生命的傷 + 周圍震盪
          hurtEnemy(c, throwDmg(20 + c.maxHp * 0.30), { trueDmg: true });
          if (!c.dead) c.stun = 1.2 * (grabMaster() ? 1.5 : 1);
          spawnFx('explode', c.x, c.y, '#a33c3c', 120);
          G.screenShake = Math.max(G.screenShake, 12);
          for (const o of G.enemies) {
            if (o.dead || o === c) continue;
            if (dist2(o.x, o.y, c.x, c.y) < 130 * 130) {
              hurtEnemy(o, techDmg(22), { trueDmg: true });
              if (!o.dead) o.stun = Math.max(o.stun, 1.0);
            }
          }
        } else {
          hurtEnemy(c, throwDmg(15), { trueDmg: true });
          if (!c.dead) c.stun = 0.6;
        }
      }
      if (!s.hitAny) {
        p.staggerT = 0.6;   // 撞空的代價
        addDmgNum(p.x, p.y - 24, '撞空', '#9aa4b2');
      }
      G.enemies.forEach(e => { e.hitByDash = false; });
      p.dashState = null;
    }
  }
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
  p.weapons.forEach((w, idx) => {
    w.cdLeft -= dt * spdMul;
    if (w.swing > 0) w.swing -= dt * 6;
    const reach = w.range * rangeMul;
    const target = nearestEnemy(p.x, p.y, reach + 26);
    if (target) {
      const want = Math.atan2(target.y - p.y, target.x - p.x);
      w.angle = want;
    } else {
      const idle = idx * (Math.PI * 2 / Math.max(1, p.weapons.length));
      w.angle = idle + G.time * 0.6;
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

function fireWeapon(w, reach) {
  const p = G.player;
  w.swing = 1;
  w.swingDir *= -1;
  const halfArc = (w.arc * Math.PI / 180) / 2;
  const hits = [];
  for (const e of G.enemies) {
    if (e.dead) continue;
    const dx = e.x - p.x, dy = e.y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > reach + e.r) continue;
    if (w.arc < 360) {
      const a = Math.atan2(dy, dx);
      const allow = halfArc + Math.atan2(e.r, Math.max(20, d));
      if (Math.abs(angDiff(a, w.angle)) > allow) continue;
    }
    hits.push({ e, d });
  }
  if (!hits.length) return;
  hits.sort((a, b) => a.d - b.d);

  let targets = hits;
  if (w.type === 'grab') targets = hits.slice(0, 1);
  else if (w.type === 'thrust' && !w.pierce) targets = hits.slice(0, 1);

  spawnFx('swing', p.x, p.y, w.color, reach, { angle: w.angle, arc: w.arc, type: w.type });

  targets.forEach(h => applyWeaponHit(w, h.e, reach));

  // 雙節棍手：影子攻擊
  if (G.char.special === 'flurry') {
    targets.forEach(h => {
      if (!h.e.dead) applyWeaponHit(w, h.e, reach, 0.4, true);
    });
  }
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
  if (crit) base *= w.critMult;

  const dealt = hurtEnemy(e, base, {
    crit, fromAngle: w.angle, weaponLifesteal: w.lifesteal,
  });

  if (!isEcho) addMomentum(w.type === 'grab' ? 6 : 3);
  if (p.burst > 0) healPlayer(1);

  // 擊退
  if (!e.dead && w.knock > 0) {
    const a = Math.atan2(e.y - p.y, e.x - p.x);
    const kb = w.knock * (e.boss ? 0.12 : (e.elite ? 0.4 : 1)) / (1 + e.r * 0.03);
    e.knockX += Math.cos(a) * kb;
    e.knockY += Math.sin(a) * kb;
  }
  // 狀態
  if (!e.dead) {
    if (w.stun > 0) e.stun = Math.max(e.stun, w.stun * (sp === 'grab_master' ? 1.5 : 1));
    if (w.slow > 0) e.slow = Math.max(e.slow, 1.2);
    if (w.bleed > 0) { e.bleed = w.bleed * liveDamageMult(); e.bleedTime = 3; }
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
  if (p.dashState || p.staggerT > 0) { mx = 0; my = 0; }
  const len = Math.hypot(mx, my);
  const moving = len > 0;
  if (moving) { mx /= len; my /= len; if (mx !== 0) p.face = mx > 0 ? 1 : -1; }

  let spd = BASE_SPEED * liveSpeedMult();
  if (p.counterT > 0) spd *= 0.35;      // 架式站樁
  if (p.grabState) spd *= 0.7;          // 掄著人跑比較慢
  p.vx = mx * spd; p.vy = my * spd;
  p.x += p.vx * dt; p.y += p.vy * dt;
  p.x = Math.max(p.r, Math.min(ARENA.w - p.r, p.x));
  p.y = Math.max(p.r, Math.min(ARENA.h - p.r, p.y));
  p.walkAnim += moving ? dt * 10 : -p.walkAnim * dt * 8;

  if (moving) p.moveTime = Math.min(1, p.moveTime + dt);
  else p.moveTime = 0;

  if (p.iframe > 0) p.iframe -= dt;
  if (p.armorBuffT > 0) { p.armorBuffT -= dt; if (p.armorBuffT <= 0) p.armorBuff = 0; }

  // 氣勢衰退
  if (p.burst > 0) {
    p.burst -= dt;
    if (p.burst <= 0) { p.burst = 0; p.momentum = 0; }
  } else {
    p.hitIdle += dt;
    if (p.hitIdle > 2) p.momentum = Math.max(0, p.momentum - dt * 14);
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
    if (G.char.special === 'scrap_rush') {
      p.scrapStacks = Math.min(10, p.scrapStacks + 1);
      p.scrapTimer = 3;
    }
  } else if (it.type === 'heal') {
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

/* ---------- 升級四選一 ---------- */
function openLevelUp() {
  const pool = STAT_DEFS.filter(s => s.key !== 'harvest' || G.level > 3);
  const chosen = [];
  const used = {};
  let guard = 0;
  while (chosen.length < 4 && guard++ < 60) {
    const s = pick(pool);
    if (used[s.key]) continue;
    used[s.key] = true;
    chosen.push(makeStatOffer(s));
  }
  G.levelChoices = chosen;
  G.mode = 'levelup';
  if (typeof onModeChange === 'function') onModeChange();
}

function makeStatOffer(s) {
  const lv = G.level;
  const scale = 1 + lv * 0.08;
  const table = {
    maxHp: () => rndInt(4, 8) * scale,
    regen: () => rnd(0.6, 1.2) * scale,
    lifesteal: () => rnd(1.2, 2.4) * scale,
    dmg: () => rndInt(4, 8) * scale,
    atkSpd: () => rndInt(4, 8) * scale,
    crit: () => rnd(1.5, 3.5) * scale,
    range: () => rndInt(4, 9) * scale,
    armor: () => rnd(0.8, 1.6) * scale,
    block: () => rnd(1.5, 3.2) * scale,
    dodge: () => rnd(1.2, 2.6) * scale,
    speed: () => rndInt(3, 6) * scale,
    luck: () => rndInt(5, 10) * scale,
    harvest: () => rnd(0.8, 1.8) * scale,
  };
  let v = table[s.key]();
  v = (s.key === 'maxHp' || s.key === 'dmg' || s.key === 'atkSpd' || s.key === 'range' || s.key === 'speed' || s.key === 'luck')
    ? Math.max(1, Math.round(v)) : Math.round(v * 10) / 10;
  return { key: s.key, name: s.name, value: v, suffix: s.suffix, color: s.color };
}

function chooseLevelUp(idx) {
  const c = G.levelChoices[idx];
  G.player.perm[c.key] += c.value;
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
  // 絕技：第 2 波起出現，還沒學過的才會上架
  const owned = G.player.techs.filter(Boolean).map(t => t.id);
  const techPool = TECHNIQUES.filter(t => !owned.includes(t.id));
  if (G.wave >= 2 && techPool.length && chance(0.16)) {
    const t = pick(techPool);
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
    let slot = p.techs[0] ? (p.techs[1] ? -1 : 1) : 0;
    if (slot < 0) {
      if (replaceSlot === undefined) return { ok: false, msg: '絕技欄已滿，點卡片上的替換' };
      slot = replaceSlot;
    }
    G.materials -= e.price;
    p.techs[slot] = makeTech(e.id);
    e.sold = true;
    return { ok: true, msg: '習得 ' + e.name };
  }
  if (e.kind === 'weapon') {
    const same = p.weapons.find(w => w.id === e.id && w.tier === e.tier && e.tier < 4);
    if (!same && p.weapons.length >= p.slots) return { ok: false, msg: '武器欄已滿' };
    G.materials -= e.price;
    if (same) {
      const upgraded = makeWeapon(e.id, Math.min(4, e.tier + 1));
      p.weapons[p.weapons.indexOf(same)] = upgraded;
      e.sold = true;
      return { ok: true, msg: '合成 → ' + TIER_NAME[upgraded.tier] + ' ' + upgraded.name, merged: true };
    }
    p.weapons.push(makeWeapon(e.id, e.tier));
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
}

/* ---------- 主更新 ---------- */
function updateGame(dt) {
  if (G.mode !== 'playing') return;
  G.time += dt;
  updateWave(dt);
  updateSpawning(dt);
  updatePlayer(dt);
  updateWeapons(dt);
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
    return { best: s.best || {}, unlocked: s.unlocked || {}, runs: s.runs || 0, wins: s.wins || 0 };
  } catch (e) { return { best: {}, unlocked: {}, runs: 0, wins: 0 }; }
}
let SAVE = null;
function saveGame() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) {} }

function onRunEnd(won) {
  if (!SAVE) SAVE = loadSave();
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

function maxDangerUnlocked() {
  if (!SAVE) SAVE = loadSave();
  let m = 0;
  for (let i = 1; i <= 5; i++) if (SAVE.unlocked['danger' + i]) m = i;
  return m;
}
