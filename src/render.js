/* ============================================================
   Penguin Can Fight — 繪圖層
   美術方向：暗色競技場、粗描邊幾何、平塗無漸層、無 emoji
   ============================================================ */

/* VIEW.w/h 是畫布像素；ww/wh 是實際看得到的世界範圍。
   ZOOM 決定人物在螢幕上多大——這是「肉搏感」的主旋鈕，不是美術細節。 */
const ZOOM = 2.0;
const VIEW = { w: 1280, h: 720, ww: 1280 / ZOOM, wh: 720 / ZOOM };
const INK = '#0d0f14';

let ctx = null, canvas = null;

function initRender() {
  canvas = document.getElementById('game');
  canvas.width = VIEW.w;
  canvas.height = VIEW.h;
  ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amt)));
  g = Math.max(0, Math.min(255, Math.round(g + amt)));
  b = Math.max(0, Math.min(255, Math.round(b + amt)));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/* ---------- 主繪製 ---------- */
/* ---- 道場木地板貼圖 ---- */
let FLOOR_IMG = null, FLOOR_PAT = null;
function ensureFloorPattern() {
  if (typeof Image === 'undefined') return null;
  if (FLOOR_IMG === null) {
    FLOOR_IMG = new Image();
    FLOOR_IMG.src = 'assets/ui/dojo_floor.jpg';
  }
  if (!FLOOR_PAT && FLOOR_IMG.complete && FLOOR_IMG.naturalWidth) {
    try { FLOOR_PAT = ctx.createPattern(FLOOR_IMG, 'repeat'); } catch (e) {}
  }
  return FLOOR_PAT;
}

/* ---- 收刀動畫：0~1 進度，-1＝沒在收刀 ----
   兩個來源：居合鏈的反手收刀段（0.3s）、奧義居合結束的收刀硬直（0.5s） */
function sheatheK(p) {
  if (!p) return -1;
  if (p.iaiPhase && p.iaiPhase.phase === 'sheath') return 1 - Math.max(0, p.iaiPhase.t) / 1.0;
  if (p.sheathing > 0) return 1 - p.sheathing / 0.5;
  return -1;
}

function drawSheatheAnim(p) {
  const k = sheatheK(p);
  if (k < 0) return;
  loadWeaponImg('katana');
  const img = WEAPON_IMGS['katana'];
  if (!img) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.face < 0) ctx.scale(-1, 1);
  const kw = 52, kh = kw * (img.height / img.width);
  const hx = -4, hy = 4;   // 腰間鞘口
  if (k < 0.22) {
    // 第一拍：反手甩刀——刀在身前快速翻轉 180°
    const f = k / 0.22;
    const ee = 1 - (1 - f) * (1 - f);   // easeOut，甩得快收得穩
    ctx.translate(hx + 12, hy - 8);
    ctx.rotate(-0.9 + ee * (Math.PI + 0.9));
    ctx.drawImage(img, -6, -kh / 2, kw, kh);
  } else {
    // 第二拍：水平收刀——刀尖先進鞘，露在外面的越來越短
    const f = (k - 0.22) / 0.78;
    const vis = Math.max(0.06, 1 - f);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(Math.PI);   // 反握、刀尖指向背後
    ctx.drawImage(img, 0, 0, img.width * vis, img.height, 0, -kh / 2, kw * vis, kh);
    ctx.restore();
    // 鞘口摩擦的白光
    ctx.globalAlpha = 0.35 + 0.55 * Math.sin(f * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(hx - 2, hy - 6, 3, 12);
  }
  ctx.restore();
}

function drawGame() {
  if (!ctx) return;
  ctx.save();
  ctx.fillStyle = '#12141a';
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  let sx = 0, sy = 0;
  if (G.screenShake > 0) {
    sx = rnd(-G.screenShake, G.screenShake) * 0.5;
    sy = rnd(-G.screenShake, G.screenShake) * 0.5;
  }
  ctx.translate(sx, sy);
  ctx.scale(ZOOM, ZOOM);
  ctx.translate(-Math.round(G.cam.x), -Math.round(G.cam.y));

  drawArena();
  drawPickups();
  drawFxUnder();
  if (G.player) drawWeaponsBehind();
  drawEnemies();
  if (G.player) drawPlayer();
  if (G.player) drawSheatheAnim(G.player);
  if (G.player) drawWeaponsFront();
  if (G.player) drawStrikes();
  drawProjectiles();
  drawFxOver();
  drawDamageNums();

  ctx.restore();
  drawHud();
}

/* ---------- 場地 ---------- */
function drawArena() {
  const x0 = Math.max(0, Math.floor(G.cam.x / 60) * 60);
  const y0 = Math.max(0, Math.floor(G.cam.y / 60) * 60);
  const floorPat = ensureFloorPattern();
  if (floorPat) {
    ctx.fillStyle = floorPat;
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
  } else {
    ctx.fillStyle = '#191c23';
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
    ctx.strokeStyle = '#20242d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = x0; x <= Math.min(ARENA.w, G.cam.x + VIEW.ww); x += 60) {
      ctx.moveTo(x, 0); ctx.lineTo(x, ARENA.h);
    }
    for (let y = y0; y <= Math.min(ARENA.h, G.cam.y + VIEW.wh); y += 60) {
      ctx.moveTo(0, y); ctx.lineTo(ARENA.w, y);
    }
    ctx.stroke();
  }

  // 場中圓：漆在木地板上的道場圈
  ctx.strokeStyle = floorPat ? 'rgba(46,30,16,0.55)' : '#242935';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(ARENA.w / 2, ARENA.h / 2, 210, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(ARENA.w / 2, ARENA.h / 2, 96, 0, Math.PI * 2);
  ctx.stroke();

  // ---- 場地物件：牆、地刺、冰塊 ----
  for (const wl of G.walls) {
    ctx.fillStyle = '#2b3140';
    ctx.strokeStyle = INK; ctx.lineWidth = 3;
    roundRect(ctx, wl.x, wl.y, wl.w, wl.h, 6);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3c4354';
    roundRect(ctx, wl.x + 3, wl.y + 3, wl.w - 6, Math.max(4, wl.h * 0.3), 4);
    ctx.fill();
  }
  for (const hz of G.hazards) {
    ctx.fillStyle = 'rgba(120,60,80,0.25)';
    ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7a3c50'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hz.x, hz.y, hz.r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#9a5468';
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + Math.sin(hz.x) * 2;
      const sx = hz.x + Math.cos(a) * hz.r * 0.5, sy = hz.y + Math.sin(a) * hz.r * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx - 4, sy + 3); ctx.lineTo(sx, sy - 6); ctx.lineTo(sx + 4, sy + 3);
      ctx.closePath(); ctx.fill();
    }
  }
  for (const ib of G.iceblocks) {
    ctx.fillStyle = 'rgba(191,232,245,0.85)';
    ctx.strokeStyle = '#7ab8d0'; ctx.lineWidth = 3;
    roundRect(ctx, ib.x - ib.r, ib.y - ib.r, ib.r * 2, ib.r * 2, 7);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ib.x - ib.r * 0.4, ib.y - ib.r * 0.5); ctx.lineTo(ib.x + ib.r * 0.1, ib.y + ib.r * 0.3);
    ctx.moveTo(ib.x + ib.r * 0.3, ib.y - ib.r * 0.3); ctx.lineTo(ib.x, ib.y + ib.r * 0.5);
    ctx.stroke();
    if (ib.hp < ib.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(ib.x - ib.r, ib.y - ib.r - 7, ib.r * 2, 3.5);
      ctx.fillStyle = '#7ab8d0';
      ctx.fillRect(ib.x - ib.r, ib.y - ib.r - 7, ib.r * 2 * Math.max(0, ib.hp / ib.maxHp), 3.5);
    }
  }

  // 邊界警戒條
  const T = 16;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ARENA.w, ARENA.h);
  ctx.rect(T, T, ARENA.w - T * 2, ARENA.h - T * 2);
  ctx.clip('evenodd');
  ctx.fillStyle = '#2b3140';
  ctx.fillRect(0, 0, ARENA.w, ARENA.h);
  ctx.strokeStyle = '#3c4354';
  ctx.lineWidth = 10;
  ctx.beginPath();
  for (let i = -ARENA.h; i < ARENA.w + ARENA.h; i += 34) {
    ctx.moveTo(i, 0); ctx.lineTo(i + ARENA.h, ARENA.h);
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, ARENA.w - 4, ARENA.h - 4);
}

/* ---------- 全幀動畫（Brotato 式共用基底） ----------
   一隻基底企鵝的全幀動畫全職業共用；職業差異疊在配件層與特效層。
   幀圖缺席時自動退回程序繪製。
*/
const BASE_FRAMES = { loaded: 0, ready: false };
const FRAME_DEFS = {
  idle: 2, walk: 4, punch: 3, grab: 2, hurt: 2, dash: 2, ko: 1,
  stance: 2,   // 站樁架式（各職業自己的蓄勢語言；缺圖自動退回 idle）
};
const ACC_IMGS = {};   // charId -> Image（頭部配件）
const FX_IMGS = {};    // fx 名 -> Image（招式特效貼圖，黑底發光）

function loadBaseFrames() {
  if (BASE_FRAMES.ready || BASE_FRAMES.loading || typeof Image === 'undefined') return;
  BASE_FRAMES.loading = true;
  let need = 0;
  for (const k in FRAME_DEFS) need += FRAME_DEFS[k];
  for (const k in FRAME_DEFS) {
    BASE_FRAMES[k] = [];
    for (let i = 1; i <= FRAME_DEFS[k]; i++) {
      const img = new Image();
      img.onload = () => {
        BASE_FRAMES.loaded++;
        // 至少 idle 與 walk 到齊才啟用（其餘動作缺幀時用 idle 頂）
        if (BASE_FRAMES.idle[0] && BASE_FRAMES.idle[0].complete && BASE_FRAMES.loaded >= 6) {
          BASE_FRAMES.ready = true;
        }
      };
      img.onerror = () => {};
      img.src = 'assets/frames/' + k + '_' + i + '.png';
      BASE_FRAMES[k].push(img);
    }
  }
}

/* 三傑專屬幀：整套自己花色的動畫（含面罩／髮髻／道帶畫進幀內），
   到貨自動覆蓋共用基底、頭部配件自動退場——遊戲內造型從此貼近立繪 */
const CHAR_FRAMES = {};
function loadCharFrames(charId) {
  if (CHAR_FRAMES[charId] || typeof Image === 'undefined') return;
  const set = { loaded: 0, ready: false };
  CHAR_FRAMES[charId] = set;
  for (const k in FRAME_DEFS) {
    set[k] = [];
    for (let i = 1; i <= FRAME_DEFS[k]; i++) {
      const img = new Image();
      img.onload = () => {
        set.loaded++;
        if (set.loaded >= 6) set.ready = true;
      };
      img.onerror = () => {};
      img.src = 'assets/frames_' + charId + '/' + k + '_' + i + '.png';
      set[k].push(img);
    }
  }
}

function loadAccessory(charId) {
  if (ACC_IMGS[charId] !== undefined || typeof Image === 'undefined') return;
  const img = new Image();
  ACC_IMGS[charId] = null;
  img.onload = () => { ACC_IMGS[charId] = img; };
  img.src = 'assets/acc/' + charId + '.png';
}

function loadFx(name) {
  if (FX_IMGS[name] !== undefined || typeof Image === 'undefined') return;
  const img = new Image();
  FX_IMGS[name] = null;
  img.onload = () => { FX_IMGS[name] = img; };
  img.src = 'assets/fx/' + name + '.png';
}

