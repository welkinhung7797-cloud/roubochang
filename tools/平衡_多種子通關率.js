/* 多種子平衡量測：每個職業跑 N 個種子，回報通關率與中位波次 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const DIR = path.join(__dirname, '..', 'src') + path.sep;

function makeSandbox() {
  const store = {};
  const s = {
    console, Math, JSON, Date,
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById() { return null; } },
    requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  };
  s.globalThis = s;
  vm.createContext(s);
  const src = ['data.js', 'engine.js', 'render.js', 'ui.js']
    .map(f => fs.readFileSync(DIR + f, 'utf8')).join('\n;\n');
  vm.runInContext(src + '\n;onModeChange = function(){};\n', s, { filename: 'bundle.js' });
  return s;
}

const danger = parseInt(process.argv[2] || '0', 10);
const N = parseInt(process.argv[3] || '5', 10);
const sb = makeSandbox();
const CHARS = vm.runInContext('CHARACTERS.map(c=>({id:c.id,name:c.name}))', sb);
const SEEDS = [];
for (let i = 0; i < N; i++) SEEDS.push(1000 + i * 7919);

console.log('危險 ' + danger + '　每職業 ' + N + ' 局');
console.log('職業'.padEnd(12) + '通關率   波次(各局)                     平均擊殺');
console.log('-'.repeat(76));
const summary = [];
for (const c of CHARS) {
  const waves = [], kills = [];
  let win = 0;
  for (const seed of SEEDS) {
    const r = vm.runInContext(
      `window.__test.simulate(${JSON.stringify(c.id)}, ${danger}, ${seed}, 4200)`, sb);
    if (r.result === 'victory') win++;
    waves.push(r.wave); kills.push(r.kills);
  }
  const avgK = Math.round(kills.reduce((a, b) => a + b, 0) / kills.length);
  const rate = win / SEEDS.length;
  summary.push({ name: c.name, rate, waves });
  const pad = 12 - (c.name.length * 2 - c.name.length);
  console.log(
    c.name + '　'.repeat(Math.max(1, 6 - c.name.length)) +
    (Math.round(rate * 100) + '%').padStart(5) + '   ' +
    waves.map(w => String(w).padStart(2)).join(' ') + '                  ' + avgK);
}
console.log('-'.repeat(76));
const overall = summary.reduce((a, s) => a + s.rate, 0) / summary.length;
console.log('整體通關率 ' + Math.round(overall * 100) + '%');
const weak = summary.filter(s => s.rate <= 0.2).map(s => s.name);
const strong = summary.filter(s => s.rate === 1).map(s => s.name);
if (weak.length) console.log('明顯偏弱：' + weak.join('、'));
if (strong.length) console.log('全勝：' + strong.join('、'));
