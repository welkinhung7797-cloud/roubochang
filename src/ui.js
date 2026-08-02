/* ============================================================
   肉搏場 — 介面與主迴圈
   ============================================================ */

const $ = id => document.getElementById(id);
let selectedChar = null;
let selectedDanger = 0;

function onModeChange() {
  ['panel-menu', 'panel-select', 'panel-levelup', 'panel-shop', 'panel-end'].forEach(id => {
    $(id).classList.add('hidden');
  });
  $('hud-hint').classList.add('hidden');
  switch (G.mode) {
    case 'menu': $('panel-menu').classList.remove('hidden'); break;
    case 'select': $('panel-select').classList.remove('hidden'); break;
    case 'playing': $('hud-hint').classList.remove('hidden'); break;
    case 'levelup': renderLevelUp(); $('panel-levelup').classList.remove('hidden'); break;
    case 'shop': renderShop(); $('panel-shop').classList.remove('hidden'); break;
    case 'gameover':
    case 'victory': renderEnd(); $('panel-end').classList.remove('hidden'); break;
  }
}

/* ---------- 主選單 ---------- */
function openSelect() {
  G.mode = 'select';
  buildCharSelect();
  buildDangerSelect();
  onModeChange();
}

function buildCharSelect() {
  const wrap = $('char-grid');
  wrap.innerHTML = '';
  if (!SAVE) SAVE = loadSave();
  CHARACTERS.forEach(ch => {
    const w = WEAPON_MAP[ch.weapon];
    const el = document.createElement('div');
    el.className = 'char-card' + (selectedChar === ch.id ? ' active' : '');
    el.dataset.char = ch.id;
    const best = SAVE.best[ch.id];
    el.innerHTML =
      '<canvas class="portrait" width="40" height="40"></canvas>' +
      '<div class="char-name">' + ch.name + '</div>' +
      '<div class="char-tag">' + ch.tag + '　<i>' + w.name + '＋' +
        (ch.startTech ? TECH_MAP[ch.startTech].name : '') + '</i></div>' +
      '<div class="char-stats">' + statLine(ch.stats) + '</div>' +
      '<div class="char-desc">' + ch.desc + '</div>' +
      (best ? '<div class="char-best">最佳　第 ' + best.wave + ' 波 · 危險 ' + best.danger + '</div>' : '');
    el.onclick = () => { selectedChar = ch.id; buildCharSelect(); updateStartBtn(); };
    wrap.appendChild(el);
    drawCharPortraitTo(el.querySelector('.portrait'), ch.id);
  });
}

function statLine(stats) {
  return Object.keys(stats).map(k => {
    const d = STAT_MAP[k];
    const v = stats[k];
    const cls = v > 0 ? 'up' : 'down';
    return '<span class="' + cls + '">' + d.name + ' ' + (v > 0 ? '+' : '') + v + d.suffix + '</span>';
  }).join('');
}

function buildDangerSelect() {
  const wrap = $('danger-row');
  wrap.innerHTML = '';
  const maxUn = maxDangerUnlocked();
  DANGER_LEVELS.forEach(d => {
    const locked = d.lv > maxUn;
    const el = document.createElement('button');
    el.className = 'danger-btn' + (selectedDanger === d.lv ? ' active' : '') + (locked ? ' locked' : '');
    el.textContent = d.lv;
    el.title = locked ? '通關前一個危險等級後解鎖' : ('敵人生命 ×' + d.hp.toFixed(2) + '　傷害 ×' + d.dmg.toFixed(2));
    el.onclick = () => { if (locked) return; selectedDanger = d.lv; buildDangerSelect(); };
    wrap.appendChild(el);
  });
  $('danger-note').textContent = maxUn === 0
    ? '通關危險 0 之後解鎖更高難度'
    : '已解鎖到危險 ' + maxUn;
}

function updateStartBtn() {
  const btn = $('btn-start');
  btn.disabled = !selectedChar;
  btn.textContent = selectedChar
    ? ('以「' + CHARACTERS.find(c => c.id === selectedChar).name + '」出戰')
    : '先選一個職業';
}