/* 依玩家當下狀態選幀（專屬幀優先，缺幀退回共用基底） */
function pickFrame(p) {
  const t = G.time;
  const cf = CHAR_FRAMES[G.char.id];
  const src = (cf && cf.ready) ? cf : BASE_FRAMES;
  const ok = (S, k, i) => S[k] && S[k][i] && S[k][i].complete && S[k][i].naturalWidth > 0;
  function pick(k, i) {
    if (ok(src, k, i)) return src[k][i];
    if (ok(BASE_FRAMES, k, i)) return BASE_FRAMES[k][i];
    return ok(BASE_FRAMES, 'idle', 0) ? BASE_FRAMES.idle[0] : null;
  }
  if (p.dead) return pick('ko', 0);
  if (p.hurtT > 0) return pick('hurt', p.hurtT > 0.15 ? 0 : 1);
  if (p.dashState) {
    if (p.dashState.id === 'clothesline') return pick('dash', 1);   // 蹲低前傾＋程式彈跳＝奔跑
    return pick('dash', Math.floor(t * 10) % 2);
  }
  if (p.grabState) return pick('grab', p.grabState.mode === 'hold' && p.stillHold > 0.2 ? 1 : 0);
  if (p.pose && p.pose.prio >= 0 && p.pose.type !== 'stomp') {
    // 打擊的時間天生不對稱：25% 預備、20% 接觸（hitstop 會凍住這格）、55% 跟隨。
    // 三幀均分是「手刀讀不出來」的另一半原因。
    const k = Math.min(0.999, p.pose.t / p.pose.dur);
    return pick('punch', k < 0.25 ? 0 : (k < 0.45 ? 1 : 2));
  }
  if (p.moveTime > 0.05) return pick('walk', Math.floor((p.walkAnim / Math.PI) * 2) % 4);
  // 站樁蓄力：專屬架式幀、越接近觸發拍得越急——「站著就有魔法」的解方
  if (stillActive() && p.stillT > 0.5) {
    const def = MOVE_MAP[p.moves.still];
    let prog = 0;
    if (p.focusStacks > 0 && def && def.max) prog = p.focusStacks / def.max;
    else if (def && def.interval) prog = Math.min(1, p.stillTechTimer / def.interval);
    if (prog >= 1 && p.focusStacks > 0) return pick('stance', 1);   // 勁滿定格：上膛了
    const period = 0.3 - 0.16 * prog;
    return pick('stance', Math.floor(t / period) % 2);
  }
  return pick('idle', Math.floor(t * 1.6) % 2);
}

/* 全幀模式的玩家繪製：幀圖＋配件＋既有狀態特效（呼叫端已 translate 到玩家位置） */
const FRAME_H = 46;   // 幀在世界座標的顯示高度
function drawPlayerFramed(p, c) {
  const img = pickFrame(p);
  if (!img) return false;
  const w = FRAME_H * (img.width / img.height);
  ctx.save();
  if (p.face < 0) ctx.scale(-1, 1);
  const vAim = p.aimAng !== undefined ? Math.sin(p.aimAng) : 0;
  if (vAim) { ctx.rotate(vAim * 0.2); ctx.scale(1, 1 - 0.08 * Math.abs(vAim)); }
  // 站樁蓄勢的身體語言（新幀到位前的程式版）：下沉、前傾、深呼吸、出力微顫
  const stillK = Math.max(0, Math.min(1, (p.stillT || 0) / 0.5));
  if (stillK > 0 && !p.dashState && !p.grabState) {
    const breathe = Math.sin(G.time * Math.PI * 1.8) * 0.022 * stillK;
    ctx.translate(Math.sin(G.time * Math.PI * 22) * 0.35 * stillK, FRAME_H * 0.05 * stillK);
    ctx.rotate(-0.05 * stillK);
    ctx.scale(1 + 0.045 * stillK, 1 - 0.06 * stillK + breathe);
    if (p.stancePopT > 0) {
      const pk = p.stancePopT / 0.08;
      ctx.scale(1 + 0.1 * pk, 1 - 0.06 * pk);
    }
  }
  // 飛奔金臂勾的奔跑循環：上下彈跳＋前傾搖擺——單幀也要看得出在跑
  if (p.dashState && p.dashState.id === 'clothesline') {
    const runT = (p.dashState.dur0 || 0.3) - p.dashState.t;
    const bob = Math.sin(runT * Math.PI * 2 * 6.5);
    ctx.translate(0, bob * 2.5);
    ctx.rotate(0.2 + bob * 0.035);
  }
  if (p.iframe > 0 && Math.floor(G.time * 20) % 2 === 0) ctx.filter = 'brightness(2.2)';
  ctx.drawImage(img, -w / 2, -FRAME_H * 0.62, w, FRAME_H);
  // 配件：疊在頭部（基底幀構圖固定，錨點統一）
  // 武士的腰間刀鞘（專屬幀已畫進去就不疊）
  const cfK = CHAR_FRAMES[c.id];
  if (c.id === 'kenshi' && !(cfK && cfK.ready)) {
    loadWeaponImg('sheath');
    const sh = WEAPON_IMGS['sheath'];
    if (sh) {
      const sw2 = FRAME_H * 0.62;
      const sh2 = sw2 * (sh.height / sh.width);
      ctx.save();
      ctx.translate(-FRAME_H * 0.08, FRAME_H * 0.06);
      ctx.rotate(0.5);
      ctx.drawImage(sh, -sw2 * 0.8, -sh2 / 2, sw2, sh2);
      ctx.restore();
    }
  }
  const cf = CHAR_FRAMES[c.id];
  const acc = (cf && cf.ready) ? null : ACC_IMGS[c.id];   // 專屬幀已含配件，不再疊
  if (acc) {
    const off = c.id === 'wrestler'
      ? { s: 0.78, dx: 0.05, dy: 0.10 }   // 面罩要戴在臉上，不是頂在頭上
      : { s: 0.62, dx: 0.06, dy: -0.0 };
    const aw = FRAME_H * off.s;
    const ah = aw * (acc.height / acc.width);
    ctx.drawImage(acc, -aw / 2 + FRAME_H * off.dx, -FRAME_H * 0.62 + FRAME_H * off.dy - ah * 0.18, aw, ah);
  }
  ctx.filter = 'none';
  ctx.restore();
  return true;
}

/* ---------- 部件骨架（備援層） ----------
   部件圖（body/head/wing/foot/extra）掛在程式骨架的關節上，
   動作全部由既有的 pose 系統驅動——換皮不換動作。
   部件缺席時自動退回向量繪製，量產期不破圖。
*/
const PARTS = {};          // charId -> { body: Image|null, head, wing, foot, extra, ready }
const PART_NAMES = ['body', 'head', 'wing', 'foot', 'extra'];
/* 部件錨點與尺寸（世界單位）：全企鵝共用——規格書強制同構圖，所以一張表打天下。
   size=部件在遊戲內的顯示寬度；ax/ay=旋轉錨點在圖內的相對位置(0~1) */
const PART_SPEC = {
  body: { size: 30, ax: 0.5, ay: 0.5 },
  head: { size: 34, ax: 0.5, ay: 0.62 },   // 錨在頸部
  wing: { size: 17, ax: 0.5, ay: 0.14 },   // 錨在翅根
  foot: { size: 11, ax: 0.5, ay: 0.2 },    // 錨在腳踝
  extra: { size: 18, ax: 0.5, ay: 0.5 },
};

function loadParts(charId) {
  if (PARTS[charId] || typeof Image === 'undefined') return;
  const set = { ready: false, count: 0 };
  PARTS[charId] = set;
  PART_NAMES.forEach(name => {
    const img = new Image();
    img.onload = () => {
      set[name] = img;
      set.count++;
      // body/head/wing/foot 四件到齊就啟用部件模式（extra 選配）
      set.ready = ['body', 'head', 'wing', 'foot'].every(n => set[n]);
    };
    img.onerror = () => { set[name] = null; };
    img.src = 'assets/parts/' + charId + '/' + name + '.png';
  });
}

function drawPart(c, set, name, x, y, rot, opts) {
  const img = set[name];
  if (!img) return;
  const spec = PART_SPEC[name];
  const w = spec.size * ((opts && opts.scale) || 1);
  const h = w * (img.height / img.width);
  c.save();
  c.translate(x, y);
  c.rotate(rot || 0);
  if (opts && opts.flip) c.scale(-1, 1);
  c.drawImage(img, -w * spec.ax, -h * spec.ay, w, h);
  c.restore();
}

/* 部件骨架版格鬥家：沿用 STANCES 與 attackPose 的角度輸出 */
function drawFighterParts(c, charDef, set, opts) {
  const st = STANCES[charDef.id] || STANCES.boxer;
  const t = opts.time || 0;
  const face = opts.face || 1;
  const walk = opts.walk || 0;
  const pose = opts.pose ? attackPose(opts.pose) : null;

  const crouch = st.crouch + (pose && (pose.kick || pose.knee) ? 1.5 : 0);
  const bob = Math.sin(t * 3.1) * st.bounce * 0.9 + Math.sin(walk) * 2.0;
  const lean = (st.lean + (pose ? (pose.lean || 0) : 0)) * face + Math.sin(walk) * 0.05;
  const hipY = -8 + crouch * 0.5;

  c.save();
  c.rotate(lean);
  c.translate(0, bob * 0.4);
  if (opts.flash) c.filter = 'brightness(2.2)';
  const fw = face < 0;

  // 腳（後→前）：走路擺動或踢擊
  const legSw = Math.sin(walk) * 0.5;
  let footFrontRot = legSw, footBackRot = -legSw;
  if (pose && pose.kick) footFrontRot = -1.5 * pose.kick;
  if (pose && pose.knee) footFrontRot = -1.9 * pose.knee;
  drawPart(c, set, 'foot', -4 * face, hipY + 12, footBackRot * face, { flip: fw });
  // 後翅
  let bArmRot = (st.bArm[0] - 1.2) * 0.7;
  if (pose && pose.bArm) bArmRot = (pose.bArm[0] - 1.2) * 0.9;
  if (st.cloud) bArmRot = Math.sin(t * 1.6 + Math.PI * 0.9) * 0.55;
  drawPart(c, set, 'wing', -7.5 * face, hipY - 4, (bArmRot + 0.25) * face, { flip: !fw });
  // 軀幹
  drawPart(c, set, 'body', 0, hipY, 0, {});
  // 前腳
  drawPart(c, set, 'foot', 4 * face, hipY + 12, footFrontRot * face, { flip: fw });
  // 頭（點頭與出拳前傾）
  const headBob = (pose && pose.punch ? -1.2 : 0) + Math.sin(t * 3.1) * 0.6;
  drawPart(c, set, 'head', 1.5 * face, hipY - 13 + headBob, lean * 0.4, { flip: fw });
  // 前翅（主攻擊臂）
  let fArmRot = (st.fArm[0] - 1.2) * 0.7;
  if (pose && pose.fArm) fArmRot = (pose.fArm[0] - 1.6) * 1.1;
  if (st.cloud) fArmRot = Math.sin(t * 1.6) * 0.55;
  drawPart(c, set, 'wing', 7.5 * face, hipY - 4, (fArmRot - 0.25) * face, { flip: fw });
  // 配件（武器類跟著前翅角度）
  if (set.extra) {
    drawPart(c, set, 'extra', 10 * face, hipY - 2, fArmRot * face * 0.8, { flip: fw });
  }
  if (opts.flash) c.filter = 'none';
  c.restore();
}

