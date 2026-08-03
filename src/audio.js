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
  let bgmBus = null, bgmSrc = null, bgmBuf = null, bgmLoading = false;
  const BGM_FILE = 'assets/bgm/battle.mp3';
  const BGM_LOOP_END = 59.0;   // 原曲最後 0.9 秒是淡出——循環跳過它，不然每分鐘會掉一次音量
  let bgmVol = 0.55;
  try {
    const bv = parseFloat(localStorage.getItem('penguin_bgmvol_v1'));
    if (!isNaN(bv)) bgmVol = Math.max(0, Math.min(1, bv));
  } catch (e) {}
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
    bgmBus = ctx.createGain();
    bgmBus.gain.value = bgmVol;
    bgmBus.connect(master);
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

  /* ---------- 分層命中引擎 ----------
     問題不在素材品質，在於 22 個檔要服務 29 把武器：打刀跟大鎚共用同一個打擊音，
     只靠音高隨機做變化，聽感當然沒有差別。
     解法：一次命中疊三層——
       衝擊層(transient)  高頻噪衝，決定「銳不銳」
       材質層(body)       正弦/三角低頻，決定「重不重」
       尾韻層(tail)       金屬 ring 或木質衰減，決定「是什麼東西打到什麼東西」
     全部程序合成，零新素材、零檔案大小。現有樣本照舊疊在最上面當真實感。
  */
  const noiseCache = {};
  function noiseBuf(dur, curve) {
    const key = dur.toFixed(3) + '_' + curve;
    if (noiseCache[key]) return noiseCache[key];
    const b = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, curve);
    noiseCache[key] = b;
    return b;
  }
  function playNoise(dur, curve, hz, type, vol, when) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf(dur, curve);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = hz;
    if (type === 'bandpass') f.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(when || 0);
  }
  function playTone(f0, f1, dur, vol, when, type) {
    const t0 = (when || ctx.currentTime);
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  /* 每個武器類別的聲音配方：這張表就是「打刀跟大鎚聽起來不一樣」的全部 */
  const HIT_RECIPE = {
    '刃':   { tr: [0.03, 3.2, 5200, 'highpass', 0.5], body: [220, 90, 0.07, 0.16, 'triangle'], tail: [1400, 900, 0.22, 0.07, 'sine'] },
    '拳':   { tr: [0.02, 4.0, 1800, 'bandpass', 0.4], body: [150, 55, 0.10, 0.34, 'sine'],     tail: null },
    '掌':   { tr: [0.025, 3.4, 3000, 'highpass', 0.42], body: [180, 70, 0.08, 0.24, 'sine'],   tail: null },
    '摔技': { tr: [0.03, 2.6, 3400, 'highpass', 0.6], body: [200, 80, 0.07, 0.2, 'triangle'],  tail: null },
    '腿':   { tr: [0.028, 3.0, 2200, 'bandpass', 0.45], body: [130, 48, 0.12, 0.36, 'sine'],   tail: null },
    '肘膝': { tr: [0.022, 3.6, 2600, 'bandpass', 0.44], body: [140, 52, 0.10, 0.34, 'sine'],   tail: null },
    '棍':   { tr: [0.026, 3.0, 3800, 'highpass', 0.44], body: [190, 75, 0.09, 0.26, 'triangle'], tail: [900, 620, 0.14, 0.05, 'triangle'] },
    '重械': { tr: [0.035, 2.2, 1200, 'lowpass', 0.55], body: [95, 38, 0.20, 0.5, 'sine'],      tail: [300, 150, 0.3, 0.08, 'triangle'] },
    '軟兵': { tr: [0.03, 2.8, 2400, 'bandpass', 0.4], body: [160, 60, 0.11, 0.3, 'sine'],      tail: null },
    '相撲': { tr: [0.03, 2.4, 1500, 'lowpass', 0.5], body: [110, 42, 0.16, 0.44, 'sine'],      tail: null },
  };
  const HIT_DEFAULT = HIT_RECIPE['拳'];

  /* force 0~1：越重的一擊，低頻越沉、尾韻越長——同一把武器也要有輕重層次 */
  window.sfxHit = function (klass, force, opts) {
    if (muted || !ensureCtx()) return;
    opts = opts || {};
    const now = ctx.currentTime;
    if (lastPlay.__layer && now - lastPlay.__layer < 0.022) return;   // 同幀多段命中只疊一次
    lastPlay.__layer = now;
    const r = HIT_RECIPE[klass] || HIT_DEFAULT;
    const f = Math.max(0, Math.min(1, force === undefined ? 0.5 : force));
    const pv = (opts.vol || 1) * (0.55 + 0.45 * f);
    const pitch = (opts.pitch || 1) * (1.06 - 0.12 * f) * (0.96 + Math.random() * 0.08);
    // 衝擊層：銳利度
    playNoise(r.tr[0], r.tr[1], r.tr[2] * pitch, r.tr[3], r.tr[4] * pv);
    // 材質層：重量（越重的擊音頻越低、拖越久）
    playTone(r.body[0] * pitch, r.body[1] * pitch, r.body[2] * (0.85 + 0.5 * f), r.body[3] * pv, now, r.body[4]);
    // 尾韻層：金屬/木質的「是什麼東西」，只有中重擊才聽得到
    if (r.tail && f > 0.35) {
      playTone(r.tail[0] * pitch, r.tail[1] * pitch, r.tail[2], r.tail[3] * pv * f, now + 0.012, r.tail[4]);
    }
    // 重擊再補一發低頻補強＝「這下很痛」
    if (f > 0.7) playTone(70, 32, 0.18, 0.34 * pv, now + 0.006, 'sine');
  };

  /* ---------- 招式專屬音（第二層）----------
     五個摔技原本全共用 throw_hit，玩家分不出自己出了什麼招。
     這裡每一招都有自己的配方：落地的深度、尖銳度、殘響長度各不相同。
  */
  function noiseSweep(dur, f0, f1, vol, type, when) {
    const t0 = when || ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf(dur, 0.6);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.Q.value = 2.2;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  const THROW_SFX = {
    // 德式背摔：後腦砸地——深、悶、有身體重量壓上去的殘響
    suplex: function (t) {
      playNoise(0.05, 2.0, 900, 'lowpass', 0.55);
      playTone(120, 34, 0.32, 0.55, t, 'sine');
      playTone(64, 26, 0.5, 0.4, t + 0.01, 'sine');
      playNoise(0.16, 1.2, 400, 'bandpass', 0.22, t + 0.02);   // 布料與地板摩擦
    },
    // DDT：頭頂被釘進地板——最尖、最短、幾乎沒有殘響（戛然而止就是 DDT 的招牌）
    ddt: function (t) {
      playNoise(0.028, 4.5, 5600, 'highpass', 0.75);
      playTone(180, 40, 0.1, 0.6, t, 'triangle');
      playTone(58, 24, 0.24, 0.5, t + 0.004, 'sine');
      playNoise(0.06, 3.0, 1600, 'bandpass', 0.3, t + 0.006);
    },
    // 腰投：往前低平摔——比德式輕、比較多的「翻過去」的風聲
    hiptoss: function (t) {
      noiseSweep(0.16, 2200, 700, 0.16, 'bandpass', t);
      playNoise(0.04, 2.6, 1400, 'lowpass', 0.42, t + 0.1);
      playTone(140, 46, 0.2, 0.4, t + 0.1, 'sine');
    },
    // 抱腰翻滾：每一圈撞地——短、圓、可以連續播不打架
    roll: function (t, pitch) {
      const p = pitch || 1;
      playNoise(0.035, 2.4, 1100 * p, 'lowpass', 0.4);
      playTone(150 * p, 55 * p, 0.14, 0.36, t, 'sine');
    },
    // 舉重式拋高：往上甩的呼嘯——只有風，沒有撞擊
    press: function (t) {
      noiseSweep(0.34, 500, 2600, 0.2, 'bandpass', t);
      playTone(200, 620, 0.3, 0.1, t, 'triangle');
    },
    // 空中接住：一聲短促的悶抓
    catchAir: function (t) {
      playNoise(0.05, 3.0, 1300, 'bandpass', 0.4);
      playTone(240, 120, 0.08, 0.28, t, 'triangle');
    },
    // 螺旋摔投的擲出：長甩＋爆
    spiral: function (t) {
      noiseSweep(0.28, 700, 2400, 0.24, 'bandpass', t);
      playTone(90, 30, 0.4, 0.5, t + 0.24, 'sine');
      playNoise(0.09, 1.8, 700, 'lowpass', 0.5, t + 0.24);
    },
  };

  window.sfxThrow = function (name, opts) {
    if (muted || !ensureCtx()) return;
    const fn = THROW_SFX[name];
    if (!fn) return;
    fn(ctx.currentTime, opts && opts.pitch);
  };

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

  function loadBgm() {
    if (bgmBuf || bgmLoading || !ctx) return;
    bgmLoading = true;
    fetch(BGM_FILE)
      .then(r => r.arrayBuffer())
      .then(ab => ctx.decodeAudioData(ab))
      .then(buf => { bgmBuf = buf; bgmLoading = false; if (window.__bgmWanted) window.bgmPlay(); })
      .catch(() => { bgmLoading = false; });
  }

  window.bgmPlay = function () {
    window.__bgmWanted = true;
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (!bgmBuf) { loadBgm(); return; }
    if (bgmSrc) return;   // 已經在播
    bgmSrc = ctx.createBufferSource();
    bgmSrc.buffer = bgmBuf;
    bgmSrc.loop = true;
    bgmSrc.loopStart = 0;
    bgmSrc.loopEnd = Math.min(BGM_LOOP_END, bgmBuf.duration);
    bgmSrc.connect(bgmBus);
    bgmSrc.start(0);
  };

  window.bgmStop = function (fade) {
    window.__bgmWanted = false;
    if (!bgmSrc || !ctx) return;
    const s = bgmSrc;
    bgmSrc = null;
    if (fade) {
      const g = ctx.createGain();
      // 淡出後停：直接 stop 會爆音
      try { s.disconnect(); } catch (e) {}
      s.connect(g); g.connect(bgmBus);
      const t0 = ctx.currentTime;
      g.gain.setValueAtTime(1, t0);
      g.gain.linearRampToValueAtTime(0.0001, t0 + fade);
      setTimeout(() => { try { s.stop(); } catch (e) {} }, fade * 1000 + 60);
    } else {
      try { s.stop(); } catch (e) {}
    }
  };

  window.bgmGetVolume = function () { return bgmVol; };
  window.bgmSetVolume = function (v) {
    bgmVol = Math.max(0, Math.min(1, v));
    if (bgmBus) bgmBus.gain.value = bgmVol;
    try { localStorage.setItem('penguin_bgmvol_v1', String(bgmVol)); } catch (e) {}
    return bgmVol;
  };

  window.sfxToggleMute = function () {
    muted = !muted;
    if (bgmBus) bgmBus.gain.value = muted ? 0 : bgmVol;
    return muted;
  };
})();
