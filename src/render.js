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

/* ---------- 玩家 ---------- */
function drawPlayer() {
  const p = G.player;
  const c = G.char;
  ctx.save();
  ctx.translate(p.x, p.y);

  const bob = Math.sin(p.walkAnim) * 2.2;
  const lean = Math.sin(p.walkAnim) * 0.06;

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
  // 絕技狀態視覺
  if (p.counterT > 0) {   // 借力化勁：藍色架式圈
    ctx.strokeStyle = '#5a8ac9';
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.7 + Math.sin(G.time * 10) * 0.2;
    ctx.beginPath(); ctx.arc(0, 0, p.r + 7, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (p.limitT > 0) {     // 解縛：紅色蒸氣線
    ctx.strokeStyle = '#d9564f';
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const ox = Math.sin(G.time * 7 + i * 2.1) * 6;
      ctx.beginPath();
      ctx.moveTo(ox - 6 + i * 6, -20);
      ctx.lineTo(ox - 3 + i * 6, -30 - (G.time * 40 + i * 9) % 8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (p.bellT > 0) {      // 金鐘罩：金色鐘形罩
    ctx.strokeStyle = '#d9b06a';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(0, -4, p.r + 12, Math.PI * 0.95, Math.PI * 2.05); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (p.swayT > 0) {      // 搖擺身法：殘影
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = G.char.color;
    const sw = Math.sin(G.time * 16) * 8;
    ctx.beginPath(); ctx.arc(sw, -4, p.r * 0.8, 0, Math.PI * 2); ctx.fill();
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

  ctx.rotate(lean);
  ctx.translate(0, bob);
  const flash = p.iframe > 0 && Math.floor(G.time * 20) % 2 === 0;

  // 腿
  const legSw = Math.sin(p.walkAnim) * 5;
  ctx.strokeStyle = INK; ctx.lineWidth = 6; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-4, 6); ctx.lineTo(-4 + legSw, 15); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, 6); ctx.lineTo(4 - legSw, 15); ctx.stroke();

  // 身體
  ctx.fillStyle = flash ? '#ffffff' : c.color;
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  roundRect(ctx, -10, -8, 20, 17, 5);
  ctx.fill(); ctx.stroke();

  // 腰帶
  ctx.fillStyle = flash ? '#ffffff' : shade(c.color, -45);
  ctx.fillRect(-10, 2, 20, 4);

  // 手臂
  ctx.strokeStyle = flash ? '#ffffff' : c.skin;
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(-9, -4); ctx.lineTo(-14, 2 - legSw * 0.4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(9, -4); ctx.lineTo(14, 2 + legSw * 0.4); ctx.stroke();

  // 頭
  ctx.fillStyle = flash ? '#ffffff' : c.skin;
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, -14, 8, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();

  // 頭部特徵（依職業給一點辨識度）
  ctx.fillStyle = INK;
  const id = c.id;
  if (id === 'ninja') { ctx.fillRect(-8, -17, 16, 5); }
  else if (id === 'boxer' || id === 'muaythai') { ctx.fillRect(-8, -20, 16, 4); }
  else if (id === 'karate' || id === 'judo' || id === 'kenshi') {
    ctx.strokeStyle = '#e8e4dc'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-9, -18); ctx.lineTo(9, -18); ctx.stroke();
    ctx.strokeStyle = INK;
  } else if (id === 'sumo') { ctx.beginPath(); ctx.arc(0, -21, 4, 0, Math.PI * 2); ctx.fill(); }
  else if (id === 'monk') { ctx.fillRect(-2, -22, 4, 3); }
  else if (id === 'ironhead') {
    ctx.strokeStyle = '#c9cdd6'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -14, 9, Math.PI, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = INK;
  }
  // 眼睛
  ctx.fillStyle = INK;
  ctx.fillRect(p.face > 0 ? 1 : -5, -15, 4, 2.4);

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

  // 絕技冷卻（右下）
  const TS = 54;
  p.techs.forEach((t, i) => {
    const x = VIEW.w - 24 - (2 - i) * (TS + 8);
    const y = VIEW.h - TS - 30;
    ctx.fillStyle = 'rgba(10,12,16,0.82)';
    roundRect(ctx, x, y, TS, TS, 6); ctx.fill();
    if (t) {
      const ready = t.cdLeft <= 0;
      ctx.strokeStyle = ready ? t.def.color : '#3a4050';
      ctx.lineWidth = ready ? 3 : 2;
      roundRect(ctx, x, y, TS, TS, 6); ctx.stroke();
      ctx.fillStyle = ready ? t.def.color : '#5f6878';
      ctx.font = 'bold 26px ' + FONT;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.def.short, x + TS / 2, y + TS / 2 + 1);
      ctx.textBaseline = 'alphabetic';
      if (!ready) {
        const k = t.cdLeft / t.def.cd;
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(x, y, TS, TS * Math.min(1, k));
        ctx.fillStyle = '#e8e4dc';
        ctx.font = 'bold 15px ' + FONT;
        ctx.fillText(Math.ceil(t.cdLeft), x + TS / 2, y + TS / 2 + 5);
      }
      ctx.fillStyle = '#6d7583';
      ctx.font = 'bold 10px ' + FONT;
      ctx.fillText(i === 0 ? 'SPACE' : 'E', x + TS / 2, y + TS + 12);
      ctx.fillStyle = ready ? '#c8ccd6' : '#5f6878';
      ctx.font = 'bold 11px ' + FONT;
      ctx.fillText(t.def.name, x + TS / 2, y - 5);
    } else {
      ctx.strokeStyle = '#262b36'; ctx.lineWidth = 2;
      roundRect(ctx, x, y, TS, TS, 6); ctx.stroke();
      ctx.fillStyle = '#3a4050';
      ctx.font = 'bold 20px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('—', x + TS / 2, y + TS / 2 + 7);
      ctx.fillStyle = '#6d7583';
      ctx.font = 'bold 10px ' + FONT;
      ctx.fillText(i === 0 ? 'SPACE' : 'E', x + TS / 2, y + TS + 12);
    }
  });
  ctx.textAlign = 'left';

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
  if (kind === 'tech') {
    const t = TECH_MAP[id];
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
  c.translate(canvasEl.width / 2, canvasEl.height / 2 + 3);
  c.scale(0.95, 0.95);
  c.strokeStyle = INK; c.lineWidth = 3;
  // 腿
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(-4, 6); c.lineTo(-5, 15); c.stroke();
  c.beginPath(); c.moveTo(4, 6); c.lineTo(5, 15); c.stroke();
  // 身
  c.fillStyle = ch.color;
  roundRect(c, -10, -8, 20, 17, 5); c.fill(); c.stroke();
  c.fillStyle = shade(ch.color, -45);
  c.fillRect(-10, 2, 20, 4);
  // 手
  c.strokeStyle = ch.skin; c.lineWidth = 5;
  c.beginPath(); c.moveTo(-9, -4); c.lineTo(-14, 3); c.stroke();
  c.beginPath(); c.moveTo(9, -4); c.lineTo(14, 3); c.stroke();
  // 頭
  c.fillStyle = ch.skin; c.strokeStyle = INK; c.lineWidth = 3;
  c.beginPath(); c.arc(0, -14, 8, 0, Math.PI * 2); c.fill(); c.stroke();
  c.fillStyle = INK;
  if (ch.id === 'ninja') c.fillRect(-8, -17, 16, 5);
  else if (ch.id === 'boxer' || ch.id === 'muaythai') c.fillRect(-8, -20, 16, 4);
  else if (ch.id === 'sumo') { c.beginPath(); c.arc(0, -21, 4, 0, Math.PI * 2); c.fill(); }
  else if (ch.id === 'monk') c.fillRect(-2, -22, 4, 3);
  if (ch.id === 'karate' || ch.id === 'judo' || ch.id === 'kenshi') {
    c.strokeStyle = '#e8e4dc'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(-9, -18); c.lineTo(9, -18); c.stroke();
  }
  if (ch.id === 'ironhead') {
    c.strokeStyle = '#c9cdd6'; c.lineWidth = 3;
    c.beginPath(); c.arc(0, -14, 9, Math.PI, Math.PI * 2); c.stroke();
  }
  c.fillStyle = INK;
  c.fillRect(1, -15, 4, 2.4);
  c.restore();
}