function beginRun() {
  if (!selectedChar) return;
  startRun(selectedChar, selectedDanger);
  onModeChange();
}

/* ---------- 升級四選一 ---------- */
function renderLevelUp() {
  $('levelup-title').textContent = '等級 ' + G.level + (G.levelQueue > 1 ? '　（還有 ' + (G.levelQueue - 1) + ' 次）' : '');
  const wrap = $('levelup-cards');
  wrap.innerHTML = '';
  G.levelChoices.forEach((c, i) => {
    const el = document.createElement('button');
    el.className = 'lv-card';
    el.style.borderColor = c.color;
    el.innerHTML =
      '<div class="lv-stat" style="color:' + c.color + '">' + c.name + '</div>' +
      '<div class="lv-val">+' + c.value + c.suffix + '</div>' +
      '<div class="lv-desc">' + STAT_MAP[c.key].desc + '</div>' +
      '<div class="lv-cur">目前　' + fmtStat(c.key) + '</div>';
    el.onclick = () => { chooseLevelUp(i); };
    wrap.appendChild(el);
  });
}

function fmtStat(key) {
  const v = G.player.stats[key];
  const d = STAT_MAP[key];
  if (key === 'maxHp') return G.player.maxHp + '';
  return (Math.round(v * 10) / 10) + d.suffix;
}

/* ---------- 商店 ---------- */
function renderShop() {
  const s = G.shop;
  $('shop-wave').textContent = '第 ' + G.wave + ' 波結束';
  $('shop-next-label').textContent = '進入第 ' + (G.wave + 1) + ' 波' + (isBossWave(G.wave + 1) ? '（頭目）' : '');
  $('shop-mat').textContent = G.materials;
  $('shop-reroll').textContent = '重骰　' + s.rerollCost;
  $('shop-reroll').disabled = G.materials < s.rerollCost;

  const wrap = $('shop-items');
  wrap.innerHTML = '';
  s.entries.forEach((e, i) => {
    const el = document.createElement('div');
    el.className = 'shop-card' + (e.sold ? ' sold' : '');
    const isTech = e.kind === 'tech';
    el.style.borderColor = e.sold ? '#2a2f3a' : (isTech ? e.color : TIER_COLOR[e.tier]);
    const info = isTech ? techShopInfo(e) : (e.kind === 'weapon' ? weaponShopInfo(e) : itemShopInfo(e));
    const p = G.player;
    const mergeable = e.kind === 'weapon' && e.tier < 4 &&
      p.weapons.some(w => w.id === e.id && w.tier === e.tier);
    const techFull = isTech && p.techs[0] && p.techs[1];
    el.innerHTML =
      '<div class="shop-top">' +
        '<canvas class="shop-icon" width="56" height="56"></canvas>' +
        '<div class="shop-name">' +
          '<div class="tier" style="color:' + (isTech ? e.color : TIER_COLOR[e.tier]) + '">' +
            (isTech ? '絕技' : TIER_NAME[e.tier]) + '</div>' +
          '<div class="nm">' + e.name + '</div>' +
        '</div>' +
      '</div>' +
      (mergeable ? '<div class="merge-flag">可合成 → ' + TIER_NAME[e.tier + 1] + '</div>' : '') +
      '<div class="shop-info">' + info + '</div>' +
      '<div class="shop-bottom">' +
        (techFull && !e.sold
          ? '<button class="buy-btn rep" data-slot="0">換掉 ' + p.techs[0].def.name + '</button>' +
            '<button class="buy-btn rep" data-slot="1">換掉 ' + p.techs[1].def.name + '</button>'
          : '<button class="buy-btn"' + (e.sold ? ' disabled' : '') + '>' + (e.sold ? '已售出' : ('買下　' + e.price)) + '</button>') +
        '<button class="lock-btn' + (e.locked ? ' on' : '') + '">' + (e.locked ? '已鎖定' : '鎖定') + '</button>' +
      '</div>';
    wrap.appendChild(el);
    drawIconTo(el.querySelector('.shop-icon'), e.kind, e.id, e.tier);
    el.querySelectorAll('.buy-btn').forEach(buy => {
      const slot = buy.dataset.slot !== undefined ? parseInt(buy.dataset.slot) : undefined;
      if (!e.sold && e.kind === 'weapon' && !mergeable && p.weapons.length >= p.slots) {
        buy.disabled = true; buy.textContent = '武器欄已滿';
      } else if (!e.sold && G.materials < e.price) {
        buy.disabled = true;
        buy.textContent = (slot !== undefined ? buy.textContent + '（素材不足）' : '素材不足　' + e.price);
      }
      buy.onclick = () => {
        const r = shopBuy(i, slot);
        if (r.ok) { toast(r.msg); renderShop(); }
        else if (r.msg) toast(r.msg, true);
      };
    });
    el.querySelector('.lock-btn').onclick = () => { e.locked = !e.locked; renderShop(); };
  });

  renderLoadout();
  renderStatsPanel();
}

