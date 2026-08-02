/* ============================================================
   Penguin Can Fight — 介面與主迴圈
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
  // 排序：可選的在前（三傑＋已解鎖），未解鎖照解鎖順序排後面
  const ordered = [...CHARACTERS].sort((a, b) => {
    const ua = charUnlocked(a.id) ? 0 : 1, ub = charUnlocked(b.id) ? 0 : 1;
    if (ua !== ub) return ua - ub;
    return 0;
  });
  ordered.forEach(ch => {
    const w = WEAPON_MAP[ch.weapon];
    const unlocked = charUnlocked(ch.id);
    const el = document.createElement('div');
    el.className = 'char-card' + (selectedChar === ch.id ? ' active' : '') + (unlocked ? '' : ' locked');
    el.dataset.char = ch.id;
    const best = SAVE.best[ch.id];
    if (!unlocked) {
      const idx = UNLOCK_ORDER.indexOf(ch.id);
      const need = unlockNeed(idx);
      const have = SAVE.totalWaves || 0;
      el.innerHTML =
        '<img class="portrait dim" src="assets/portraits/' + ch.id + '.png" alt="' + ch.name + '"' +
          ' onerror="this.style.display=\'none\'">' +
        '<div class="char-name">' + ch.name + '</div>' +
        '<div class="char-tag">修行中</div>' +
        '<div class="char-lock">累積 ' + need + ' 波解鎖<br>（目前 ' + Math.min(have, need) + '／' + need + '）</div>';
      el.title = '每一局打到的波數都會累積，累積 ' + need + ' 波後解鎖';
      wrap.appendChild(el);
      return;
    }
    el.innerHTML =
      '<img class="portrait" src="assets/portraits/' + ch.id + '.png" alt="' + ch.name + '"' +
        ' onerror="this.style.display=\'none\'">' +
      '<div class="char-name">' + ch.name + '</div>' +
      '<div class="char-tag">' + ch.tag + '</div>' +
      '<div class="char-combo">' + ['dash', 'move', 'still'].map(slot => {
        const d = moveDef(ch.moves[slot]);
        return '<b style="color:' + d.color + '" title="' + SLOT_NAME[slot] + '">' + d.short + '</b>';
      }).join('<i>·</i>') +
      (OUGI[ch.id] ? '<i>｜</i><b style="color:#ffd44a" title="奧義">' + OUGI[ch.id].name.slice(0, 2) + '</b>' : '') +
      '</div>' +
      '<div class="char-stats">' + statLine(ch.stats) + '</div>' +
      (best ? '<div class="char-best">最佳　第 ' + best.wave + ' 波 · 危險 ' + best.danger + '</div>' : '');
    el.title = ch.desc;
    el.onclick = () => { selectedChar = ch.id; buildCharSelect(); updateStartBtn(); updateCharDetail(ch); };
    wrap.appendChild(el);
  });
}

/* 點選職業後，下方大字顯示完整說明與連段全名——特色要讀得到，不是擠在小卡裡 */
function updateCharDetail(ch) {
  const el = $('char-detail');
  if (!el) return;
  const w = WEAPON_MAP[ch.weapon];
  const moveNames = ['dash', 'move', 'still'].map(slot =>
    SLOT_NAME[slot] + '「' + moveDef(ch.moves[slot]).name + '」').join('　');
  const o = OUGI[ch.id];
  el.innerHTML =
    '<b style="color:' + ch.color + '">' + ch.name + '</b>　' +
    '<span class="d-combo">' + moveNames + '</span>　' +
    '<span class="d-weapon">起手武器「' + w.name + '」</span><br>' +
    (o ? '<span class="d-combo">奧義「' + o.name + '」＝' +
      o.seq.map(b => b === 'S' ? '站' : (b === 'D' ? '衝' : '移')).join('·') + '＋衝刺　—　' + o.desc + '</span><br>' : '') +
    '<span class="d-desc">' + ch.desc + '</span>';
  el.classList.remove('hidden');
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
  if (!selectedChar || !charUnlocked(selectedChar)) return;
  startRun(selectedChar, selectedDanger);
  onModeChange();
}

