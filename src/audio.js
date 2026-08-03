/* ============================================================
   Penguin Can Fight — 音效引擎
   素材來源：効果音ラボ（soundeffect-lab.info），授權允許遊戲內使用。
   引擎責任：預載、音高隨機（去機關槍感）、同名節流、力度分層、主音量。
   Node 模擬環境不載入本檔，engine.js 內的 sfx() 空殼替身會生效。
   ============================================================ */
(function () {
  const FILES = {
    hit_light: ['punch-light1', 'punch-light2'],
    hit_mid: ['punch-middle2'],
    hit_heavy: ['punch-heavy1'],
    hit_kick: ['kick-middle1'],
    hit_blade: ['sword-slash2'],
    hit_blunt: ['blow3'],
    swing: ['punch-swing1'],
    swing_leg: ['kick-real-swing1'],
    swing_blade: ['katana-gesture1'],
    dash: ['highspeed-movement1'],
    throw_hit: ['shoulder-throw1'],
    grab: ['grap1'],
    quake: ['earth-tremor1'],
    ougi_cast: ['super-arts-motion1'],
    ougi_hit: ['super-arts-hit1'],
    wind: ['magic-wind1'],
    flash: ['iainuki1'],
    draw: ['sword-drawn1'],
    sheathe: ['sword-storage1'],
    levelup: ['magic-statusup1'],
    heal: ['magic-cure1'],
  };
  const VOL = {
    hit_light: 0.45, hit_mid: 0.6, hit_heavy: 0.8, hit_kick: 0.55,
    hit_blade: 0.55, hit_blunt: 0.6,
    swing: 0.22, swing_leg: 0.25, swing_blade: 0.3,
    dash: 0.5, throw_hit: 0.75, grab: 0.6, quake: 0.65,
    ougi_cast: 0.9, ougi_hit: 0.95, wind: 0.4, flash: 0.6, draw: 0.7, sheathe: 0.7,
    levelup: 0.6, heal: 0.5,
  };
  const THROTTLE = { swing: 0.1, swing_leg: 0.1, swing_blade: 0.1, hit_light: 0.06, hit_mid: 0.06, hit_kick: 0.06, hit_blade: 0.06, hit_blunt: 0.06 };

  let ctx = null;
  let master = null;
  const buffers = {};
  const lastPlay = {};
  let muted = false;
  let curVol = 0.8;
  try {
    const sv = parseFloat(localStorage.getItem('penguin_vol_v1'));
    if (!isNaN(sv)) curVol = Math.max(0, Math.min(1, sv));
  } catch (e) {}

  function ensureCtx() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = curVol;
    master.connect(ctx.destination);
    // 預載全部
    for (const key in FILES) {
      FILES[key].forEach((name, i) => {
        fetch('assets/se/' + name + '.mp3')
          .then(r => r.arrayBuffer())
          .then(ab => ctx.decodeAudioData(ab))
          .then(buf => {
            if (!buffers[key]) buffers[key] = [];
            buffers[key][i] = buf;
          })
          .catch(() => {});
      });
    }
    return true;
  }

  // 瀏覽器要使用者手勢才准出聲：第一次按鍵／點擊時解鎖
  function unlock() {
    if (ensureCtx() && ctx.state === 'suspended') ctx.resume();
  }
  window.addEventListener('keydown', unlock, { once: false });
  window.addEventListener('pointerdown', unlock, { once: false });

  let crackBuf = null;
  function chopCrack(opts) {
    if (muted || !ensureCtx()) return;
    opts = opts || {};
    if (!crackBuf) {
      crackBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.05), ctx.sampleRate);
      const d = crackBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2.4);
    }
    const src = ctx.createBufferSource();
    src.buffer = crackBuf;
    src.playbackRate.value = (opts.pitch || 1) * (0.92 + Math.random() * 0.2);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.value = 0.85 * (opts.vol || 1);
    src.connect(hp); hp.connect(g); g.connect(master);
    src.start();
  }

  window.sfx = function (key, opts) {
    if (key === 'chop_crack') return chopCrack(opts);
    if (muted || !ctx || !buffers[key] || !buffers[key].length) return;
    opts = opts || {};
    const now = ctx.currentTime;
    const th = THROTTLE[key] || 0.03;
    if (lastPlay[key] && now - lastPlay[key] < th) return;
    lastPlay[key] = now;
    const list = buffers[key].filter(Boolean);
    if (!list.length) return;
    const buf = list[Math.floor(Math.random() * list.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.pitch || 1) * (0.92 + Math.random() * 0.16);
    const g = ctx.createGain();
    g.gain.value = (VOL[key] || 0.5) * (opts.vol || 1);
    src.connect(g); g.connect(master);
    src.start();
  };

  window.sfxGetVolume = function () { return curVol; };
  window.sfxSetVolume = function (v) {
    curVol = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = curVol;
    try { localStorage.setItem('penguin_vol_v1', String(curVol)); } catch (e) {}
    return curVol;
  };

  /* 連段音符：拍子進節奏的「登、登」，音高隨進度上升 */
  window.sfxBeat = function (step) {
    if (muted || !ensureCtx()) return;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = [523, 659, 784][Math.max(0, Math.min(2, step - 1))];
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.34, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + 0.14);
  };
  /* 連段就緒：上行雙音「登-登！」——下一個動作就是收尾招 */
  window.sfxComboReady = function () {
    if (muted || !ensureCtx()) return;
    const t0 = ctx.currentTime;
    [[784, 0], [1175, 0.07]].forEach(([f, d]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d);
      g.gain.exponentialRampToValueAtTime(0.4, t0 + d + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.16);
      o.connect(g); g.connect(master);
      o.start(t0 + d); o.stop(t0 + d + 0.17);
    });
  };

  window.sfxToggleMute = function () {
    muted = !muted;
    return muted;
  };
})();