function weaponShopInfo(e) {
  const w = makeWeapon(e.id, e.tier);
  const base = WEAPON_MAP[e.id];
  const typeName = { arc: '揮擊', thrust: '突刺', spin: '旋轉', grab: '抓取', slam: '震擊' }[w.type];
  let extra = [];
  if (w.pierce) extra.push('貫穿');
  if (w.stun) extra.push('定身 ' + w.stun + ' 秒');
  if (w.bleed) extra.push('流血');
  if (w.dot) extra.push('持續傷害');
  if (w.slow) extra.push('減速');
  if (w.lifesteal) extra.push('吸血 ' + w.lifesteal + '%');
  return '<div class="kv"><span>傷害</span><b>' + w.dmg + '</b></div>' +
    '<div class="kv"><span>冷卻</span><b>' + w.cd.toFixed(2) + ' 秒</b></div>' +
    '<div class="kv"><span>範圍</span><b>' + w.range + '</b></div>' +
    '<div class="kv"><span>類型</span><b>' + base.klass + ' · ' + typeName + '</b></div>' +
    (extra.length ? '<div class="tagrow">' + extra.map(t => '<i>' + t + '</i>').join('') + '</div>' : '') +
    '<div class="flavor">' + base.desc + '</div>';
}

function techShopInfo(e) {
  const t = TECH_MAP[e.id];
  return '<div class="kv"><span>冷卻</span><b>' + t.cd + ' 秒</b></div>' +
    '<div class="kv"><span>按鍵</span><b>Space 或 E</b></div>' +
    '<div class="flavor">' + t.desc + '</div>';
}

function itemShopInfo(e) {
  const it = ITEM_MAP[e.id];
  const lines = Object.keys(it.stats || {}).map(k => {
    const d = STAT_MAP[k], v = it.stats[k];
    return '<div class="kv"><span>' + d.name + '</span><b class="' + (v > 0 ? 'up' : 'down') + '">' +
      (v > 0 ? '+' : '') + v + d.suffix + '</b></div>';
  }).join('');
  const sp = it.special ? '<div class="flavor">' + SPECIAL_DESC[it.special] + '</div>' : '';
  return lines + sp;
}

