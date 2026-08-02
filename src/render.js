/* ============================================================
   肉搏場 — 繪圖層
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

  // 場中圓
  ctx.strokeStyle = '#242935';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(ARENA.w / 2, ARENA.h / 2, 210, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(ARENA.w / 2, ARENA.h / 2, 96, 0, Math.PI * 2);
  ctx.stroke();

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
    case 'kick':  return { kick: snap };
    case 'knee':  return { knee: snap };
    case 'swing': return { fArm: [1.45 * snap + 0.5, 0.25], punch: snap * 0.7 };
    case 'dash':  return { fArm: [0.3, 0.2], bArm: [0.3, 0.2], lean: 0.5 * snap };
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
  ctx.save();
  ctx.translate(p.x, p.y);

  // 影子
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, p.r * 0.85, p.r * 0.9, p.r * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();

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
  // 三態招式視覺：站樁與移動技生效時要一眼看得出「開著」
  const stillOn = stillActive();
  const movingOn = movingActive();
  if (stillOn) {
    const sid = p.moves.still;
    const col = MOVE_MAP[sid] ? MOVE_MAP[sid].color : '#e8e4dc';
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.55 + Math.sin(G.time * 8) * 0.2;
    ctx.beginPath(); ctx.arc(0, 0, p.r + 8, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    if (sid === 'focus_strike' && p.focusStacks > 0) {   // 蓄力層數
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

  const flash = p.iframe > 0 && Math.floor(G.time * 20) % 2 === 0;
  drawFighter(ctx, c, {
    time: G.time, face: p.face, walk: p.walkAnim, flash, pose: p.pose,
  });
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
    const reach = w.range * rangeMul;
    const swingP = Math.max(0, w.swing);
    const holdD = 16 + i * 1.5;
    const a = w.angle + (swingP > 0 ? w.swingDir * swingP * 0.5 : 0);
    ctx.save();
    ctx.translate(p.x + Math.cos(a) * holdD, p.y + Math.sin(a) * holdD);
    ctx.rotate(a);
    drawWeaponShape(ctx, w, reach, swingP);
    ctx.restore();
  });
}

function drawWeaponShape(c, w, reach, swing) {
  const L = Math.min(reach * 0.55, 46);
  c.strokeStyle = INK;
  c.lineWidth = 3;
  c.fillStyle = w.color;
  const push = swing * 8;
  switch (w.icon) {
    case 'fist':
      roundRect(c, push, -6, 13, 12, 4); c.fill(); c.stroke();
      c.fillStyle = shade(w.color, -50);
      c.fillRect(push + 3, -6, 2, 12);
      c.fillRect(push + 7, -6, 2, 12);
      break;
    case 'palm':
      roundRect(c, push, -8, 10, 16, 4); c.fill(); c.stroke();
      break;
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

/* ---------- 敵人 ---------- */
function drawEnemies() {
  for (const e of G.enemies) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(0, e.r * 0.82, e.r * 0.85, e.r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

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

/* ---------- 攻擊實體：看得見的拳頭與刀光 ---------- */
function drawStrikes() {
  const p = G.player;
  for (const s of G.strikes) {
    const w = s.w;
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
      // 命中火花：沿受擊方向放射短線
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

  // ---- 節拍條與奧義指令（醍醐味的回饋核心）----
  const o = OUGI[G.char.id];
  if (o) {
    const beatY = baseY - 34;
    const ready = ougiReady();
    // 自家奧義指令（底）與目前節拍（上）對照
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px ' + FONT;
    ctx.fillStyle = ready ? '#ffd44a' : '#6d7583';
    const seqStr = o.seq.map(b => b === 'S' ? '站' : '移').join('·') + '＋衝';
    ctx.fillText((ready ? '奧義就緒！' : o.name + '　') + seqStr, baseX + (3 * (TS + 8) - 8) / 2, beatY - 12);
    // 目前已敲出的節拍
    for (let i = 0; i < 3; i++) {
      const bx = baseX + 26 + i * 34;
      const beat = p.beatLog.length >= 3 ? p.beatLog[i] : p.beatLog[i];
      ctx.fillStyle = 'rgba(10,12,16,0.8)';
      roundRect(ctx, bx, beatY, 26, 18, 4); ctx.fill();
      const want = o.seq[i];
      const match = beat && beat === want;
      ctx.strokeStyle = ready ? '#ffd44a' : (match ? '#77c47f' : '#3a4050');
      ctx.lineWidth = 1.6;
      roundRect(ctx, bx, beatY, 26, 18, 4); ctx.stroke();
      if (beat) {
        ctx.fillStyle = beat === 'S' ? '#e8964a' : '#8fd4e0';
        ctx.font = 'bold 12px ' + FONT;
        ctx.fillText(beat === 'S' ? '站' : '移', bx + 13, beatY + 14);
      }
    }
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
