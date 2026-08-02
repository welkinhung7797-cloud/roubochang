/* 同一個沙箱內連跑同種子三次，結果必須完全一致。
   不一致代表有跨局殘留狀態，平衡量測就不可信。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const DIR = path.join(__dirname, '..', 'src') + path.sep;

const store = {};
const sb = {
  console, Math, JSON, Date,
  window: { addEventListener() {} },
  document: { addEventListener() {}, getElementById() { return null; } },
  requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
};
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(
  ['data.js', 'engine.js', 'render.js', 'ui.js'].map(f => fs.readFileSync(DIR + f, 'utf8')).join('\n;\n')
  + '\n;onModeChange = function(){};\n', sb, { filename: 'bundle.js' });

const cases = [['wrestler', 3, 606060], ['boxer', 0, 4242], ['ninja', 5, 4]];
let allSame = true;
for (const [id, danger, seed] of cases) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const r = vm.runInContext(
      `window.__test.simulate(${JSON.stringify(id)}, ${danger}, ${seed}, 1800)`, sb);
    runs.push(r.result + '/波' + r.wave + '/殺' + r.kills + '/等' + r.level);
  }
  const same = runs.every(x => x === runs[0]);
  if (!same) allSame = false;
  console.log((same ? '一致  ' : '不一致') + '  ' + id + ' 危險' + danger + ' 種子' + seed + '　→　' + runs.join('　|　'));
}
console.log(allSame ? '\n結果：同種子完全可重現' : '\n結果：仍有跨局殘留狀態，需修');
process.exit(allSame ? 0 : 1);