function renderLoadout() {
  const p = G.player;
  const wrap = $('loadout');
  wrap.innerHTML = '';
  // 絕技欄
  const tTitle = document.createElement('div');
  tTitle.className = 'sec-title';
  tTitle.textContent = '絕技　' + p.techs.filter(Boolean).length + ' / 2';
  wrap.appendChild(tTitle);
  const tRow = document.createElement('div');
  tRow.className = 'loadout-row';
  p.techs.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'slot tech-slot';
    if (t) {
      el.style.borderColor = t.def.color;
      el.innerHTML = '<div class="tech-glyph" style="color:' + t.def.color + '">' + t.def.short + '</div>' +
        '<div class="slot-name">' + t.def.name + '</div>' +
        '<div class="slot-tier">' + (i === 0 ? 'Space' : 'E') + '</div>';
      el.title = t.def.desc;
    } else {
      el.innerHTML = '<div class="tech-glyph empty">—</div>' +
        '<div class="slot-name" style="color:#5f6878">空</div>' +
        '<div class="slot-tier">' + (i === 0 ? 'Space' : 'E') + '</div>';
    }
    tRow.appendChild(el);
  });
  wrap.appendChild(tRow);

  const wTitle = document.createElement('div');
  wTitle.className = 'sec-title';
  wTitle.textContent = '武器　' + p.weapons.length + ' / ' + p.slots;
  wrap.appendChild(wTitle);
  const row = document.createElement('div');
  row.className = 'loadout-row';
  p.weapons.forEach(w => {
    const el = document.createElement('div');
    el.className = 'slot';
    el.style.borderColor = TIER_COLOR[w.tier];
    el.innerHTML = '<canvas width="52" height="52"></canvas>' +
      '<div class="slot-name">' + w.name + '</div>' +
      '<div class="slot-tier" style="color:' + TIER_COLOR[w.tier] + '">' + TIER_NAME[w.tier] + '</div>';
    row.appendChild(el);
    drawIconTo(el.querySelector('canvas'), 'weapon', w.id, w.tier);
    if (p.weapons.length > 1) {
      const sell = document.createElement('button');
      sell.className = 'sell-btn';
      const back = Math.max(1, Math.round(weaponPrice(w.id, w.tier) * shopInflation(G.wave) * 0.5));
      sell.textContent = '賣 ' + back;
      sell.onclick = () => { shopSellWeapon(w.uid); renderShop(); };
      el.appendChild(sell);
    }
  });
  wrap.appendChild(row);

  if (p.items.length) {
    const t = document.createElement('div');
    t.className = 'sec-title';
    t.textContent = '道具　' + p.items.length;
    wrap.appendChild(t);
    const irow = document.createElement('div');
    irow.className = 'item-row';
    const counts = {};
    p.items.forEach(i => counts[i.id] = (counts[i.id] || 0) + 1);
    Object.keys(counts).forEach(id => {
      const it = ITEM_MAP[id];
      const el = document.createElement('div');
      el.className = 'item-chip';
      el.style.borderColor = TIER_COLOR[it.tier];
      el.innerHTML = '<canvas width="34" height="34"></canvas><span>' + it.name +
        (counts[id] > 1 ? ' ×' + counts[id] : '') + '</span>';
      el.title = Object.keys(it.stats).map(k => STAT_MAP[k].name + ' ' + (it.stats[k] > 0 ? '+' : '') + it.stats[k] + STAT_MAP[k].suffix).join('　') +
        (it.special ? '　' + SPECIAL_DESC[it.special] : '');
      irow.appendChild(el);
      drawIconTo(el.querySelector('canvas'), 'item', id, it.tier);
    });
    wrap.appendChild(irow);
  }
}

function renderStatsPanel() {
  const p = G.player;
  const wrap = $('stats-panel');
  wrap.innerHTML = '<div class="sec-title">屬性</div>';
  const grid = document.createElement('div');
  grid.className = 'stat-grid';
  STAT_DEFS.forEach(d => {
    let v = p.stats[d.key];
    let show;
    if (d.key === 'maxHp') show = p.maxHp;
    else show = Math.round(v * 10) / 10;
    const el = document.createElement('div');
    el.className = 'stat-cell' + (v === 0 && d.key !== 'maxHp' ? ' zero' : '');
    el.innerHTML = '<span class="sn">' + d.name + '</span><b style="color:' + d.color + '">' +
      show + d.suffix + '</b>';
    el.title = d.desc;
    grid.appendChild(el);
  });
  wrap.appendChild(grid);
}

let toastTimer = null;
function toast(msg, bad) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 1400);
}

