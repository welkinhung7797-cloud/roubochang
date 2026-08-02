/* 單一職業逐波診斷：每波的敵人數、輸出、承傷來源、素材 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const DIR = path.join(__dirname, '..', 'src') + path.sep;
const store = {};
const sandbox = {
  console, Math, JSON, Date,
  window: { addEventListener() {} },
  document: { addEventListener() {}, getElementById() { return null; } },
  requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const src = ['data.js', 'engine.js', 'render.js', 'ui.js']
  .map(f => fs.readFileSync(DIR + f, 'utf8')).join('\n;\n');
vm.runInContext(src + '\n;onModeChange = function(){};\n', sandbox, { filename: 'bundle.js' });

const charId = process.argv[2] || 'boxer';
const danger = parseInt(process.argv[3] || '0', 10);
const seed = parseInt(process.argv[4] || '4242', 10);

const code = `
(function(){
  setSeed(${seed});
  BOT.on = true;
  startRun(${JSON.stringify(charId)}, ${danger});
  const dt = 1/60;
  const rows = [];
  let t = 0, wave = 1;
  let wStart = { dealt:0, taken:0, mat:0, kills:0 };
  let maxAlive = 0, aliveSum = 0, samples = 0;
  let srcSnapshot = {};
  function snapWave(){
    const src = {};
    for (const k in G.stats.src) {
      const d = G.stats.src[k] - (srcSnapshot[k]||0);
      if (d > 0.5) src[k] = Math.round(d);
    }
    srcSnapshot = Object.assign({}, G.stats.src);
    rows.push({
      wave: wave,
      dealt: Math.round(G.stats.dmgDealt - wStart.dealt),
      taken: Math.round(G.stats.dmgTaken - wStart.taken),
      mat: G.totalMaterials - wStart.mat,
      kills: G.kills - wStart.kills,
      maxAlive: maxAlive,
      avgAlive: Math.round(aliveSum/Math.max(1,samples)*10)/10,
      hp: Math.round(G.player.hp), maxHp: G.player.maxHp,
      lv: G.level,
      weapons: G.player.weapons.map(w=>w.name+TIER_NAME[w.tier]).join(' '),
      items: G.player.items.length,
      src: src,
    });
    wStart = { dealt:G.stats.dmgDealt, taken:G.stats.dmgTaken, mat:G.totalMaterials, kills:G.kills };
    maxAlive = 0; aliveSum = 0; samples = 0;
  }
  while (t < 2000 && G.mode !== 'gameover' && G.mode !== 'victory') {
    if (G.mode === 'playing') {
      botControl(dt); updateGame(dt);
      maxAlive = Math.max(maxAlive, G.enemies.length);
      aliveSum += G.enemies.length; samples++;
      if (G.wave !== wave) { snapWave(); wave = G.wave; }
    }
    botAutoUi();
    t += dt;
  }
  snapWave();
  return { result: G.mode, rows: rows };
})()
`;
const r = vm.runInContext(code, sandbox);
const name = vm.runInContext(`CHARACTERS.find(c=>c.id===${JSON.stringify(charId)}).name`, sandbox);
console.log(name + '　危險 ' + danger + '　→　' + (r.result === 'victory' ? '通關' : '倒下'));
console.log('波  擊殺 輸出   承傷  素材 等 生命      同時在場(峰/均) 武器');
for (const w of r.rows) {
  console.log(
    String(w.wave).padStart(2) + '  ' +
    String(w.kills).padStart(4) + ' ' +
    String(w.dealt).padStart(6) + ' ' +
    String(w.taken).padStart(5) + ' ' +
    String(w.mat).padStart(5) + ' ' +
    String(w.lv).padStart(2) + ' ' +
    (w.hp + '/' + w.maxHp).padStart(9) + ' ' +
    (w.maxAlive + '/' + w.avgAlive).padStart(10) + '  ' + w.weapons + ' [道具' + w.items + ']'
  );
  const s = Object.entries(w.src).sort((a, b) => b[1] - a[1]);
  if (s.length) console.log('      承傷來源 ' + s.map(x => x[0] + ' ' + x[1]).join('　'));
}
