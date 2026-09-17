/* DOM 层渲染断言：不依赖浏览器，验证模板产物里没有 undefined / NaN / 错价。
   重点覆盖三处最容易漏改的地方：商店 UI 的价格、结算面板的账目、客人卡片。
   用法：node test_render.js                                                 */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const code = html.match(/<script>([\s\S]*)<\/script>/)[1];

/* ---- 可观测的 DOM 桩：记录 innerHTML / className / textContent ---- */
const created = [];
function makeEl(tag) {
  const el = {
    tag: tag || 'div', className: '', textContent: '', value: '',
    dataset: {}, children: [], style: {}, attrs: {}, handlers: {},
    _classes: new Set(), _html: '',
    addEventListener(ev, fn) { this.handlers[ev] = fn; },
    appendChild(c) { this.children.push(c); return c; },
    remove() { },
    setAttribute(k, v) { this.attrs[k] = v; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    querySelectorAll() { return []; }
  };
  /* 对齐真实 DOM：写入 innerHTML 会清空既有子节点 */
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); this.children.length = 0; }
  });
  el.classList = {
    add: c => el._classes.add(c),
    remove: c => el._classes.delete(c),
    contains: c => el._classes.has(c),
    has: c => el._classes.has(c),
    toggle: (c, on) => { on === false ? el._classes.delete(c) : el._classes.add(c); }
  };
  created.push(el);
  return el;
}
const nodes = {};
const sandbox = {};
sandbox.document = {
  getElementById: id => nodes[id] || (nodes[id] = makeEl('div#' + id)),
  createElement: makeEl,
  querySelectorAll: () => [],
  addEventListener() { }
};
const store = {};
sandbox.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => store[k] = v, removeItem: k => delete store[k] };
sandbox.performance = { now: () => Date.now() };
sandbox.requestAnimationFrame = () => 0;
sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout; sandbox.console = console;
sandbox.Blob = function () { }; sandbox.URL = { createObjectURL: () => '', revokeObjectURL: () => { } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code + '\n;globalThis.__API={R:R,S:()=>S,setS:v=>{S=v;},BALANCE,DISHES,DISH,startLevel,step,spawnCustomer,openShop,endLevel,openSavePanel,upgradeCost,starsFor,ACT};', sandbox, { filename: 'game.js' });
const A = sandbox.__API;

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : ''));
  cond ? pass++ : fail++;
}
function bad(htmlStr) {
  const hits = [];
  if (/\bundefined\b/.test(htmlStr)) hits.push('undefined');
  if (/\bNaN\b/.test(htmlStr)) hits.push('NaN');
  if (/\[object Object\]/.test(htmlStr)) hits.push('[object Object]');
  if (/\$\{/.test(htmlStr)) hits.push('未替换的模板占位');
  return hits;
}
function freshS(over) {
  return Object.assign({ coins: 0, level: 1, stars: {}, unlocked: ['dj', 'cd', 'yt'], stations: 2, trayMax: 3, speedLv: 1, earnedTotal: 0, servedTotal: 0, lostTotal: 0 }, over || {});
}

/* ---------- 1. 开局渲染 ---------- */
console.log('\n[1] 开局渲染');
A.setS(freshS());
A.startLevel(1);
const seatsBox = nodes['seats'], menuBox = nodes['menu'];
ok(seatsBox.children.length === 4, '座位区渲染 4 个座位', seatsBox.children.length);
ok(menuBox.children.length === 8, '菜单渲染 8 道菜（含未解锁）', menuBox.children.length);
ok(!bad(seatsBox.innerHTML).length && seatsBox.children.every(c => !bad(c.innerHTML).length), '座位模板无 undefined/NaN');
ok(menuBox.children.every(c => !bad(c.innerHTML).length), '菜单模板无 undefined/NaN');

const hud = { lvl: nodes['hLevel'].textContent, coins: nodes['hCoins'].textContent, target: nodes['hTarget'].textContent, time: nodes['hTime'].textContent };
ok(/^\d+$/.test(String(hud.lvl)) && /^\d+$/.test(String(hud.coins)) && /^\d+$/.test(String(hud.target)) && /^\d+$/.test(String(hud.time)),
  'HUD 四项均为纯数字', hud);
ok(String(hud.target) === String(A.R.target), 'HUD 目标营收 = 运行时目标', { hud: hud.target, R: A.R.target });

/* ---------- 2. 客人卡片 ---------- */
console.log('\n[2] 客人卡片');
const R = A.R;
R.seats[0] = { name: '测试客', color: '#C8871B', order: ['dj', 'cd'], served: [], patience: 12, maxPatience: 24 };
R.seatEls[0].innerHTML = '';
vm.runInContext('renderSeat(0)', sandbox);
const card = R.seatEls[0].innerHTML;
ok(card.includes('测试客'), '卡片含客人称呼');
ok(card.includes(A.DISH['dj'].name) && card.includes(A.DISH['cd'].name), '卡片含两份订单菜名');
ok(/width:\s*50(\.\d+)?%/.test(card), '耐心条宽度 = 50%', (card.match(/width:[^"]*%/) || [])[0]);
ok(!bad(card).length, '客人卡片模板干净', bad(card));

/* 耐心将尽时应带告警样式 */
R.seats[0].patience = 4;   // 4/24 ≈ 16.7% → bad
R.seatEls[0].innerHTML = '';
vm.runInContext('renderSeat(0)', sandbox);
ok(/bar bad/.test(R.seatEls[0].innerHTML), '耐心 < 25% 时切换为告警样式');

/* ---------- 3. 商店 UI 与调参区一致性（易漏改点） ---------- */
console.log('\n[3] 商店 UI 价格 = BALANCE');
A.setS(freshS({ coins: 99999, level: 5 }));
A.openShop();
const shop = nodes['modal'].innerHTML;
ok(!bad(shop).length, '商店模板无 undefined/NaN', bad(shop));
const b = A.BALANCE;
ok(shop.includes(b.stationCost[0] + ' 元'), '商店显示灶台首档价 ' + b.stationCost[0]);
ok(shop.includes(b.trayCost + ' 元'), '商店显示出餐口价 ' + b.trayCost);
ok(shop.includes(b.speedCost[0] + ' 元'), '商店显示速度首档价 ' + b.speedCost[0]);
A.DISHES.filter(d => d.cost > 0).forEach(d => {
  ok(shop.includes(d.cost + ' 元'), '商店显示「' + d.name + '」解锁价 ' + d.cost);
});

/* ---------- 4. 结算面板账目自洽 ---------- */
console.log('\n[4] 结算面板账目');
A.setS(freshS());
A.startLevel(1);
A.R.earned = 200; A.R.served = 12; A.R.lost = 1;
const coinsBefore = A.S().coins;
A.endLevel();
const settle = nodes['modal'].innerHTML;
ok(!bad(settle).length, '结算模板无 undefined/NaN', bad(settle));
ok(settle.includes('食材成本'), '结算面板列出食材成本');
ok(settle.includes('本关入账'), '结算面板列出本关入账');
ok(settle.includes('目标营收'), '结算面板列出目标营收');
const shownNet = Number((settle.match(/本关入账<\/span><b>\+(\d+) 元/) || [])[1]);
const realNet = A.S().coins - coinsBefore;
ok(shownNet === realNet, '面板显示的「本关入账」= 金币实际增量', { shownNet, realNet });
const shownCost = Number((settle.match(/食材成本<\/span><span>-(\d+) 元/) || [])[1]);
ok(shownCost === Math.round(A.R.earned * b.ingredientRate), '面板食材成本 = 营收 × ' + b.ingredientRate, { shownCost });

/* 重复挑战（星级未提升）应显示折扣行，且不再给满星奖励 */
console.log('\n[5] 重复挑战结算显示');
A.startLevel(1);
A.R.earned = 200;
A.endLevel();
const again = nodes['modal'].innerHTML;
ok(again.includes('重复挑战结算'), '重复挑战时显示折扣结算行');
const againNet = Number((again.match(/本关入账<\/span><b>\+(\d+) 元/) || [])[1]);
ok(againNet < shownNet, '重复挑战入账小于首通', { againNet, first: shownNet });

/* ---------- 6. 存档面板 ---------- */
console.log('\n[6] 存档面板');
A.openSavePanel();
const save = nodes['modal'].innerHTML;
ok(save.length > 0, '存档面板已渲染', save.length);
ok(!bad(save).length, '存档面板模板无 undefined/NaN', bad(save));

/* ---------- 7. 全关卡模板巡检 ---------- */
console.log('\n[7] 全关卡面板巡检（1~30 关）');
let dirty = [];
for (let lv = 1; lv <= 30; lv++) {
  A.setS(freshS({ level: lv, coins: 99999 }));
  A.startLevel(lv);
  vm.runInContext('renderSeat(0)', sandbox);
  A.openShop();
  const s = nodes['modal'].innerHTML + nodes['seats'].innerHTML + nodes['menu'].innerHTML;
  const hit = bad(s);
  if (hit.length) dirty.push(lv + ':' + hit.join(','));
}
ok(dirty.length === 0, '1~30 关所有面板模板均干净', dirty.slice(0, 5));

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('========================================');
process.exit(fail ? 1 : 0);