/* ---------- 結算 ---------- */
function renderEnd() {
  const won = G.mode === 'victory';
  $('end-title').textContent = won ? '通關' : '倒下';
  $('end-title').style.color = won ? '#e0c341' : '#d9564f';
  $('end-sub').textContent = won
    ? ('以「' + G.char.name + '」在危險 ' + G.danger + ' 撐過全部 ' + MAX_WAVE + ' 波')
    : ('以「' + G.char.name + '」倒在第 ' + G.wave + ' 波，危險 ' + G.danger);
  $('end-stats').innerHTML =
    '<div class="kv"><span>擊殺</span><b>' + G.kills + '</b></div>' +
    '<div class="kv"><span>累積素材</span><b>' + G.totalMaterials + '</b></div>' +
    '<div class="kv"><span>造成傷害</span><b>' + Math.round(G.stats.dmgDealt) + '</b></div>' +
    '<div class="kv"><span>承受傷害</span><b>' + Math.round(G.stats.dmgTaken) + '</b></div>' +
    '<div class="kv"><span>等級</span><b>' + G.level + '</b></div>';
  if (won) {
    const nd = Math.min(5, G.danger + 1);
    $('end-unlock').textContent = G.danger < 5 ? ('解鎖　危險 ' + nd) : '已達最高危險等級';
    $('end-unlock').classList.remove('hidden');
  } else {
    $('end-unlock').classList.add('hidden');
  }
}

/* ---------- 輸入 ---------- */
function initInput() {
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    G.keys[k] = true;
    if (k === ' ' || k === 'arrowup' || k === 'arrowdown') e.preventDefault();
    if (k === 'escape' && G.mode === 'playing') G.paused = !G.paused;
    if (G.mode === 'playing' && !G.paused) {
      if (k === ' ') castTech(0);
      if (k === 'e') castTech(1);
    }
    if (G.mode === 'levelup' && ['1', '2', '3', '4'].includes(k)) {
      const i = parseInt(k) - 1;
      if (G.levelChoices && G.levelChoices[i]) chooseLevelUp(i);
    }
    if (G.mode === 'shop' && k === 'r') { if (shopReroll()) renderShop(); }
    if (G.mode === 'shop' && k === 'enter') shopNextWave();
  });
  window.addEventListener('keyup', e => { G.keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { G.keys = {}; });
}

/* ---------- 主迴圈 ---------- */
let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0);
  lastT = t;
  if (!G.paused) {
    if (BOT.on && G.mode === 'playing') botControl(dt);
    updateGame(dt);
    if (BOT.on) botAutoUi();
  }
  if (G.player) drawGame();
  else drawIdleBackdrop();
}

function drawIdleBackdrop() {
  if (!ctx) return;
  ctx.fillStyle = '#12141a';
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);
  ctx.strokeStyle = '#1b1f27';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = 0; x <= VIEW.w; x += 60) { ctx.moveTo(x, 0); ctx.lineTo(x, VIEW.h); }
  for (let y = 0; y <= VIEW.h; y += 60) { ctx.moveTo(0, y); ctx.lineTo(VIEW.w, y); }
  ctx.stroke();
}

/* ---------- 自動測試機器人（開發用） ---------- */
const BOT = { on: false, dir: 0, dirT: 0 };

/* 機器人的絕技判斷：模擬一個會看時機的玩家 */
function botCastTechs() {
  const p = G.player;
  p.techs.forEach((t, slot) => {
    if (!t || t.cdLeft > 0) return;
    const near = r => G.enemies.filter(e => !e.dead && !e.grabbed && !e.thrown &&
      dist2(e.x, e.y, p.x, p.y) < r * r).length;
    const bossHere = G.enemies.some(e => e.boss);
    switch (t.id) {
      case 'grab_spin': if (near(100) >= 1 && G.enemies.length >= 2) castTech(slot); break;
      case 'spear_rush': if (near(260) >= 4) castTech(slot); break;
      case 'palm_flurry': if (near(120) >= 3) castTech(slot); break;
      case 'counter_throw': if (near(110) >= 2) castTech(slot); break;
      case 'flash_step': {
        const e = nearestEnemy(p.x, p.y, 320);
        const rangeMul = liveRangeMult();
        let reach = 0; p.weapons.forEach(w => reach = Math.max(reach, w.range * rangeMul));
        if (e && dist2(e.x, e.y, p.x, p.y) > (reach + 60) * (reach + 60)) castTech(slot);
        break;
      }
      case 'limit_release': if (bossHere || G.enemies.length >= 8) castTech(slot); break;
      case 'quake_stomp': if (near(140) >= 3 || (bossHere && near(140) >= 1)) castTech(slot); break;
      case 'cyclone_kick': if (near(110) >= 3) castTech(slot); break;
      case 'mountain_bash': if (near(120) >= 2) castTech(slot); break;
      case 'iron_bell': if (near(150) >= 5 || (bossHere && p.hp < p.maxHp * 0.6)) castTech(slot); break;
      case 'sway_step': if (near(140) >= 3) castTech(slot); break;
    }
  });
}