/* ---------- 升級四選一 ---------- */
function renderLevelUp() {
  $('levelup-title').textContent = '等級 ' + G.level + (G.levelQueue > 1 ? '　（還有 ' + (G.levelQueue - 1) + ' 次）' : '');
  const wrap = $('levelup-cards');
  wrap.innerHTML = '';
  const gearColor = ['#d98a3c', '#c9576b', '#5a8ac9', '#77c47f'];
  G.levelChoices.forEach((g, i) => {
    const el = document.createElement('button');
    el.className = 'lv-card';
    el.style.borderColor = gearColor[i % 4];
    const statLineHtml = g.stats
      ? '<div class="lv-cur">' + Object.keys(g.stats).map(k =>
          STAT_MAP[k].name + ' ' + (g.stats[k] > 0 ? '+' : '') + g.stats[k] + STAT_MAP[k].suffix
        ).join('　') + '</div>'
      : '<div class="lv-cur">' + (g.unique ? '獨門裝備' : '可重複拿') + '</div>';
    el.innerHTML =
      '<img class="lv-icon" src="assets/icons/' + g.id + '.png" alt="" onerror="this.style.display=\'none\'">' +
      '<div class="lv-stat" style="color:' + gearColor[i % 4] + '">' + g.name + '</div>' +
      '<div class="lv-desc" style="min-height:64px">' + g.desc + '</div>' +
      statLineHtml;
    el.onclick = () => { chooseLevelUp(i); };
    wrap.appendChild(el);
  });
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
    el.innerHTML =
      '<div class="shop-top">' +
        '<canvas class="shop-icon" width="56" height="56"></canvas>' +
        '<div class="shop-name">' +
          '<div class="tier" style="color:' + (isTech ? e.color : TIER_COLOR[e.tier]) + '">' +
            (isTech ? SLOT_NAME[MOVE_MAP[e.id].slot] : TIER_NAME[e.tier]) + '</div>' +
          '<div class="nm">' + e.name + '</div>' +
        '</div>' +
      '</div>' +
      (mergeable ? '<div class="merge-flag">可合成 → ' + TIER_NAME[e.tier + 1] + '</div>' : '') +
      '<div class="shop-info">' + info + '</div>' +
      '<div class="shop-bottom">' +
        '<button class="buy-btn"' + (e.sold ? ' disabled' : '') + '>' + (e.sold ? '已售出' : ('買下　' + e.price)) + '</button>' +
        '<button class="lock-btn' + (e.locked ? ' on' : '') + '">' + (e.locked ? '已鎖定' : '鎖定') + '</button>' +
      '</div>';
    wrap.appendChild(el);
    drawIconTo(el.querySelector('.shop-icon'), e.kind, e.id, e.tier);
    const buy = el.querySelector('.buy-btn');
    if (!e.sold && e.kind === 'weapon' && !mergeable && p.weapons.length >= p.slots) {
      buy.disabled = true; buy.textContent = '武器欄已滿';
    } else if (!e.sold && G.materials < e.price) {
      buy.disabled = true; buy.textContent = '素材不足　' + e.price;
    }
    buy.onclick = () => {
      const r = shopBuy(i);
      if (r.ok) { toast(r.msg); renderShop(); }
      else if (r.msg) toast(r.msg, true);
    };
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
  const t = moveDef(e.id);
  let extra = '';
  if (t.slot === 'dash') extra = '<div class="kv"><span>冷卻</span><b>' + t.cd + ' 秒</b></div>';
  else if (t.interval) extra = '<div class="kv"><span>觸發</span><b>每 ' + t.interval + ' 秒</b></div>';
  return '<div class="kv"><span>類型</span><b>' + SLOT_NAME[t.slot] + '　' + SLOT_KEY[t.slot] + '</b></div>' +
    extra +
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
  // 三態招式欄：點擊換同類型的已學招式
  const ougi = OUGI[G.char.id];
  const tTitle = document.createElement('div');
  tTitle.className = 'sec-title';
  tTitle.textContent = '招式（點擊換裝）　·　招式庫 ' + p.knownMoves.length + ' 式' +
    (ougi ? '　·　奧義「' + ougi.name + '」＝' + ougi.seq.map(b => b === 'S' ? '站' : (b === 'D' ? '衝' : '移')).join('·') + '＋衝' : '');
  wrap.appendChild(tTitle);
  const tRow = document.createElement('div');
  tRow.className = 'loadout-row combo-row';
  ['dash', 'move', 'still'].forEach(slot => {
    const def = moveDef(p.moves[slot]);
    const pool = movesBySlot(slot).filter(x => p.knownMoves.includes(x.id));
    const el = document.createElement('div');
    el.className = 'slot tech-slot' + (pool.length > 1 ? ' clickable' : '');
    el.style.borderColor = def.color;
    el.innerHTML = '<div class="tech-glyph" style="color:' + def.color + '">' + def.short + '</div>' +
      '<div class="slot-name">' + def.name + '</div>' +
      '<div class="slot-tier">' + SLOT_NAME[slot] + (pool.length > 1 ? ' ⟳' : '') + '</div>';
    el.title = SLOT_KEY[slot] + '\n' + def.desc +
      (pool.length > 1 ? '\n（點擊切換：' + pool.map(x => x.name).join('、') + '）' : '');
    if (pool.length > 1) el.onclick = () => { cycleMoveSlot(slot); renderShop(); };
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
    t.textContent = '道具與裝備　' + p.items.length;
    wrap.appendChild(t);
    const irow = document.createElement('div');
    irow.className = 'item-row';
    const counts = {};
    p.items.forEach(i => counts[i.id] = (counts[i.id] || 0) + 1);
    Object.keys(counts).forEach(id => {
      const it = ITEM_MAP[id] || GEAR_MAP[id];
      if (!it) return;
      const isGear = !ITEM_MAP[id];
      const el = document.createElement('div');
      el.className = 'item-chip';
      el.style.borderColor = isGear ? '#d98a3c' : TIER_COLOR[it.tier];
      el.innerHTML = (isGear
          ? '<img class="chip-icon" src="assets/icons/' + id + '.png" alt="" ' +
            'onerror="this.outerHTML=\'<canvas width=34 height=34></canvas>\'">'
          : '<canvas width="34" height="34"></canvas>') +
        '<span>' + it.name + (counts[id] > 1 ? ' ×' + counts[id] : '') + '</span>';
      const statTxt = it.stats
        ? Object.keys(it.stats).map(k => STAT_MAP[k].name + ' ' + (it.stats[k] > 0 ? '+' : '') + it.stats[k] + STAT_MAP[k].suffix).join('　')
        : '';
      el.title = (it.desc || '') + (statTxt ? '　' + statTxt : '') +
        (it.special ? '　' + SPECIAL_DESC[it.special] : '');
      irow.appendChild(el);
      const cv = el.querySelector('canvas');
      if (cv) drawIconTo(cv, isGear ? 'gear' : 'item', id, it.tier || 2);
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

/* ---------- F2 即時調參面板 ----------
   改數字立即生效並存 localStorage；「匯出」複製 JSON 給工程回寫官方預設。 */
function saveTune() {
  try { localStorage.setItem('penguin_tune_v1', JSON.stringify(TUNE)); } catch (e) {}
}

function buildTunePanel() {
  const body = $('tune-body');
  if (!body || body.childElementCount) return;
  let curGroup = null;
  TUNE_DEFS.forEach(d => {
    if (d.g !== curGroup) {
      curGroup = d.g;
      const gh = document.createElement('div');
      gh.className = 'tune-group';
      gh.textContent = d.g;
      body.appendChild(gh);
    }
    const row = document.createElement('div');
    row.className = 'tune-row' + (TUNE[d.k] !== d.def ? ' changed' : '');
    row.innerHTML =
      '<label>' + d.n + '</label>' +
      '<input type="range" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + TUNE[d.k] + '">' +
      '<input type="number" min="' + d.min + '" max="' + d.max + '" step="' + d.step + '" value="' + TUNE[d.k] + '">';
    const [slider, num] = row.querySelectorAll('input');
    const apply = v => {
      v = parseFloat(v);
      if (isNaN(v)) return;
      TUNE[d.k] = v;
      slider.value = v; num.value = v;
      row.classList.toggle('changed', v !== d.def);
      saveTune();
      if (G.player) recalcStats(G.player);   // 生命上限等即時反映
    };
    slider.oninput = () => apply(slider.value);
    num.onchange = () => apply(num.value);
    row.dataset.key = d.k;
    body.appendChild(row);
  });
  $('tune-reset').onclick = () => {
    TUNE_DEFS.forEach(d => TUNE[d.k] = d.def);
    saveTune();
    body.innerHTML = '';
    buildTunePanel();
    if (G.player) recalcStats(G.player);
    toast('調參已全部重置');
  };
  $('tune-export').onclick = () => {
    const diff = {};
    TUNE_DEFS.forEach(d => { if (TUNE[d.k] !== d.def) diff[d.k] = TUNE[d.k]; });
    const txt = JSON.stringify(diff, null, 2);
    navigator.clipboard.writeText(txt).then(() => toast('已複製調整值（貼給工程定案）'));
  };
  $('tune-close').onclick = () => $('tune-panel').classList.add('hidden');
}

function toggleTunePanel() {
  const p = $('tune-panel');
  if (!p) return;
  buildTunePanel();
  p.classList.toggle('hidden');
}

/* ---------- 輸入 ---------- */
function initInput() {
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    G.keys[k] = true;
    if (k === ' ' || k === 'arrowup' || k === 'arrowdown') e.preventDefault();
    if (k === 'escape' && G.mode === 'playing') G.paused = !G.paused;
    if (G.mode === 'playing' && !G.paused) {
      if (k === ' ') castDash();
    }
    if (k === 'm' && typeof sfxToggleMute === 'function') {
      toast(sfxToggleMute() ? '靜音' : '音效開');
    }
    if (k === 'f2') { e.preventDefault(); toggleTunePanel(); }
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

/* 機器人的衝刺判斷：奧義就緒立刻放，否則依衝刺技的性質看時機 */
function botDash() {
  const p = G.player;
  if (p.dashCd > 0 || p.dashState || p.grabState) return;
  const near = r => G.enemies.filter(e => !e.dead && !e.grabbed && !e.thrown &&
    dist2(e.x, e.y, p.x, p.y) < r * r).length;
  if (ougiReady() && near(300) >= 1) { castDash(); return; }
  let go = false;
  switch (p.moves.dash) {
    case 'tackle': go = near(260) >= 3; break;
    case 'grab_spin': go = near(160) >= 1 && G.enemies.length >= 2; break;
    case 'flash_step': {
      const e = nearestEnemy(p.x, p.y, 320);
      const rangeMul = liveRangeMult();
      let reach = 0; p.weapons.forEach(w => reach = Math.max(reach, w.range * rangeMul));
      go = e && dist2(e.x, e.y, p.x, p.y) > (reach + 60) * (reach + 60);
      break;
    }
    case 'mountain_bash': go = near(130) >= 2; break;
    case 'knee_dash': go = near(240) >= 3; break;
    case 'drunk_roll': go = near(130) >= 3 || (p.hp < p.maxHp * 0.4 && near(110) >= 1); break;
    case 'suplex_grab': go = near(160) >= 1 && G.enemies.length >= 2; break;
    case 'iai_slash': go = near(260) >= 2; break;
    case 'shadow_dash': {
      const e2 = nearestEnemy(p.x, p.y, 400);
      go = (p.hp < p.maxHp * 0.45 && near(120) >= 2) || !e2;
      break;
    }
    case 'sumo_press': go = near(140) >= 3; break;
  }
  if (go) castDash();
}

/* 站樁技有價值時，機器人要肯站著——威脅低就停下來蓄力／回氣 */
function botWantsStill() {
  const p = G.player;
  const sid = p.moves.still;
  // 場上有遠程壓力（投擲手或飛行物瞄著你）就別死站著捱打
  const throwers = G.enemies.filter(e => !e.dead && e.behavior === 'thrower').length;
  const bullets = G.projectiles.length;
  if (throwers >= 1 || bullets >= 1) return false;
  const nearCount = G.enemies.filter(e => !e.dead &&
    dist2(e.x, e.y, p.x, p.y) < 150 * 150).length;
  const farthest = nearestEnemy(p.x, p.y, 3000);
  // 貼身型站樁：敵人來了才站（化勁摔、金鐘罩、震腳、千手）
  if (sid === 'counter_stance' || sid === 'iron_bell' || sid === 'quake_pulse' || sid === 'palm_flurry') {
    return nearCount >= 1 && p.hp > p.maxHp * 0.45;
  }
  // 蓄力型站樁：沒威脅才站（寸勁、吐納）
  if (sid === 'focus_strike') {
    return nearCount === 0 && farthest && dist2(farthest.x, farthest.y, p.x, p.y) > 240 * 240 && p.focusStacks < 6;
  }
  if (sid === 'breath_heal') {
    return nearCount === 0 && p.hp < p.maxHp * 0.85;
  }
  return false;
}

function botControl(dt) {
  const p = G.player;
  G.keys = {};
  botDash();
  if (botWantsStill()) return;   // 這一拍選擇站樁：不按方向鍵
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
    // 模擬會挑的玩家：脆的時候優先保命裝，其餘看通用強度
    const p = G.player;
    const squishy = p.hp < p.maxHp * 0.5 || p.maxHp < 90 + G.wave * 4;
    const W = {
      iron_jaw: squishy ? 5 : 3, sand_shinguard: squishy ? 3.5 : 2, anchor_sandal: 1.2,
      blood_headband: 2.6, tiger_claw: 2.8, hundred_knuckle: 3.0, oni_gauntlet: 2.6,
      fist_wrap: 2.4, rebound_belt: 2.4, master_obi: 2.2, bedrock_belt: 2.2,
      shura_mask: 1.8, swift_tabi: 1.6, bell_plate: squishy ? 3 : 1.8,
      drunken_gourd: 1.6, swallow_step: 1.8, training_gi: 2.0, immovable_sash: 1.6,
      gale_elbowguard: 2.0, famed_koshirae: 2.0, snake_legwrap: 1.5,
      thunder_tattoo: 2.0, keen_eyepatch: 2.0, void_palmwrap: 1.4,
    };
    let best = 0, bestScore = -1;
    G.levelChoices.forEach((g, i) => {
      const s = (W[g.id] || 1.5) * (0.85 + rng() * 0.3);
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
            score += 130;   // 招式庫是選項不是必需
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
