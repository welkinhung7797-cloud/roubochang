/* 不靠瀏覽器的邏輯模擬：把四支檔案載進 vm，跑機器人自動玩 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const DIR = path.join(__dirname, '..', 'src') + path.sep;

const store = {};
const sandbox = {
  console,
  Math, JSON, Date,
  window: { addEventListener() {}, },
  document: { addEventListener() {}, getElementById() { return null; } },
  requestAnimationFrame() {},
  setTimeout() {}, clearTimeout() {},
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const src = ['data.js', 'engine.js', 'render.js', 'ui.js']
  .map(f => fs.readFileSync(DIR + f, 'utf8')).join('\n;\n');

// 載入後把介面回呼換成空函式（模擬不需要 DOM）
vm.runInContext(src + '\n;onModeChange = function(){};\n', sandbox, { filename: 'bundle.js' });

const CHARS = vm.runInContext('CHARACTERS.map(c=>c.id)', sandbox);
const danger = parseInt(process.argv[2] || '0', 10);
const seed = parseInt(process.argv[3] || '4242', 10);

console.log('危險等級 ' + danger + '　種子 ' + seed);
console.log('職業'.padEnd(10) + '結果'.padEnd(10) + '波'.padEnd(5) + '等'.padEnd(5) + '擊殺'.padEnd(7) + '生命'.padEnd(11) + '模擬秒數');
console.log('-'.repeat(78));

let wins = 0, fails = [];
for (const id of CHARS) {
  let r;
  try {
    r = vm.runInContext(
      `window.__test.simulate(${JSON.stringify(id)}, ${danger}, ${seed}, 4200)`, sandbox);
  } catch (e) {
    fails.push(id + ' → 例外：' + e.message);
    console.log(id.padEnd(10) + '例外  ' + e.message);
    continue;
  }
  const name = vm.runInContext(`CHARACTERS.find(c=>c.id===${JSON.stringify(id)}).name`, sandbox);
  const ok = r.result === 'victory';
  if (ok) wins++;
  console.log(
    name.padEnd(12 - name.length) +
    (ok ? '通關' : '倒下').padEnd(10) +
    String(r.wave).padEnd(5) +
    String(r.level).padEnd(5) +
    String(r.kills).padEnd(7) +
    (r.hp + '/' + r.maxHp).padEnd(11) +
    r.simSeconds
  );
  if (!ok && r.wave <= 3) fails.push(name + ' 只到第 ' + r.wave + ' 波');
}
console.log('-'.repeat(78));
console.log('通關 ' + wins + ' / ' + CHARS.length);
const errs = vm.runInContext('window.__test.errors', sandbox);
if (errs && errs.length) console.log('捕捉到錯誤：', errs);
if (fails.length) { console.log('\n可疑：'); fails.forEach(f => console.log('  ' + f)); }