function botControl(dt) {
  const p = G.player;
  G.keys = {};
  botCastTechs();
  // 交戰距離取自身最長武器：近戰遊戲的正解是「進到打得到、但沒被摸到」
  const rangeMul = liveRangeMult();
  let reach = 0;
  p.weapons.forEach(w => { reach = Math.max(reach, w.range * rangeMul); });
  const engage = Math.max(46, reach * 0.74);
  const contact = p.r + 20;

  let fx = 0, fy = 0, pressure = 0;
  // 只有真的被貼到才閃，不然永遠打不到人
  for (const e of G.enemies) {
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const near = contact + e.r + 16;
    if (d < near) {
      const w = (near - d) / near;
      fx += dx / d * w * 3.4; fy += dy / d * w * 3.4;
      pressure += w;
    }
  }
  // 進場開打並繞圈，避免被包住
  const tgt = nearestEnemy(p.x, p.y, 1400);
  if (tgt && pressure < 1.5) {
    const dx = tgt.x - p.x, dy = tgt.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const err = (d - engage) / engage;
    const drive = Math.max(-1.2, Math.min(1.3, err * 1.6));
    fx += dx / d * drive; fy += dy / d * drive;
    fx += -dy / d * 0.55; fy += dx / d * 0.55;
  }
  // 壓力小的時候順路撿素材
  if (pressure < 0.9) {
    let bestD = 1e9, bx = 0, by = 0;
    for (const it of G.pickups) {
      const d = dist2(p.x, p.y, it.x, it.y);
      if (d < bestD) { bestD = d; bx = it.x; by = it.y; }
    }
    if (bestD < 420 * 420) {
      const d = Math.sqrt(bestD) || 1;
      fx += (bx - p.x) / d * 0.8; fy += (by - p.y) / d * 0.8;
    }
  }
  // 場邊排斥
  const M = 120;
  if (p.x < M) fx += (M - p.x) / M * 2;
  if (p.x > ARENA.w - M) fx -= (p.x - (ARENA.w - M)) / M * 2;
  if (p.y < M) fy += (M - p.y) / M * 2;
  if (p.y > ARENA.h - M) fy -= (p.y - (ARENA.h - M)) / M * 2;

  if (Math.abs(fx) < 0.05 && Math.abs(fy) < 0.05) { fx = Math.cos(G.time); fy = Math.sin(G.time); }
  if (fx > 0.12) G.keys['d'] = true; else if (fx < -0.12) G.keys['a'] = true;
  if (fy > 0.12) G.keys['s'] = true; else if (fy < -0.12) G.keys['w'] = true;
}