/* ---------- 格鬥家骨架 ----------
   每個職業有自己的站架（idle 姿勢），出招時蓋上出招姿勢。
   角度定義：手臂從肩膀出發，0＝垂直向下，正值＝朝面向方向抬起。
   戰鬥中的玩家與選角畫面的立繪共用同一套繪製，職業辨識度才會一致。
*/
const STANCES = {
  //            前臂上臂角度(上segment,下segment)  後臂         蹲低  前傾   節奏感
  boxer:     { fArm: [2.4, 2.6], bArm: [2.2, 2.8], crouch: 2, lean: 0.06, bounce: 2.2 },
  wrestler:  { fArm: [1.4, 1.1], bArm: [1.4, 1.1], crouch: 4, lean: 0.16, bounce: 0.8, spread: true },
  karate:    { fArm: [1.7, 1.4], bArm: [0.5, 1.6], crouch: 2, lean: 0.02, bounce: 0.5 },
  kenshi:    { fArm: [1.1, 1.5], bArm: [1.1, 1.5], crouch: 1, lean: 0.04, bounce: 0.3, together: true },
  judo:      { fArm: [1.6, 0.9], bArm: [0.9, 0.9], crouch: 3, lean: 0.10, bounce: 0.6 },
  sumo:      { fArm: [0.9, 0.5], bArm: [0.9, 0.5], crouch: 6, lean: 0.12, bounce: 0.4, spread: true },
  muaythai:  { fArm: [2.6, 2.4], bArm: [2.3, 2.6], crouch: 1, lean: 0.03, bounce: 1.6 },
  monk:      { fArm: [1.9, 2.6], bArm: [1.9, 2.6], crouch: 2, lean: 0.00, bounce: 0.4, together: true },
  ninja:     { fArm: [1.8, 1.2], bArm: [0.4, 0.8], crouch: 5, lean: 0.22, bounce: 1.0 },
  thug:      { fArm: [0.5, 0.3], bArm: [0.5, 0.3], crouch: 1, lean: -0.06, bounce: 0.8 },
  nunchaku:  { fArm: [2.0, 1.6], bArm: [0.6, 2.2], crouch: 2, lean: 0.05, bounce: 1.4 },
  ironhead:  { fArm: [1.2, 0.8], bArm: [1.2, 0.8], crouch: 3, lean: 0.30, bounce: 0.5 },
  taichi:    { fArm: [1.5, 1.8], bArm: [1.0, 1.4], crouch: 3, lean: 0.02, bounce: 0.2, cloud: true },
  berserker: { fArm: [0.7, 0.4], bArm: [0.7, 0.4], crouch: 2, lean: 0.20, bounce: 1.8 },
  strongman: { fArm: [1.0, 0.6], bArm: [1.0, 0.6], crouch: 2, lean: 0.05, bounce: 0.4, spread: true },
  aikido:    { fArm: [1.3, 1.6], bArm: [1.3, 1.6], crouch: 2, lean: -0.02, bounce: 0.3, together: true },
};

function easeOutBack(k) { const c1 = 1.7; return 1 + (c1 + 1) * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); }

/* 出招姿勢：回傳兩隻手臂與腿的覆寫角度（都以面向方向為正） */
function attackPose(pose) {
  const k = Math.min(1, pose.t / pose.dur);
  const snap = k < 0.35 ? easeOutBack(k / 0.35) : 1 - (k - 0.35) / 0.65 * 0.3;
  switch (pose.type) {
    case 'jab':   return { fArm: [1.55 * snap + 0.6, 0.02], punch: snap };
    case 'chop':  return { fArm: [2.6 - snap * 1.3, 0.3], chopSwing: snap };
    case 'palm':  return { fArm: [1.5 * snap + 0.5, 0.1], bArm: [1.5 * snap + 0.5, 0.1], punch: snap };
    case 'elbow': return { fArm: [1.9 * snap, 2.9], lean: 0.25 * snap };
    case 'head':  return { fArm: [0.2, 0.1], bArm: [0.2, 0.1], lean: -0.35 + 1.15 * snap };   // 先仰後撞
    case 'hold':  return { fArm: [1.05, 0.35], bArm: [1.05, 0.35], lean: 0.12 };
    case 'lariat': return { fArm: [1.5, 0.0], lean: 0.4 * snap };
    case 'kick':  return { kick: snap };
    case 'knee':  return { knee: snap };
    case 'swing': return { fArm: [1.45 * snap + 0.5, 0.25], punch: snap * 0.7 };
    case 'dash':  return { fArm: [0.3, 0.2], bArm: [0.3, 0.2], lean: 0.5 * snap };
    case 'iaidraw': return { fArm: [1.2, 2.6], bArm: [0.4, 0.3], lean: -0.18 };
    case 'stomp': return { knee: snap, fArm: [0.6, 0.4], bArm: [0.6, 0.4] };
    default: return {};
  }
}