function botAutoUi() {
  if (G.mode === 'levelup' && G.levelChoices) {
    // 模擬會挑的玩家：先顧活著跟輸出，幸運與收成只在行有餘力時拿
    const p = G.player;
    const squishy = p.maxHp < 90 + G.wave * 4;
    const W = {
      maxHp: squishy ? 3.4 : 1.9, armor: squishy ? 2.6 : 1.7,
      dmg: 3.0, atkSpd: 2.6, crit: 1.8, range: 1.5,
      lifesteal: 2.2, regen: G.char.special === 'no_regen' || G.char.special === 'rage' ? 0.1 : 1.8,
      dodge: 1.6, block: 1.4, speed: 1.5, luck: 0.8, harvest: 0.7,
    };
    let best = 0, bestScore = -1;
    G.levelChoices.forEach((c, i) => {
      const s = (W[c.key] || 1) * (0.8 + rng() * 0.4);
      if (s > bestScore) { bestScore = s; best = i; }
    });
    chooseLevelUp(best);
  } else if (G.mode === 'shop') {
    // 模擬一個懂遊戲的玩家：先補武器與合成，再堆道具，殘血優先補生存
    const p = G.player;
    let guard = 0;
    while (guard++ < 10) {
      const cands = G.shop.entries
        .map((e, i) => ({ e, i }))
        .filter(o => !o.e.sold && o.e.price <= G.materials)
        .map(o => {
          const e = o.e;
          let score = e.price * 0.5;
          if (e.kind === 'tech') {
            if (!p.techs[0] || !p.techs[1]) score += 550;
            else score -= 900;
          } else if (e.kind === 'weapon') {
            const merge = p.weapons.some(w => w.id === e.id && w.tier === e.tier) && e.tier < 4;
            if (merge) score += 1200;
            else if (p.weapons.length < Math.min(p.slots, 4)) score += 600 + e.tier * 120;
            else if (p.weapons.length < p.slots) score += 260 + e.tier * 100;
            else score -= 200;
          } else {
            const it = ITEM_MAP[e.id];
            score += 120 + it.tier * 90;
            if (p.hp / p.maxHp < 0.55) {
              const s = it.stats || {};
              if (s.regen > 0 || s.lifesteal > 0 || s.maxHp > 0 || s.armor > 0) score += 420;
            }
          }
          return { o, score };
        })
        .sort((a, b) => b.score - a.score);
      if (!cands.length) break;
      const r = shopBuy(cands[0].o.i);
      if (!r.ok) break;
    }
    shopNextWave();
  }
}

/* ---------- 開發用測試介面 ---------- */
window.__test = {
  G, BOT,
  errors: [],
  start(charId, danger, seed) {
    if (seed !== undefined) setSeed(seed);
    selectedChar = charId; selectedDanger = danger || 0;
    startRun(charId, danger || 0);
    onModeChange();
  },
  bot(on) { BOT.on = on !== false; },
  /* 不靠畫面、以固定步長快轉，回傳每波摘要 */
  simulate(charId, danger, seed, maxSeconds) {
    setSeed(seed === undefined ? 12345 : seed);
    BOT.on = true;
    startRun(charId, danger || 0);
    const dt = 1 / 60;
    const log = [];
    let t = 0, lastWave = 1;
    const cap = maxSeconds || 1800;
    while (t < cap && G.mode !== 'gameover' && G.mode !== 'victory') {
      if (G.mode === 'playing') { botControl(dt); updateGame(dt); }
      botAutoUi();
      if (G.mode === 'playing' && G.wave !== lastWave) {
        log.push({ wave: lastWave, hp: Math.round(G.player.hp), mat: G.materials, lv: G.level,
                   weapons: G.player.weapons.map(w => w.name + TIER_NAME[w.tier]).join(','),
                   items: G.player.items.length, kills: G.kills });
        lastWave = G.wave;
      }
      t += dt;
    }
    BOT.on = false;
    return {
      result: G.mode, wave: G.wave, level: G.level, kills: G.kills,
      hp: Math.round(G.player.hp), maxHp: G.player.maxHp,
      simSeconds: Math.round(t), log,
    };
  },
};

/* ---------- 啟動 ---------- */
window.addEventListener('error', e => {
  window.__test.errors.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno);
  const box = $('errbox');
  if (box) { box.classList.remove('hidden'); box.textContent = '錯誤：' + e.message; }
});

function boot() {
  SAVE = loadSave();
  initRender();
  initInput();
  $('btn-play').onclick = openSelect;
  $('btn-back').onclick = () => { G.mode = 'menu'; onModeChange(); };
  $('btn-start').onclick = beginRun;
  $('shop-reroll').onclick = () => { if (shopReroll()) renderShop(); };
  $('shop-next').onclick = shopNextWave;
  $('btn-retry').onclick = () => { G.player = null; openSelect(); };
  $('btn-menu').onclick = () => { G.player = null; G.mode = 'menu'; onModeChange(); };
  updateStartBtn();
  onModeChange();
  requestAnimationFrame(loop);
}
window.addEventListener('DOMContentLoaded', boot);