/* 共用的格鬥家繪製：ctx 已 translate 到腳底中心，face=1 朝右 */
function drawFighter(c, charDef, opts) {
  const st = STANCES[charDef.id] || STANCES.boxer;
  const t = opts.time || 0;
  const face = opts.face || 1;
  const walk = opts.walk || 0;
  const pose = opts.pose ? attackPose(opts.pose) : null;
  const skin = opts.flash ? '#ffffff' : charDef.skin;
  const cloth = opts.flash ? '#ffffff' : charDef.color;

  const crouch = st.crouch + (pose && (pose.kick || pose.knee) ? 1.5 : 0);
  const bob = Math.sin(t * 3.1) * st.bounce * 0.9 + Math.sin(walk) * 2.0;
  const lean = (st.lean + (pose ? (pose.lean || 0) : 0)) * face + Math.sin(walk) * 0.05;
  const hipY = -9 + crouch * 0.55;

  c.save();
  c.rotate(lean);
  c.translate(0, bob * 0.4);

  // ---- 腿（兩節：髖→膝→腳）——Q 版短腿 ----
  const legSw = Math.sin(walk) * 0.55;
  const legLen = 6 - crouch * 0.3;
  c.strokeStyle = INK; c.lineWidth = 5; c.lineCap = 'round';
  function leg(side, liftAng) {
    const hx = side * 4 * (st.spread ? 1.6 : 1);
    const bend = 0.35 + crouch * 0.09;
    let a1 = bend * side * 0.3 + liftAng;
    if (pose && pose.kick && side === face) a1 = -1.5 * pose.kick * face + 0.2;
    if (pose && pose.knee && side === face) a1 = -1.9 * pose.knee * face;
    const kx = hx + Math.sin(a1) * legLen * face;
    const ky = hipY + 9 + Math.cos(a1) * legLen;
    let a2 = a1 * 0.4;
    if (pose && pose.kick && side === face) a2 = a1;   // 踢直
    const fx2 = kx + Math.sin(a2) * legLen * face;
    const fy2 = ky + Math.cos(a2) * legLen;
    c.beginPath(); c.moveTo(hx, hipY + 9); c.lineTo(kx, ky); c.lineTo(fx2, fy2); c.stroke();
  }
  leg(-1, -legSw);
  leg(1, legSw);

  // ---- 尾巴（畫在軀幹後面）----
  // 尾巴是貓的情緒指針：太極緩慢大擺、狂人高速抽動、忍者壓低
  const tailSpd = st.cloud ? 1.2 : (charDef.id === 'berserker' ? 9 : 2.6);
  const tailAmp = st.cloud ? 0.9 : (charDef.id === 'berserker' ? 0.5 : 0.6);
  const tw = Math.sin(t * tailSpd) * tailAmp;
  const tbx = -face * 9, tby = hipY + 5;
  c.strokeStyle = opts.flash ? '#ffffff' : skin;
  c.lineWidth = 3.6; c.lineCap = 'round';
  c.beginPath();
  c.moveTo(tbx, tby);
  c.quadraticCurveTo(
    tbx - face * 8, tby - 3 + tw * 5,
    tbx - face * 11, tby - 10 + tw * 8 - (charDef.id === 'ninja' ? -8 : 0));
  c.stroke();
  c.strokeStyle = INK; c.lineWidth = 1.2;
  c.beginPath();
  c.moveTo(tbx, tby);
  c.quadraticCurveTo(
    tbx - face * 8, tby - 3 + tw * 5,
    tbx - face * 11, tby - 10 + tw * 8 - (charDef.id === 'ninja' ? -8 : 0));
  c.stroke();

  // ---- 軀幹（Q 版圓短身） ----
  c.fillStyle = cloth;
  c.strokeStyle = INK; c.lineWidth = 3;
  roundRect(c, -9, hipY - 7, 18, 16, 6);
  c.fill(); c.stroke();
  c.fillStyle = opts.flash ? '#ffffff' : shade(charDef.color, -45);
  c.fillRect(-9, hipY + 5, 18, 3.6);

  // ---- 手臂（兩節：肩→肘→拳）——短粗 ----
  const armLen = 6.2;
  const idleSway = Math.sin(t * 3.1) * 0.12;
  function arm(front) {
    const side = front ? face : -face;
    const sx = side * 7.5;
    const sy = hipY - 6;
    let spec = front ? st.fArm : st.bArm;
    let a1 = spec[0], a2 = spec[1];
    // 太極：雲手，雙手緩慢畫圓
    if (st.cloud) {
      const ph = front ? 0 : Math.PI * 0.9;
      a1 = 1.5 + Math.sin(t * 1.6 + ph) * 0.75;
      a2 = 1.6 + Math.cos(t * 1.6 + ph) * 0.55;
    } else { a1 += idleSway; a2 -= idleSway; }
    // 出招覆寫（前手為主，開掌雙推連後手一起）
    if (pose) {
      if (front && pose.fArm) { a1 = pose.fArm[0]; a2 = pose.fArm[1]; }
      if (!front && pose.bArm) { a1 = pose.bArm[0]; a2 = pose.bArm[1]; }
    }
    // 手臂朝面向側伸出：把「抬起角」轉成向量
    const dir = front ? face : face;   // 兩臂都往面向側，用角度大小區分前後
    const ex = sx + Math.sin(a1) * armLen * dir;
    const ey = sy + Math.cos(a1) * armLen;
    const hx2 = ex + Math.sin(a2) * armLen * dir;
    const hy2 = ey + Math.cos(a2) * armLen;
    c.strokeStyle = opts.flash ? '#ffffff' : skin;
    c.lineWidth = 4.5;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.lineTo(hx2, hy2); c.stroke();
    // 拳頭
    c.fillStyle = opts.flash ? '#ffffff' : skin;
    c.strokeStyle = INK; c.lineWidth = 1.6;
    c.beginPath(); c.arc(hx2, hy2, 2.8, 0, Math.PI * 2); c.fill(); c.stroke();
  }
  arm(false);   // 後臂先畫（被身體壓住的層次）

  // ---- 貓頭（Q 版大頭：頭比身體大，可愛的核心） ----
  const headY = hipY - 16 + (pose && pose.punch ? -0.6 : 0);
  const HR = 12;   // 頭半徑：跟軀幹同寬級距，頭身比 1:1
  const id = charDef.id;

  // 耳朵（畫在頭圓前面才不會被蓋掉輪廓）
  function ear(side) {
    c.fillStyle = skin;
    c.strokeStyle = INK; c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(side * 3.5, headY - HR + 2);
    c.lineTo(side * 11, headY - HR - 7);
    c.lineTo(side * 11.5, headY - HR + 5.5);
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = opts.flash ? '#ffffff' : '#e8a0a8';
    c.beginPath();
    c.moveTo(side * 6.2, headY - HR + 2.2);
    c.lineTo(side * 10, headY - HR - 3.5);
    c.lineTo(side * 10.2, headY - HR + 3.6);
    c.closePath(); c.fill();
  }
  ear(-1); ear(1);

  c.fillStyle = skin;
  c.strokeStyle = INK; c.lineWidth = 3;
  c.beginPath();
  c.ellipse(0, headY, HR + 1.5, HR, 0, 0, Math.PI * 2);
  c.fill(); c.stroke();

  // 大眼睛：白底＋大瞳＋高光（低眼位＝幼態）
  function eye(ex) {
    c.fillStyle = '#ffffff';
    c.beginPath(); c.ellipse(ex, headY + 1.5, 3.4, 4.1, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#3a2a20';
    c.beginPath(); c.ellipse(ex + face * 0.5, headY + 2, 2.5, 3.2, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff';
    c.beginPath(); c.arc(ex + face * 0.5 - 1, headY + 0.8, 1.1, 0, Math.PI * 2); c.fill();
  }
  const eyeGap = 5.2;
  if (id !== 'ninja') { eye(face * 1.5 - eyeGap); eye(face * 1.5 + eyeGap); }

  // 吻部與鼻子
  c.fillStyle = opts.flash ? '#ffffff' : shade(charDef.skin, 30);
  c.beginPath(); c.ellipse(face * 1.5, headY + 6.5, 4.6, 3.2, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#c05a6a';
  c.beginPath();
  c.moveTo(face * 1.5 - 1.6, headY + 5.2);
  c.lineTo(face * 1.5 + 1.6, headY + 5.2);
  c.lineTo(face * 1.5, headY + 6.9);
  c.closePath(); c.fill();
  // 腮紅
  c.fillStyle = 'rgba(232,120,130,0.4)';
  c.beginPath(); c.ellipse(-HR + 3.5, headY + 5, 2.4, 1.5, 0, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.ellipse(HR - 3.5, headY + 5, 2.4, 1.5, 0, 0, Math.PI * 2); c.fill();

  // 鬍鬚
  c.strokeStyle = 'rgba(255,255,255,0.85)';
  c.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    c.beginPath();
    c.moveTo(face * 7, headY + 4.5 + i * 1.4);
    c.lineTo(face * 16, headY + 1.5 + i * 3);
    c.stroke();
    c.beginPath();
    c.moveTo(-face * 5, headY + 4.5 + i * 1.4);
    c.lineTo(-face * 13, headY + 2.5 + i * 2.6);
    c.stroke();
  }

  // 頭部配件（流派辨識，跟著大頭比例）
  c.fillStyle = INK;
  if (id === 'ninja') {
    c.fillStyle = '#1e222c'; c.fillRect(-HR - 1, headY - 1.5, (HR + 1) * 2, 7);   // 蒙面
    c.fillStyle = '#ffe08a';
    c.fillRect(face * 1.5 - eyeGap - 1.6, headY + 0.6, 3.2, 2.4);
    c.fillRect(face * 1.5 + eyeGap - 1.6, headY + 0.6, 3.2, 2.4);
  }
  else if (id === 'boxer' || id === 'muaythai') {
    c.fillStyle = id === 'boxer' ? '#c03a3a' : '#3a5aa0';
    c.fillRect(-HR - 1, headY - 8.5, (HR + 1) * 2, 4.4);
  }
  else if (id === 'sumo') { c.fillStyle = INK; c.beginPath(); c.arc(0, headY - HR - 1.5, 4.4, 0, Math.PI * 2); c.fill(); }
  else if (id === 'monk') { c.fillStyle = '#c9803c'; c.fillRect(-2.5, headY - HR - 2, 5, 3.6); }
  else if (id === 'thug') { c.fillStyle = '#3a5a2a'; c.fillRect(-HR - 1, headY - 9.5, (HR + 1) * 2, 4.4); }
  else if (id === 'aikido') { c.fillStyle = '#2b3a4a'; c.fillRect(-HR + 1, headY + 9.5, (HR - 1) * 2, 2.8); }
  if (id === 'karate' || id === 'judo' || id === 'kenshi') {
    c.strokeStyle = '#e8e4dc'; c.lineWidth = 3.6;
    c.beginPath(); c.moveTo(-HR - 0.5, headY - 6.5); c.lineTo(HR + 0.5, headY - 6.5); c.stroke();
    c.strokeStyle = INK;
  }
  if (id === 'ironhead') {
    c.strokeStyle = '#c9cdd6'; c.lineWidth = 3.6;
    c.beginPath(); c.arc(0, headY - 1, HR + 1, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
    c.strokeStyle = INK;
  }
  if (id === 'berserker') {   // 狂貓：炸毛
    c.strokeStyle = INK; c.lineWidth = 1.8;
    for (let i = -2; i <= 2; i++) {
      c.beginPath(); c.moveTo(i * 4.2, headY - HR + 0.5); c.lineTo(i * 5, headY - HR - 4); c.stroke();
    }
  }

  arm(true);   // 前臂最後畫（在最上層，出招看得最清楚）

  // 手刀軌跡
  if (pose && pose.chopSwing) {
    c.strokeStyle = '#ffffff';
    c.globalAlpha = (1 - pose.chopSwing) * 0.6;
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(face * 6, hipY - 8, 13, -1.3 * face, (pose.chopSwing * 1.8 - 1.3) * face, face < 0);
    c.stroke();
    c.globalAlpha = 1;
  }
  c.restore();
}

/* ---------- 玩家 ---------- */
function drawPlayer() {
  const p = G.player;
  const c = G.char;
  const air = p.airSlam ? (p.airSlam.h || 0) : 0;
  ctx.save();
  ctx.translate(p.x, p.y);

  // 影子（滯空時縮小變淡，落點圈告訴玩家會砸在哪）
  const shK = air > 0 ? Math.max(0.45, 1 - air / 90) : 1;
  ctx.fillStyle = 'rgba(0,0,0,' + (0.35 * shK) + ')';
  ctx.beginPath();
  ctx.ellipse(0, p.r * 0.85, p.r * 0.9 * shK, p.r * 0.34 * shK, 0, 0, Math.PI * 2);
  ctx.fill();
  if (air > 0) {
    const pulse = 0.55 + Math.sin(G.time * 14) * 0.25;
    ctx.strokeStyle = 'rgba(224,145,60,' + pulse + ')';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(0, p.r * 0.85, 150 * 0.34, 150 * 0.13, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(0, p.r * 0.85, 150 * 0.5, 150 * 0.19, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.translate(0, -air);

  // 頭上連段提示：目前拍列＋奧義就緒閃光——玩家不用看角落也知道連段打到哪
  {
    const rdyAll = typeof comboReady === 'function' ? comboReady() : [];
    const rdy = rdyAll.filter(r => r.cd <= 0);
    const bl = p.beatLog;
    const y0 = -34;
    if (rdy.length) {
      // 連段就緒：直接告訴玩家「做什麼動作＝出什麼招」
      const ACT = { S: '站', M: '走', D: 'Space' };
      const txt = rdy.map(r => ACT[r.act] + '→' + r.name).join('　');
      ctx.font = 'bold 9px ' + FONT;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = INK;
      ctx.globalAlpha = 0.75 + Math.sin(G.time * 12) * 0.25;
      ctx.strokeText(txt, 0, y0 - 3);
      ctx.fillStyle = rdy.some(r => r.sig) ? '#ffd44a' : '#e8e4dc';
      ctx.fillText(txt, 0, y0 - 3);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    } else if (bl.length) {
      const bw = 9, gap = 2;
      const total = 3 * bw + 2 * gap;
      for (let i = 0; i < 3; i++) {
        const bx = -total / 2 + i * (bw + gap);
        const beat = bl[i];
        // 剛記到的那一拍會彈一下——節奏要看得到
        const isLast = i === bl.length - 1;
        const pop = isLast && p.beatPopT > 0 ? 1 + (p.beatPopT / 0.22) * 0.65 : 1;
        const w2 = bw * pop, h2 = 8 * pop;
        ctx.fillStyle = 'rgba(10,12,16,0.7)';
        ctx.fillRect(bx + (bw - w2) / 2, y0 - 8 - (h2 - 8) / 2, w2, h2);
        if (beat) {
          ctx.fillStyle = beat === 'S' ? '#e8964a' : (beat === 'D' ? '#ffd44a' : '#8fd4e0');
          ctx.fillRect(bx + (bw - w2) / 2 + 1, y0 - 7 - (h2 - 8) / 2, w2 - 2, h2 - 2);
        }
      }
    }
  }

  // 爆發光環
  if (p.burst > 0) {
    ctx.strokeStyle = '#ffd44a';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.55 + Math.sin(G.time * 18) * 0.25;
    ctx.beginPath();
    ctx.arc(0, 0, p.r + 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // 三態招式視覺：站樁生效交給架式幀與蓄力點演，不再畫指示環（總監：看不懂的圈圈不要）
  const stillOn = stillActive();
  const movingOn = movingActive();
  if (stillOn) {
    const sid = p.moves.still;
    if ((sid === 'focus_strike' || sid === 'sanchin') && p.focusStacks > 0) {   // 蓄力層數
      ctx.fillStyle = '#e8964a';
      for (let i = 0; i < p.focusStacks; i++) {
        const a = -Math.PI / 2 + (i - (p.focusStacks - 1) / 2) * 0.5;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * (p.r + 13), Math.sin(a) * (p.r + 13) - 4, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  if (movingOn && p.moves.move === 'phantom_press') {   // 威壓氣場
    ctx.strokeStyle = '#c9576b';
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, p.r + 10, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (movingOn && p.moves.move === 'gale_step') {   // 疾風速度線
    ctx.strokeStyle = '#8fd4e0';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.6;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(-p.face * (16 + (G.time * 90) % 8), -6 + i * 7);
      ctx.lineTo(-p.face * (26 + (G.time * 90) % 8), -6 + i * 7);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (p.ougiField > 0) {   // 圓相領域
    ctx.strokeStyle = '#5a8ac9';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.5 + Math.sin(G.time * 12) * 0.25;
    ctx.beginPath(); ctx.arc(0, 0, p.r + 16, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (p.staggerT > 0) {   // 踉蹌：頭上冒星
    ctx.fillStyle = '#e0c341';
    for (let i = 0; i < 3; i++) {
      const a = G.time * 5 + i * 2.1;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 12, -26 + Math.sin(a) * 3, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 全幀動畫模式優先（三傑先行），缺圖退回程序繪製
  loadBaseFrames();
  if (c.id === 'kenshi' || c.id === 'wrestler' || c.id === 'karate') loadCharFrames(c.id);
  loadAccessory(c.id);
  if (!(BASE_FRAMES.ready && drawPlayerFramed(p, c))) {
    const flash = p.iframe > 0 && Math.floor(G.time * 20) % 2 === 0;
    drawFighter(ctx, c, {
      time: G.time, face: p.face, walk: p.walkAnim, flash, pose: p.pose,
    });
  }
  ctx.restore();
}

/* ---------- 武器 ---------- */
function drawWeaponsBehind() { drawWeaponSet(true); }
function drawWeaponsFront() { drawWeaponSet(false); }

function drawWeaponSet(behind) {
  const p = G.player;
  const rangeMul = liveRangeMult();
  p.weapons.forEach((w, i) => {
    const isBehind = Math.sin(w.angle) < 0;
    if (isBehind !== behind) return;
    if (w.id === 'katana' && sheatheK(G.player) >= 0) return;   // 收刀動畫期間刀不在手上
    const reach = w.range * rangeMul;
    const swingP = Math.max(0, w.swing);
    const holdD = 16 + i * 1.5;
    const halfSw = ((w.arc || 60) * Math.PI / 180) / 2;
    const a = swingP > 0 ? w.angle + w.swingDir * ((1 - swingP) * 2 - 1) * halfSw : w.angle;
    ctx.save();
    ctx.translate(p.x + Math.cos(a) * holdD, p.y + Math.sin(a) * holdD);
    ctx.rotate(a);
    drawWeaponShape(ctx, w, reach, swingP);
    ctx.restore();
  });
}

/* 鰭肢貼圖依角色體色染一層：深藍黑的鰭直接貼在白企鵝身上會像別人的手 */
const TINTED_IMGS = {};
function tintedWeaponImg(name, color) {
  const img = WEAPON_IMGS[name];
  if (!img || typeof document === 'undefined') return null;
  const key = name + '|' + color;
  if (TINTED_IMGS[key] !== undefined) return TINTED_IMGS[key];
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const c2 = cv.getContext('2d');
  c2.drawImage(img, 0, 0);
  c2.globalCompositeOperation = 'source-atop';
  c2.globalAlpha = 0.5;
  c2.fillStyle = color;
  c2.fillRect(0, 0, cv.width, cv.height);
  TINTED_IMGS[key] = cv;
  return cv;
}

const WEAPON_IMGS = {};
function loadWeaponImg(name) {
  if (WEAPON_IMGS[name] !== undefined || typeof Image === 'undefined') return;
  const img = new Image();
  WEAPON_IMGS[name] = null;
  img.onload = () => { WEAPON_IMGS[name] = img; };
  img.src = 'assets/weapons/' + name + '.png';
}

const BARE_ICONS = { fist: 1, palm: 1, leg: 1, elbow: 1, head: 1, grab: 1 };
function drawWeaponShape(c, w, reach, swing) {
  if (BARE_ICONS[w.icon]) return;   // 拳腳不畫外掛物件（總監指令），交給角色動畫與特效
  const L = Math.min(reach * 0.55, 46);
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.fillStyle = w.color;
  const push = swing * 8;
  // 打刀專屬貼圖：真正的武士刀
  if (w.id === 'katana') {
    loadWeaponImg('katana');
    const img = WEAPON_IMGS['katana'];
    if (img) {
      const kw = Math.min(reach * 0.62, 56);
      const kh = kw * (img.height / img.width);
      c.drawImage(img, push - 8, -kh / 2, kw, kh);
      return;
    }
  }
  switch (w.icon) {
    case 'fist': {
      // 企鵝握不出人類的拳：整片鰭肢往內收攏，折成一個鈍圓的楔，打擊面是鰭端
      loadWeaponImg('flipper_fist');
      const fi = tintedWeaponImg('flipper_fist', (G.char && G.char.skin) || '#3a4152');
      if (fi) {
        const fw = 26, fh = fw * (fi.height / fi.width);
        c.drawImage(fi, push - 4, -fh / 2, fw, fh);
        break;
      }
      c.beginPath();
      c.moveTo(push - 4, -5);
      c.quadraticCurveTo(push + 9, -7.5, push + 15, -3.5);   // 鰭背隆起
      c.quadraticCurveTo(push + 18.5, 0, push + 15, 3.5);    // 收攏的鰭端
      c.quadraticCurveTo(push + 9, 7.5, push - 4, 5);        // 鰭腹
      c.closePath();
      c.fill(); c.stroke();
      c.fillStyle = shade(w.color, -45);                      // 折起來的那一摺
      c.beginPath();
      c.moveTo(push + 10, -4.5);
      c.quadraticCurveTo(push + 13.5, 0, push + 10, 4.5);
      c.quadraticCurveTo(push + 12.5, 0, push + 10, -4.5);
      c.fill();
      break;
    }
    case 'palm': {
      // 手刀＝同一片鰭完全打平，以薄的那一側朝前劈
      loadWeaponImg('flipper_chop');
      const pi = tintedWeaponImg('flipper_chop', (G.char && G.char.skin) || '#3a4152');
      if (pi) {
        const pw = 30, ph = pw * (pi.height / pi.width);
        c.drawImage(pi, push - 4, -ph / 2, pw, ph);
        break;
      }
      c.beginPath();
      c.moveTo(push - 4, -4.5);
      c.quadraticCurveTo(push + 10, -3.5, push + 20, -1.2);  // 打平的鰭，前端削薄
      c.quadraticCurveTo(push + 22.5, 0, push + 20, 1.2);
      c.quadraticCurveTo(push + 10, 3.5, push - 4, 4.5);
      c.closePath();
      c.fill(); c.stroke();
      c.strokeStyle = shade(w.color, -45); c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(push + 2, -1.6); c.quadraticCurveTo(push + 11, -1.0, push + 18, -0.3);
      c.stroke();
      break;
    }
    case 'leg':
      c.beginPath(); c.moveTo(push, -4); c.lineTo(push + L * 0.5, -3);
      c.lineTo(push + L * 0.55, 5); c.lineTo(push, 5); c.closePath();
      c.fill(); c.stroke();
      break;
    case 'elbow':
      c.beginPath(); c.moveTo(push, -6); c.lineTo(push + 14, 0); c.lineTo(push, 6); c.closePath();
      c.fill(); c.stroke();
      break;
    case 'head':
      c.beginPath(); c.arc(push + 6, 0, 8, 0, Math.PI * 2); c.fill(); c.stroke();
      break;
    case 'grab':
      c.lineWidth = 4; c.strokeStyle = w.color;
      c.beginPath(); c.arc(push + 10, 0, 9, -2.2, 2.2); c.stroke();
      c.strokeStyle = INK; c.lineWidth = 1.5;
      c.beginPath(); c.arc(push + 10, 0, 9, -2.2, 2.2); c.stroke();
      break;
    case 'blade':
      c.beginPath();
      c.moveTo(push, -3); c.lineTo(push + L, -2.5); c.lineTo(push + L + 6, 0);
      c.lineTo(push + L, 2.5); c.lineTo(push, 3); c.closePath();
      c.fill(); c.stroke();
      c.fillStyle = shade(w.color, 60);
      c.fillRect(push + 2, -1, L - 4, 1.2);
      c.fillStyle = '#4a3a2a';
      roundRect(c, push - 10, -3.5, 10, 7, 2); c.fill(); c.stroke();
      break;
    case 'pipe':
      roundRect(c, push, -3, L + 8, 6, 3); c.fill(); c.stroke();
      break;
    case 'nunchaku':
      roundRect(c, push, -3, 14, 6, 2); c.fill(); c.stroke();
      c.strokeStyle = '#9aa4b2'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(push + 14, 0); c.lineTo(push + 20, -6); c.stroke();
      c.strokeStyle = INK; c.lineWidth = 3;
      roundRect(c, push + 20, -9, 12, 6, 2); c.fill(); c.stroke();
      break;
    case 'hammer':
      roundRect(c, push, -2.5, L, 5, 2); c.fillStyle = '#6b5230'; c.fill(); c.stroke();
      c.fillStyle = w.color;
      roundRect(c, push + L - 4, -10, 16, 20, 3); c.fill(); c.stroke();
      break;
    case 'meteor': {
      c.strokeStyle = '#9aa4b2'; c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i < 5; i++) {
        c.moveTo(push + i * 7 + 2, Math.sin(i * 1.7) * 2);
        c.arc(push + i * 7 + 4, Math.sin(i * 1.7) * 2, 2.4, 0, Math.PI * 2);
      }
      c.stroke();
      c.fillStyle = w.color; c.strokeStyle = INK; c.lineWidth = 2.5;
      c.beginPath(); c.arc(push + 40, 0, 7.5, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = shade(w.color, -50);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + 0.4;
        c.beginPath(); c.arc(push + 40 + Math.cos(a) * 6, Math.sin(a) * 6, 1.6, 0, Math.PI * 2); c.fill();
      }
      break;
    }
    case 'saw':
      roundRect(c, push, -4, 16, 8, 2); c.fillStyle = '#4a4f5a'; c.fill(); c.stroke();
      c.fillStyle = w.color;
      c.beginPath();
      const bx = push + 16;
      c.moveTo(bx, -5);
      for (let i = 0; i < 6; i++) { c.lineTo(bx + i * 5 + 2.5, -8); c.lineTo(bx + i * 5 + 5, -5); }
      c.lineTo(bx + 30, 5); c.lineTo(bx, 5); c.closePath();
      c.fill(); c.stroke();
      break;
    default:
      roundRect(c, push, -4, 14, 8, 3); c.fill(); c.stroke();
  }
  // 階級標記
  if (w.tier > 1) {
    c.fillStyle = TIER_COLOR[w.tier];
    for (let i = 0; i < w.tier - 1; i++) {
      c.beginPath(); c.arc(-6, -8 + i * 4, 1.6, 0, Math.PI * 2); c.fill();
    }
  }
}

/* ---------- 敵人（妖怪貼圖模式優先，缺圖退回程序繪製） ---------- */
const ENEMY_IMGS = {};
function loadEnemyImg(key) {
  if (ENEMY_IMGS[key] !== undefined || typeof Image === 'undefined') return;
  const img = new Image();
  ENEMY_IMGS[key] = null;
  img.onload = () => { ENEMY_IMGS[key] = img; };
  img.src = 'assets/enemies/' + key + '.png';
}

function drawEnemies() {
  for (const e of G.enemies) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(0, e.r * 0.82, e.r * 0.85, e.r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // 被金臂勾掛倒：整個人翻著飛（腳離地才叫 clothesline）
    if (e.spin) ctx.rotate(e.spin.a);
    // 妖怪貼圖模式：飄浮＋微透明＝幽靈感
    const imgKey = e.boss ? 'boss_' + e.id : e.id;
    loadEnemyImg(imgKey);
    const eimg = ENEMY_IMGS[imgKey];
    if (eimg) {
      const hover = Math.sin(e.anim * 0.9) * e.r * 0.14;
      const h = e.r * 2.5;
      const w = h * (eimg.width / eimg.height);
      if (e.hitSquash > 0) {
        const k = e.hitSquash / 0.16;
        ctx.scale(1 + 0.28 * k, 1 - 0.28 * k);
      }
      if (e.hitFlash > 0) ctx.filter = 'brightness(2.4)';
      ctx.globalAlpha = 0.94;
      if ((e.face || 1) > 0) ctx.scale(-1, 1);   // 圖預設朝左，往右追時鏡像
      ctx.drawImage(eimg, -w / 2, -h * 0.62 + hover, w, h);
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
      if ((e.face || 1) > 0) ctx.scale(-1, 1);
      // 精英王冠
      if (e.elite) {
        ctx.fillStyle = '#e0c341'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
        ctx.beginPath();
        const cw = e.r * 0.8;
        ctx.moveTo(-cw, -e.r - 6); ctx.lineTo(-cw * 0.5, -e.r - 13); ctx.lineTo(0, -e.r - 6);
        ctx.lineTo(cw * 0.5, -e.r - 13); ctx.lineTo(cw, -e.r - 6); ctx.closePath();
        ctx.fill(); ctx.stroke();
      }
      if (e.stun > 0 && e.stun < 50) {
        ctx.strokeStyle = '#ffd44a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, -e.r - 10, 4, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      // 血條
      if (e.hp < e.maxHp || e.boss || e.elite) {
        const bw = e.boss ? 64 : Math.max(16, e.r * 1.7);
        const bh = e.boss ? 3.5 : 2.4;
        const bx = e.x - bw / 2, by = e.y - e.r - (e.boss ? 15 : 8);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(bx - 0.8, by - 0.8, bw + 1.6, bh + 1.6);
        ctx.fillStyle = e.boss ? '#d9564f' : (e.elite ? '#e0c341' : '#c05050');
        ctx.fillRect(bx, by, bw * Math.max(0, e.hp / e.maxHp), bh);
      }
      continue;
    }

    const flash = e.hitFlash > 0;
    const col = flash ? '#ffffff' : e.color;
    const bob = Math.sin(e.anim) * (e.r * 0.09);
    ctx.translate(0, bob);
    // 受擊壓扁回彈
    if (e.hitSquash > 0) {
      const k = e.hitSquash / 0.16;
      ctx.scale(1 + 0.28 * k, 1 - 0.28 * k);
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(2, e.r * 0.18);
    ctx.fillStyle = col;

    switch (e.behavior) {
      case 'chase':
      case 'splitter':
        if (e.id === 'runner') {
          ctx.beginPath();
          ctx.moveTo(e.r * e.face, 0); ctx.lineTo(-e.r * 0.7 * e.face, -e.r * 0.8);
          ctx.lineTo(-e.r * 0.7 * e.face, e.r * 0.8); ctx.closePath();
        } else if (e.id === 'brute') {
          roundRect(ctx, -e.r, -e.r, e.r * 2, e.r * 2, e.r * 0.3);
        } else if (e.id === 'splitter') {
          ctx.beginPath();
          for (let i = 0; i < 9; i++) {
            const a = i / 9 * Math.PI * 2;
            const rr = e.r * (0.82 + Math.sin(a * 3 + e.anim) * 0.18);
            const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath();
        } else {
          ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2);
        }
        ctx.fill(); ctx.stroke();
        // 野狗幫：垂耳＋吻部，跟貓的立耳做出敵我區隔
        {
          const er = e.r;
          ctx.fillStyle = flash ? '#fff' : shade(e.color, -30);
          ctx.beginPath();
          ctx.moveTo(-er * 0.55, -er * 0.75);
          ctx.lineTo(-er * 1.05, -er * 0.15);
          ctx.lineTo(-er * 0.35, -er * 0.25);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(er * 0.55, -er * 0.75);
          ctx.lineTo(er * 1.05, -er * 0.15);
          ctx.lineTo(er * 0.35, -er * 0.25);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#12141a';
          ctx.beginPath();
          ctx.arc(er * 0.55 * (e.face || 1), er * 0.18, er * 0.16, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      case 'spiker':
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * Math.PI * 2;
          const rr = i % 2 === 0 ? e.r * 1.25 : e.r * 0.75;
          const px = Math.cos(a) * rr, py = Math.sin(a) * rr;
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;

      case 'thrower':
        ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = flash ? '#fff' : shade(e.color, 50);
        ctx.beginPath(); ctx.arc(e.r * 0.9 * e.face, -e.r * 0.4, e.r * 0.4, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        break;

      case 'charger': {
        const wind = e.state === 'wind';
        if (wind) { ctx.fillStyle = Math.floor(G.time * 16) % 2 ? '#ffdd66' : col; }
        ctx.beginPath();
        ctx.moveTo(e.r * 1.3 * e.face, 0);
        ctx.lineTo(-e.r * 0.8 * e.face, -e.r);
        ctx.lineTo(-e.r * 0.3 * e.face, 0);
        ctx.lineTo(-e.r * 0.8 * e.face, e.r);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }

      case 'bomber': {
        const fusing = e.state === 'fuse';
        ctx.fillStyle = fusing && Math.floor(G.time * 24) % 2 ? '#ffffff' : col;
        ctx.beginPath(); ctx.arc(0, 0, e.r * (fusing ? 1.15 : 1), 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#e8e4dc'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0, -e.r); ctx.lineTo(3, -e.r - 6); ctx.stroke();
        ctx.fillStyle = '#ff9b3c';
        ctx.beginPath(); ctx.arc(3, -e.r - 7, 2.5, 0, Math.PI * 2); ctx.fill();
        break;
      }

      case 'shielder': {
        ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        const ta = Math.atan2(G.player.y - e.y, G.player.x - e.x);
        ctx.strokeStyle = '#c9cdd6';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, e.r + 5, ta - 1.14, ta + 1.14);
        ctx.stroke();
        ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(0, 0, e.r + 5, ta - 1.14, ta + 1.14); ctx.stroke();
        break;
      }

      case 'healer':
        ctx.beginPath(); ctx.arc(0, 0, e.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#eafff4';
        ctx.fillRect(-2, -e.r * 0.55, 4, e.r * 1.1);
        ctx.fillRect(-e.r * 0.55, -2, e.r * 1.1, 4);
        break;

      case 'summoner':
        ctx.beginPath();
        ctx.moveTo(0, -e.r * 1.25);
        ctx.lineTo(e.r, e.r * 0.9);
        ctx.lineTo(-e.r, e.r * 0.9);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e0d0ff';
        ctx.beginPath(); ctx.arc(0, -e.r * 0.2, e.r * 0.22, 0, Math.PI * 2); ctx.fill();
        break;

      case 'boss':
        drawBoss(e, col, flash);
        break;
    }

    // 被抓住：畫出抓握的手臂連線
    if (e.grabbed) {
      ctx.strokeStyle = '#c2703c';
      ctx.lineWidth = 3.5;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(G.player.x - e.x, G.player.y - e.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 被扔出去：速度線
    if (e.thrown) {
      ctx.strokeStyle = '#e8e4dc';
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 2;
      const vx = e.thrown.vx, vy = e.thrown.vy;
      const vl = Math.hypot(vx, vy) || 1;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-vx / vl * e.r * 1.5 + i * 5, -vy / vl * e.r * 1.5 + i * 5);
        ctx.lineTo(-vx / vl * e.r * 3.2 + i * 5, -vy / vl * e.r * 3.2 + i * 5);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    // 精英王冠
    if (e.elite) {
      ctx.fillStyle = '#e0c341'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
      ctx.beginPath();
      const cw = e.r * 0.8;
      ctx.moveTo(-cw, -e.r - 6); ctx.lineTo(-cw * 0.5, -e.r - 13); ctx.lineTo(0, -e.r - 6);
      ctx.lineTo(cw * 0.5, -e.r - 13); ctx.lineTo(cw, -e.r - 6); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    // 眼睛
    if (e.behavior !== 'boss' && e.behavior !== 'healer') {
      ctx.fillStyle = '#12141a';
      const ex = e.r * 0.3 * (e.face || 1);
      ctx.fillRect(ex - 4, -e.r * 0.25, 3, 3);
      ctx.fillRect(ex + 1, -e.r * 0.25, 3, 3);
    }
    // 定身
    if (e.stun > 0) {
      ctx.strokeStyle = '#ffd44a'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -e.r - 10, 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();

    // 血條
    if (e.hp < e.maxHp || e.boss || e.elite) {
      const bw = e.boss ? 64 : Math.max(16, e.r * 1.7);
      const bh = e.boss ? 3.5 : 2.4;
      const bx = e.x - bw / 2, by = e.y - e.r - (e.boss ? 15 : 8);
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(bx - 0.8, by - 0.8, bw + 1.6, bh + 1.6);
      ctx.fillStyle = e.boss ? '#d9564f' : (e.elite ? '#e0c341' : '#c05050');
      ctx.fillRect(bx, by, bw * Math.max(0, e.hp / e.maxHp), bh);
    }
  }
}

function drawBoss(e, col, flash) {
  const r = e.r;
  ctx.fillStyle = col;
  roundRect(ctx, -r, -r * 0.85, r * 2, r * 1.8, r * 0.4);
  ctx.fill(); ctx.stroke();
  // 肩甲
  ctx.fillStyle = flash ? '#fff' : shade(e.color, -40);
  ctx.beginPath(); ctx.arc(-r * 0.95, -r * 0.5, r * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(r * 0.95, -r * 0.5, r * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // 頭
  ctx.fillStyle = flash ? '#fff' : '#e0b48a';
  ctx.beginPath(); ctx.arc(0, -r * 1.05, r * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#12141a';
  ctx.fillRect(-r * 0.25, -r * 1.12, r * 0.16, r * 0.12);
  ctx.fillRect(r * 0.1, -r * 1.12, r * 0.16, r * 0.12);
  // 腰帶
  ctx.fillStyle = '#e0c341';
  ctx.fillRect(-r, r * 0.35, r * 2, r * 0.28);
  ctx.strokeRect(-r, r * 0.35, r * 2, r * 0.28);
  if (e.state === 'wind' || e.state === 'stomp' || e.state === 'wave') {
    ctx.strokeStyle = Math.floor(G.time * 16) % 2 ? '#ffd44a' : '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(0, 0, r + 12, 0, Math.PI * 2); ctx.stroke();
  }
}

/* 武器類別 → 特效貼圖（招式差異的本體：同一套動畫，不同的靈氣） */
function fxForWeapon(w) {
  // 拳腳類不給發光貼圖（總監：空手道家不是射光波）——他們的畫面語言是速度線＋逐格動畫
  if (BARE_ICONS[w.icon]) return null;
  if (w.klass === '刃') return 'fx_slash';
  return 'fx_punch';
}

/* ---------- 攻擊實體：看得見的拳頭與刀光 ---------- */
function drawStrikes() {
  const p = G.player;
  for (const s of G.strikes) {
    const w = s.w;
    // 特效貼圖模式：黑底發光圖用加法混合疊上去
    loadFx('fx_tegatana'); loadFx('fx_seiken'); loadFx('fx_chop_gyaku');
    const fxName = fxForWeapon(w);
    loadFx(fxName); loadFx('fx_impact');
    const fxImg = fxName && FX_IMGS[fxName];
    // 拳腳＝速度線（「咻」），跟著拳頭的當下位置，不射光波
    if (BARE_ICONS[w.icon]) {
      ctx.save();
      const kL = s.kind === 'thrust'
        ? 1 - s.traveled / s.maxDist
        : 1 - Math.min(1, s.t / (s.dur || 0.16));
      if (s.kind === 'thrust') {
        ctx.translate(s.x, s.y);
        ctx.rotate(s.ang);
        ctx.globalAlpha = 0.35 + 0.55 * kL;
        // 三條漸細的速度線拖在拳後，長度隨行程拉長
        const ln = Math.min(34, 10 + s.traveled * 0.8);
        for (let i = -1; i <= 1; i++) {
          ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.55)';
          ctx.lineWidth = i === 0 ? 2.6 : 1.6;
          ctx.beginPath();
          ctx.moveTo(-4, i * 5);
          ctx.lineTo(-4 - ln * (i === 0 ? 1 : 0.72), i * 6.5);
          ctx.stroke();
        }
        // 拳頭前緣的小衝擊楔（暗示打擊點，不是能量彈）
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.moveTo(2, -4); ctx.lineTo(9, 0); ctx.lineTo(2, 4); ctx.closePath();
        ctx.fill();
      } else if (s.kind === 'sweep' || s.kind === 'orbit') {
        // 手刀/掃技：白墨雙弧線，順著揮向一格格畫出來
        const ccw = s.kind === 'sweep' ? s.ang1 < s.ang0 : (s.spd || 1) < 0;
        const a0b = s.kind === 'sweep' ? s.ang0 : s.cur + (ccw ? 1.2 : -1.2);
        ctx.globalAlpha = 0.4 + 0.5 * kL;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, s.reach * 0.82, a0b, s.cur, ccw); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(p.x, p.y, s.reach * 0.66, a0b, s.cur, ccw); ctx.stroke();
      } else if (s.kind === 'slam') {
        const k2 = Math.min(1, s.t / s.delay);
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, s.reach * k2, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
      continue;
    }
    if (fxImg) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const kLife = s.kind === 'thrust'
        ? 1 - s.traveled / s.maxDist
        : 1 - Math.min(1, s.t / (s.dur || 0.2));
      ctx.globalAlpha = 0.55 + 0.45 * kLife;
      if (s.kind === 'thrust') {
        // 拳影從小到大「打出去」，不是憑空出現
        const grow = Math.min(1, 0.35 + s.traveled / 45);
        const sz = 34 * grow;
        ctx.translate(s.x, s.y);
        ctx.rotate(s.ang);
        ctx.drawImage(fxImg, -sz / 2, -sz / 2, sz, sz);
      } else if (s.kind === 'sweep' || s.kind === 'orbit') {
        // 揮刀的方向性：整條月牙躺在完整刀路上不動，
        // 用「已經掃過的扇形」當遮罩一格格揭開——上往下砍，線就從上往下長。
        ctx.translate(p.x, p.y);
        const ccw = s.kind === 'sweep' ? s.ang1 < s.ang0 : (s.spd || 1) < 0;
        const a0v = s.kind === 'sweep' ? s.ang0 : s.cur + (ccw ? 1.6 : -1.6);
        const a1v = s.kind === 'sweep' ? s.ang1 : s.cur;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, s.reach * 1.35, a0v, s.cur, ccw);
        ctx.closePath();
        ctx.clip();
        ctx.rotate((a0v + a1v) / 2);
        const rFull = s.reach * 0.95;
        ctx.drawImage(fxImg, -rFull * 0.05, -rFull * 0.5, rFull, rFull);
        // 刀鋒尖上的小亮點，跟著掃
        ctx.rotate(-((a0v + a1v) / 2) + s.cur);
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.arc(rFull * 0.86, 0, 2.6, 0, Math.PI * 2); ctx.fill();
      } else if (s.kind === 'slam') {
        const k = Math.min(1, s.t / s.delay);
        const sz = s.reach * 2 * k;
        ctx.translate(p.x, p.y);
        ctx.drawImage(fxImg, -sz / 2, -sz / 2, sz, sz);
      }
      ctx.restore();
      continue;
    }
    ctx.save();
    if (s.kind === 'thrust') {
      // 飛行拳影／掌風
      ctx.translate(s.x, s.y);
      ctx.rotate(s.ang);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = w.color;
      ctx.strokeStyle = INK; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 6.5, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = w.color; ctx.lineWidth = 2.5;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-14, i * 4.5);
        ctx.lineTo(-30 - Math.min(20, s.traveled * 0.3), i * 4.5);
        ctx.stroke();
      }
    } else if (s.kind === 'sweep') {
      // 刀路殘弧：從起點掃到當前角度
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = w.color;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(0, 0, s.reach * 0.8, s.ang0, s.cur, s.ang1 < s.ang0);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, s.reach * 0.55, s.ang0, s.cur, s.ang1 < s.ang0);
      ctx.stroke();
      // 刀鋒亮點
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(Math.cos(s.cur) * s.reach * 0.8, Math.sin(s.cur) * s.reach * 0.8, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.kind === 'orbit') {
      // 旋轉的錘頭／棍端實體
      const hx = p.x + Math.cos(s.cur) * s.reach * 0.85;
      const hy = p.y + Math.sin(s.cur) * s.reach * 0.85;
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = w.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = w.color;
      ctx.strokeStyle = INK; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(hx, hy, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = w.color; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.reach * 0.85, s.cur - 0.9 * Math.sign(s.spd), s.cur, s.spd < 0);
      ctx.stroke();
    } else if (s.kind === 'slam') {
      // 預兆圈：脹大到爆發
      const k = Math.min(1, s.t / s.delay);
      ctx.translate(p.x, p.y);
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = w.color;
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, s.reach * k, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/* ---------- 投射物 ---------- */
function drawProjectiles() {
  for (const b of G.projectiles) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(Math.atan2(b.vy, b.vx));
    ctx.fillStyle = b.color;
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, b.r * 1.6, b.r, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}

/* ---------- 掉落物 ---------- */
function drawPickups() {
  for (const it of G.pickups) {
    ctx.save();
    ctx.translate(it.x, it.y);
    const b = Math.sin(G.time * 6 + it.x * 0.05) * 1.6;
    ctx.translate(0, b);
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    if (it.type === 'mat') {
      ctx.fillStyle = '#77c47f';
      ctx.beginPath();
      ctx.moveTo(0, -5); ctx.lineTo(5, 0); ctx.lineTo(0, 5); ctx.lineTo(-5, 0);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (it.type === 'heal') {
      ctx.fillStyle = '#e05c5c';
      roundRect(ctx, -7, -7, 14, 14, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillRect(-1.8, -4.5, 3.6, 9); ctx.fillRect(-4.5, -1.8, 9, 3.6);
    } else {
      ctx.fillStyle = '#d9b06a';
      roundRect(ctx, -10, -8, 20, 16, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#8c6239';
      ctx.fillRect(-10, -2, 20, 3);
      ctx.fillRect(-2, -8, 4, 16);
    }
    ctx.restore();
  }
}

/* ---------- 特效 ---------- */
function drawFxUnder() {
  for (const f of G.fx) {
    const k = f.t / f.life;
    if (f.type === 'shock') {
      if (f.img) loadFx(f.img);
      const simg = f.img && FX_IMGS[f.img];
      if (simg) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - k) * 0.95;
        const ssz = f.size * 2.2 * (0.5 + k * 0.6);
        ctx.drawImage(simg, f.x - ssz / 2, f.y - ssz / 2, ssz, ssz);
        ctx.restore();
        continue;
      }
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 6 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.size * k, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (f.type === 'summon') {
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.size * (1 - k), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (f.type === 'heal_link') {
      if (f.img) loadFx(f.img);
      const limg = f.img && FX_IMGS[f.img];
      if (limg) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        const la = Math.atan2(f.ty - f.y, f.tx - f.x);
        const ll = Math.hypot(f.tx - f.x, f.ty - f.y) || 1;
        ctx.translate((f.x + f.tx) / 2, (f.y + f.ty) / 2);
        ctx.rotate(la);
        ctx.drawImage(limg, -ll / 2, -52, ll, 104);
        ctx.restore();
        continue;
      }
      ctx.strokeStyle = f.color;
      ctx.globalAlpha = (1 - k) * 0.8;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.tx, f.ty); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

function drawFxOver() {
  for (const f of G.fx) {
    const k = f.t / f.life;
    if (f.type === 'swing') {
      if (f.img) loadFx(f.img);
      const fimg = f.img && FX_IMGS[f.img];
      if (fimg) {
        // 招式貼圖：黑底發光圖加法疊上。用扇形遮罩讓刀光「長出來」，
        // 掃到哪露到哪——不是整條線憑空出現。
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.translate(f.x, f.y);
        const reveal = Math.min(1, k / 0.45);          // 前 45% 壽命把整條刀路掃完
        const full = !f.arc || f.arc >= 360;
        const halfA = full ? Math.PI : (f.arc * Math.PI / 180) / 2;
        const base = f.angle || 0;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, f.size * 3, base - halfA, base - halfA + halfA * 2 * reveal);
        ctx.closePath();
        ctx.clip();
        ctx.rotate(base);
        // 招式的刀光同樣是長出來的：長度從三成拉到滿
        const fsz = f.size * 2.1 * (0.3 + 0.75 * reveal);
        ctx.drawImage(fimg, -fsz * 0.1, -fsz / 2, fsz, fsz);
        ctx.restore();
        continue;
      }
      const half = (f.arc * Math.PI / 180) / 2;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.85;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 7 * (1 - k * 0.5);
      ctx.beginPath();
      if (f.arc >= 360) ctx.arc(f.x, f.y, f.size * (0.55 + k * 0.45), 0, Math.PI * 2);
      else ctx.arc(f.x, f.y, f.size * (0.55 + k * 0.45), f.angle - half, f.angle + half);
      ctx.stroke();
      ctx.globalAlpha = (1 - k) * 0.35;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (f.arc >= 360) ctx.arc(f.x, f.y, f.size * (0.3 + k * 0.4), 0, Math.PI * 2);
      else ctx.arc(f.x, f.y, f.size * (0.3 + k * 0.4), f.angle - half, f.angle + half);
      ctx.stroke();
      ctx.restore();
    } else if (f.type === 'burst') {
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = f.color;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + f.x;
        const d = f.size * (0.3 + k * 1.5);
        ctx.beginPath();
        ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, (1 - k) * 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (f.type === 'explode') {
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 8 * (1 - k) + 2;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.size * (0.3 + k * 0.8), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffe08a';
      ctx.globalAlpha = (1 - k) * 0.5;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.size * 0.5 * (1 - k), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (f.type === 'burst_start') {
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.size * k, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else if (f.type === 'spark') {
      // 命中火花：有貼圖用星爆貼圖（加法混合），否則放射短線
      const impactImg = FX_IMGS['fx_impact'];
      if (impactImg) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
        const sz = 26 + k * 26;
        ctx.translate(f.x, f.y);
        ctx.rotate(f.angle || 0);
        ctx.drawImage(impactImg, -sz / 2, -sz / 2, sz, sz);
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 5; i++) {
        const a = f.angle + (i - 2) * 0.5 + Math.sin(f.x * 7 + i * 13) * 0.2;
        const d0 = f.size * 0.4 + k * 16;
        const d1 = d0 + 7 * (1 - k);
        ctx.beginPath();
        ctx.moveTo(f.x + Math.cos(a) * d0, f.y + Math.sin(a) * d0);
        ctx.lineTo(f.x + Math.cos(a) * d1, f.y + Math.sin(a) * d1);
        ctx.stroke();
      }
      ctx.restore();
    } else if (f.type === 'iailine') {
      // 居合的軌跡：一道白光，亮起再淡去
      ctx.save();
      const kk = f.t / f.life;
      ctx.globalAlpha = kk < 0.15 ? kk / 0.15 : 1 - (kk - 0.15) / 0.85;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5 * (1 - kk * 0.6);
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.tx, f.ty); ctx.stroke();
      ctx.strokeStyle = '#bfe8f5';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(f.x, f.y + 2); ctx.lineTo(f.tx, f.ty + 2); ctx.stroke();
      ctx.restore();
    } else if (f.type === 'slide') {
      // 企鵝滑行的冰痕：兩道短平行線淡出
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.5;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2.5;
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle || 0);
      ctx.beginPath();
      ctx.moveTo(-10, -4); ctx.lineTo(8, -4);
      ctx.moveTo(-10, 4); ctx.lineTo(8, 4);
      ctx.stroke();
      ctx.restore();
    } else if (f.type === 'hurt') {
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.7;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.size + k * 14, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
}

function drawDamageNums() {
  ctx.textAlign = 'center';
  for (const d of G.damageNums) {
    const a = Math.max(0, 1 - d.t / 0.75);
    ctx.globalAlpha = a;
    ctx.font = (d.big ? 'bold 14px ' : 'bold 11px ') + FONT;
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.strokeText(d.text, d.x, d.y);
    ctx.fillStyle = d.color;
    ctx.fillText(d.text, d.x, d.y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

const FONT = '"Noto Sans TC","Microsoft JhengHei",sans-serif';

/* ---------- 抬頭顯示 ---------- */
function drawHud() {
  if (!G.player) return;
  const p = G.player;

  // 生命條
  const bw = 300, bh = 22, bx = 24, by = 22;
  ctx.fillStyle = 'rgba(10,12,16,0.82)';
  roundRect(ctx, bx - 4, by - 4, bw + 8, bh + 8, 4); ctx.fill();
  ctx.fillStyle = '#2a1f24';
  ctx.fillRect(bx, by, bw, bh);
  ctx.fillStyle = '#c94a4a';
  ctx.fillRect(bx, by, bw * Math.max(0, p.hp / p.maxHp), bh);
  ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.font = 'bold 14px ' + FONT;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(Math.ceil(p.hp) + ' / ' + p.maxHp, bx + bw / 2, by + 16);

  // 氣勢條
  const my = by + bh + 8;
  ctx.fillStyle = 'rgba(10,12,16,0.82)';
  roundRect(ctx, bx - 4, my - 4, bw + 8, 14, 3); ctx.fill();
  ctx.fillStyle = '#232833';
  ctx.fillRect(bx, my, bw, 8);
  ctx.fillStyle = p.burst > 0 ? '#ffd44a' : '#d98a3c';
  const mw = p.burst > 0 ? bw * (p.burst / (G.char.special === 'fast_momentum' ? 8 : 5)) : bw * (p.momentum / 100);
  ctx.fillRect(bx, my, mw, 8);
  ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
  ctx.strokeRect(bx, my, bw, 8);
  ctx.textAlign = 'left';
  ctx.font = 'bold 11px ' + FONT;
  ctx.fillStyle = p.burst > 0 ? '#ffd44a' : '#9aa4b2';
  ctx.fillText(p.burst > 0 ? '爆發中' : '氣勢', bx + bw + 10, my + 8);

  // 經驗條
  const xy = my + 16;
  const need = xpNeeded(G.level);
  ctx.fillStyle = '#232833';
  ctx.fillRect(bx, xy, bw, 6);
  ctx.fillStyle = '#5b9bd5';
  ctx.fillRect(bx, xy, bw * Math.min(1, G.xp / need), 6);
  ctx.font = 'bold 11px ' + FONT;
  ctx.fillStyle = '#9aa4b2';
  ctx.fillText('等級 ' + G.level, bx + bw + 10, xy + 6);

  // 波次與時間
  ctx.textAlign = 'center';
  ctx.font = 'bold 30px ' + FONT;
  ctx.lineWidth = 5; ctx.strokeStyle = INK;
  const wtxt = isBossWave(G.wave) ? ('第 ' + G.wave + ' 波 · 頭目') : ('第 ' + G.wave + ' 波');
  ctx.strokeText(wtxt, VIEW.w / 2, 44);
  ctx.fillStyle = isBossWave(G.wave) ? '#e0c341' : '#e8e4dc';
  ctx.fillText(wtxt, VIEW.w / 2, 44);

  const left = Math.max(0, G.waveDur - G.waveTime);
  const bossAlive = G.enemies.some(e => e.boss);
  if (left <= 0 && bossAlive) {
    ctx.font = 'bold 30px ' + FONT;
    ctx.lineWidth = 6;
    ctx.strokeText('擊倒頭目', VIEW.w / 2, 86);
    ctx.fillStyle = '#d9564f';
    ctx.fillText('擊倒頭目', VIEW.w / 2, 86);
  } else {
    ctx.font = 'bold 40px ' + FONT;
    ctx.lineWidth = 6;
    ctx.strokeText(Math.ceil(left).toString(), VIEW.w / 2, 88);
    ctx.fillStyle = left < 6 ? '#e0c341' : '#e8e4dc';
    ctx.fillText(Math.ceil(left).toString(), VIEW.w / 2, 88);
  }

  // 素材
  ctx.textAlign = 'right';
  ctx.font = 'bold 22px ' + FONT;
  ctx.lineWidth = 5; ctx.strokeStyle = INK;
  ctx.strokeText(G.materials + ' 素材', VIEW.w - 24, 40);
  ctx.fillStyle = '#77c47f';
  ctx.fillText(G.materials + ' 素材', VIEW.w - 24, 40);
  ctx.textAlign = 'left';

  // 武器冷卻指示
  const wx = 24, wy = VIEW.h - 56, WS = 50;
  p.weapons.forEach((w, i) => {
    const x = wx + i * (WS + 6);
    ctx.fillStyle = 'rgba(10,12,16,0.8)';
    roundRect(ctx, x, wy, WS, WS, 5); ctx.fill();
    ctx.strokeStyle = TIER_COLOR[w.tier]; ctx.lineWidth = 2;
    roundRect(ctx, x, wy, WS, WS, 5); ctx.stroke();
    ctx.save();
    ctx.beginPath(); ctx.rect(x, wy, WS, WS); ctx.clip();
    ctx.translate(x + WS / 2, wy + WS / 2);
    ctx.rotate(-0.5);
    ctx.translate(-13, 0);
    drawWeaponShape(ctx, w, 42, 0);
    ctx.restore();
    const cdk = Math.max(0, w.cdLeft / w.cd);
    if (cdk > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, wy, WS, WS * cdk);
    }
  });

  // ---- 三態招式欄（右下）----
  const TS = 44;
  const slots = ['dash', 'move', 'still'];
  const slotLit = {
    dash: p.dashCd <= 0,
    move: movingActive(),
    still: stillActive(),
  };
  const baseX = VIEW.w - 24 - 3 * (TS + 8);
  const baseY = VIEW.h - TS - 46;
  slots.forEach((slot, i) => {
    const def = MOVE_MAP[p.moves[slot]];
    const x = baseX + i * (TS + 8);
    const lit = slotLit[slot];
    ctx.fillStyle = 'rgba(10,12,16,0.82)';
    roundRect(ctx, x, baseY, TS, TS, 6); ctx.fill();
    ctx.strokeStyle = lit ? def.color : '#3a4050';
    ctx.lineWidth = lit ? 3 : 2;
    roundRect(ctx, x, baseY, TS, TS, 6); ctx.stroke();
    ctx.fillStyle = lit ? def.color : '#5f6878';
    ctx.font = 'bold 20px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(def.short, x + TS / 2, baseY + TS / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    if (slot === 'dash' && p.dashCd > 0) {
      const k = Math.min(1, p.dashCd / (def.cd || 6));
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(x, baseY, TS, TS * k);
      ctx.fillStyle = '#e8e4dc';
      ctx.font = 'bold 13px ' + FONT;
      ctx.fillText(Math.ceil(p.dashCd), x + TS / 2, baseY + TS / 2 + 4);
    }
    ctx.fillStyle = '#6d7583';
    ctx.font = 'bold 9px ' + FONT;
    ctx.fillText(slot === 'dash' ? 'SPACE' : (slot === 'move' ? '移動' : '站定'), x + TS / 2, baseY + TS + 11);
    ctx.fillStyle = lit ? '#c8ccd6' : '#5f6878';
    ctx.font = 'bold 10px ' + FONT;
    ctx.fillText(def.name, x + TS / 2, baseY - 4);
  });

  // ---- 節拍條與連段指令（醍醐味的回饋核心）----
  // 讀 comboList()：跟引擎判定同一份資料，HUD 不准教玩家錯的指令。
  const combos = typeof comboList === 'function' ? comboList() : [];
  if (combos.length) {
    const beatY = baseY - 34;
    const rdy2 = comboReady();
    const BEAT_TXT = { S: '站', M: '移', D: '衝' };
    const BEAT_COL = { S: '#e8964a', M: '#8fd4e0', D: '#ffd44a' };
    // 目前已敲出的節拍（上排）
    ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) {
      const bx = baseX + 26 + i * 34;
      const beat = p.beatLog[i];
      ctx.fillStyle = 'rgba(10,12,16,0.8)';
      roundRect(ctx, bx, beatY, 26, 18, 4); ctx.fill();
      ctx.strokeStyle = rdy2.length ? '#ffd44a' : '#3a4050';
      ctx.lineWidth = 1.6;
      roundRect(ctx, bx, beatY, 26, 18, 4); ctx.stroke();
      if (beat) {
        ctx.fillStyle = BEAT_COL[beat];
        ctx.font = 'bold 12px ' + FONT;
        ctx.fillText(BEAT_TXT[beat], bx + 13, beatY + 14);
      }
    }
    // 連段表（底）：每條一行「前綴 → 動作＝招名」，就緒亮、冷卻壓暗＋秒數
    ctx.font = 'bold 10px ' + FONT;
    ctx.textAlign = 'left';
    const ACT_TXT = { S: '站打', M: '移打', D: 'Space' };
    combos.forEach((c, i) => {
      const ly = beatY - 14 - (combos.length - 1 - i) * 13;
      const pre = c.seq.slice(0, -1).map(b => BEAT_TXT[b]).join('·');
      const act = c.seq[c.seq.length - 1];
      const r2 = rdy2.find(r => r.name === c.name);
      const onCd = r2 && r2.cd > 0;
      ctx.fillStyle = r2
        ? (onCd ? 'rgba(138,121,94,0.75)' : (c.sig ? '#ffd44a' : '#e8e4dc'))
        : '#6d7583';
      ctx.fillText(
        pre + '→' + ACT_TXT[act] + '＝' + c.name + (c.sig ? '★' : '') +
        (onCd ? '（' + r2.cd.toFixed(0) + 's）' : (r2 ? '　可出！' : '')),
        baseX - 66, ly);
    });
    ctx.textAlign = 'left';
  }

  // ---- 奧義發動字卡 ----
  if (G.ougiBanner && G.ougiBanner.t > 0) {
    const k = G.ougiBanner.t / 1.3;
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 3);
    ctx.textAlign = 'center';
    ctx.font = 'bold 58px ' + FONT;
    ctx.lineWidth = 9;
    ctx.strokeStyle = INK;
    const by = VIEW.h * 0.32 - (1 - k) * 14;
    ctx.strokeText('奧義', VIEW.w / 2, by - 54);
    ctx.fillStyle = '#ffd44a';
    ctx.fillText('奧義', VIEW.w / 2, by - 54);
    ctx.font = 'bold 44px ' + FONT;
    ctx.lineWidth = 8;
    ctx.strokeText(G.ougiBanner.name, VIEW.w / 2, by);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(G.ougiBanner.name, VIEW.w / 2, by);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // HITS 連擊計數：連續技的臉面
  if ((G.comboHits || 0) >= 3) {
    const hits = G.comboHits;
    const col = hits >= 40 ? '#ff5a4a' : hits >= 20 ? '#ff9b3c' : hits >= 10 ? '#ffd44a' : '#e8e4dc';
    const pop = 1 + Math.max(0, G.comboPop || 0) * 2.2;
    const fade = Math.min(1, G.comboT / 0.5);
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * fade;
    ctx.translate(96, VIEW.h * 0.38);
    ctx.scale(pop, pop);
    ctx.textAlign = 'center';
    ctx.font = 'bold 44px ' + FONT;
    ctx.lineWidth = 7; ctx.strokeStyle = INK;
    ctx.strokeText(hits + '', 0, 0);
    ctx.fillStyle = col;
    ctx.fillText(hits + '', 0, 0);
    ctx.font = 'bold 15px ' + FONT;
    ctx.lineWidth = 4;
    ctx.strokeText('HITS', 0, 20);
    ctx.fillText('HITS', 0, 20);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // 波末提示
  if (G.waveEnding > 0) {
    ctx.textAlign = 'center';
    ctx.font = 'bold 36px ' + FONT;
    ctx.lineWidth = 6; ctx.strokeStyle = INK;
    ctx.strokeText('回收素材', VIEW.w / 2, VIEW.h / 2 - 60);
    ctx.fillStyle = '#77c47f';
    ctx.fillText('回收素材', VIEW.w / 2, VIEW.h / 2 - 60);
    ctx.textAlign = 'left';
  }
}

/* ---------- 圖示（供介面用） ---------- */
function drawIconTo(canvasEl, kind, id, tier) {
  const c = canvasEl.getContext('2d');
  c.clearRect(0, 0, canvasEl.width, canvasEl.height);
  c.save();
  c.translate(canvasEl.width / 2, canvasEl.height / 2);
  if (kind === 'gear') {
    const g = GEAR_MAP[id];
    c.strokeStyle = '#d98a3c'; c.lineWidth = 2.5;
    roundRect(c, -13, -13, 26, 26, 5); c.stroke();
    c.fillStyle = '#d98a3c';
    c.font = 'bold 15px ' + FONT;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(g.name.slice(0, 1), 0, 1);
    c.restore();
    return;
  }
  if (kind === 'tech') {
    const t = moveDef(id);
    c.strokeStyle = t.color; c.lineWidth = 3;
    c.beginPath(); c.arc(0, 0, 20, 0, Math.PI * 2); c.stroke();
    c.fillStyle = t.color;
    c.font = 'bold 22px ' + FONT;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(t.short, 0, 1);
    c.restore();
    return;
  }
  if (kind === 'weapon') {
    const base = WEAPON_MAP[id];
    const fake = { icon: base.icon, color: base.color, tier: tier || 1 };
    c.rotate(-0.6);
    c.translate(-14, 0);
    c.scale(1.05, 1.05);
    drawWeaponShape(c, fake, 50, 0);
  } else {
    const it = ITEM_MAP[id];
    const col = TIER_COLOR[it.tier];
    c.strokeStyle = INK; c.lineWidth = 3;
    c.fillStyle = col;
    // 依主要屬性給不同外型，讓道具在視覺上可分辨
    const main = Object.keys(it.stats || {})[0] || 'dmg';
    if (main === 'maxHp' || main === 'regen') {
      roundRect(c, -12, -12, 24, 24, 5); c.fill(); c.stroke();
      c.fillStyle = '#fff'; c.fillRect(-3, -8, 6, 16); c.fillRect(-8, -3, 16, 6);
    } else if (main === 'dmg' || main === 'crit') {
      c.beginPath(); c.moveTo(0, -14); c.lineTo(11, 10); c.lineTo(-11, 10); c.closePath();
      c.fill(); c.stroke();
    } else if (main === 'armor' || main === 'block') {
      c.beginPath(); c.moveTo(0, -14); c.lineTo(12, -7); c.lineTo(12, 5);
      c.lineTo(0, 14); c.lineTo(-12, 5); c.lineTo(-12, -7); c.closePath();
      c.fill(); c.stroke();
    } else if (main === 'speed' || main === 'dodge' || main === 'atkSpd') {
      c.beginPath(); c.moveTo(-4, -14); c.lineTo(10, -2); c.lineTo(2, -2);
      c.lineTo(6, 14); c.lineTo(-10, 0); c.lineTo(-1, 0); c.closePath();
      c.fill(); c.stroke();
    } else {
      c.beginPath(); c.arc(0, 0, 12, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = shade(col, -50);
      c.beginPath(); c.arc(0, 0, 5, 0, Math.PI * 2); c.fill();
    }
  }
  c.restore();
}

function drawCharPortraitTo(canvasEl, charId) {
  const c = canvasEl.getContext('2d');
  const ch = CHARACTERS.find(x => x.id === charId);
  c.clearRect(0, 0, canvasEl.width, canvasEl.height);
  c.save();
  c.translate(canvasEl.width / 2, canvasEl.height / 2 + 4);
  c.scale(1.35, 1.35);
  // 立繪＝各職業的站架，跟戰鬥中同一套骨架
  drawFighter(c, ch, { time: 0.7, face: 1, walk: 0 });
  c.restore();
}
